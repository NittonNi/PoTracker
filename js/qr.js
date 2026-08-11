/* PoTracker — a minimal QR encoder (byte mode, error correction level L,
   versions 1-10). Used only to hand credentials from one of your devices to
   another by pointing a camera at a screen — no library, no network. */
window.PT = window.PT || {};

PT.qr = (function () {
  /* version -> [ecCodewordsPerBlock, group1Blocks, group1Data, group2Blocks, group2Data] */
  const SPEC = {
    1:  [7,  1, 19, 0, 0],
    2:  [10, 1, 34, 0, 0],
    3:  [15, 1, 55, 0, 0],
    4:  [20, 1, 80, 0, 0],
    5:  [26, 1, 108, 0, 0],
    6:  [18, 2, 68, 0, 0],
    7:  [20, 2, 78, 0, 0],
    8:  [24, 2, 97, 0, 0],
    9:  [30, 2, 116, 0, 0],
    10: [18, 2, 68, 2, 69]
  };
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };
  const VERSION_INFO = { 7: 0x07C94, 8: 0x085BC, 9: 0x09A99, 10: 0x0A4D3 };
  const FORMAT_L = [0x77C4, 0x72F3, 0x7DAA, 0x789D, 0x662F, 0x6318, 0x6C41, 0x6976];

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => ((((r * c) % 2) + ((r * c) % 3)) % 2) === 0,
    (r, c) => ((((r + c) % 2) + ((r * c) % 3)) % 2) === 0
  ];

  /* ── GF(256) arithmetic ── */
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function buildTables() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  function generatorPoly(degree) {
    let g = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        next[j] ^= g[j];
        next[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = next;
    }
    return g;
  }

  function remainder(data, ecLength) {
    const g = generatorPoly(ecLength);
    const buffer = data.concat(new Array(ecLength).fill(0));
    for (let i = 0; i < data.length; i++) {
      const factor = buffer[i];
      if (factor === 0) continue;
      for (let j = 0; j < g.length; j++) buffer[i + j] ^= mul(g[j], factor);
    }
    return buffer.slice(data.length);
  }

  /* ── data encoding ── */
  const dataCapacity = (version) => {
    const [, g1, d1, g2, d2] = SPEC[version];
    return g1 * d1 + g2 * d2;
  };

  function pickVersion(byteLength) {
    for (let v = 1; v <= 10; v++) {
      const countBits = v < 10 ? 8 : 16;
      const needed = Math.ceil((4 + countBits + byteLength * 8) / 8);
      if (needed <= dataCapacity(v)) return v;
    }
    throw new Error('Payload is too long for this encoder');
  }

  function buildCodewords(bytes, version) {
    const bits = [];
    const push = (value, length) => {
      for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
    };

    push(0b0100, 4);                       // byte mode
    push(bytes.length, version < 10 ? 8 : 16);
    bytes.forEach((b) => push(b, 8));

    const capacity = dataCapacity(version) * 8;
    push(0, Math.min(4, capacity - bits.length));   // terminator
    while (bits.length % 8) bits.push(0);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
    }
    const PAD = [0xEC, 0x11];
    for (let i = 0; codewords.length < dataCapacity(version); i++) codewords.push(PAD[i % 2]);
    return codewords;
  }

  /** Split into blocks, add Reed-Solomon, then interleave as the spec requires. */
  function interleave(codewords, version) {
    const [ecLength, g1, d1, g2, d2] = SPEC[version];
    const blocks = [];
    let offset = 0;
    for (let i = 0; i < g1; i++) { blocks.push(codewords.slice(offset, offset + d1)); offset += d1; }
    for (let i = 0; i < g2; i++) { blocks.push(codewords.slice(offset, offset + d2)); offset += d2; }
    const ecBlocks = blocks.map((b) => remainder(b, ecLength));

    const out = [];
    const maxData = Math.max(d1, d2);
    for (let i = 0; i < maxData; i++) {
      for (const block of blocks) if (i < block.length) out.push(block[i]);
    }
    for (let i = 0; i < ecLength; i++) {
      for (const block of ecBlocks) out.push(block[i]);
    }
    return out;
  }

  /* ── matrix ── */
  function blankMatrix(size) {
    return Array.from({ length: size }, () => new Array(size).fill(0));
  }

  function drawFunctionPatterns(m, reserved, version, size) {
    const setF = (r, c, v) => { m[r][c] = v; reserved[r][c] = 1; };

    const finder = (row, col) => {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const rr = row + r;
          const cc = col + c;
          if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
          const onRing = (r === 0 || r === 6) && c >= 0 && c <= 6;
          const onSide = (c === 0 || c === 6) && r >= 0 && r <= 6;
          const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          setF(rr, cc, onRing || onSide || core ? 1 : 0);
        }
      }
    };
    finder(0, 0);
    finder(0, size - 7);
    finder(size - 7, 0);

    for (let i = 8; i < size - 8; i++) {
      const bit = i % 2 === 0 ? 1 : 0;
      setF(6, i, bit);
      setF(i, 6, bit);
    }

    const positions = ALIGN[version];
    for (const r of positions) {
      for (const c of positions) {
        // Alignment patterns never sit on top of a finder.
        if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const edge = Math.max(Math.abs(dr), Math.abs(dc));
            setF(r + dr, c + dc, edge !== 1 ? 1 : 0);
          }
        }
      }
    }

    setF(size - 8, 8, 1); // the always-dark module

    // Reserve the format areas; the real bits go in after masking.
    for (let i = 0; i < 9; i++) {
      if (!reserved[8][i]) { reserved[8][i] = 1; m[8][i] = 0; }
      if (!reserved[i][8]) { reserved[i][8] = 1; m[i][8] = 0; }
    }
    for (let i = 0; i < 8; i++) {
      if (!reserved[8][size - 1 - i]) { reserved[8][size - 1 - i] = 1; m[8][size - 1 - i] = 0; }
      if (!reserved[size - 1 - i][8]) { reserved[size - 1 - i][8] = 1; m[size - 1 - i][8] = 0; }
    }

    if (version >= 7) {
      const info = VERSION_INFO[version];
      for (let i = 0; i < 18; i++) {
        const bit = (info >> i) & 1;
        const a = Math.floor(i / 3);
        const b = i % 3;
        setF(size - 11 + b, a, bit);
        setF(a, size - 11 + b, bit);
      }
    }
  }

  function placeData(m, reserved, codewords, size) {
    const bits = [];
    codewords.forEach((cw) => { for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1); });

    let index = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // the vertical timing column is not data
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const col = right - j;
          const row = upward ? size - 1 - vert : vert;
          if (reserved[row][col]) continue;
          m[row][col] = index < bits.length ? bits[index] : 0;
          index++;
        }
      }
      upward = !upward;
    }
  }

  function penalty(m, size) {
    let score = 0;

    // Rule 1: runs of five or more same-colour modules.
    const runScore = (line) => {
      let total = 0;
      let run = 1;
      for (let i = 1; i < line.length; i++) {
        if (line[i] === line[i - 1]) { run++; } else { if (run >= 5) total += run - 2; run = 1; }
      }
      if (run >= 5) total += run - 2;
      return total;
    };
    for (let i = 0; i < size; i++) {
      score += runScore(m[i]);
      score += runScore(m.map((row) => row[i]));
    }

    // Rule 2: 2x2 blocks of one colour.
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }

    // Rule 3: finder-like patterns.
    const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const matches = (line, i, pattern) => pattern.every((p, k) => line[i + k] === p);
    for (let i = 0; i < size; i++) {
      const row = m[i];
      const col = m.map((r) => r[i]);
      for (let j = 0; j + 11 <= size; j++) {
        if (matches(row, j, A) || matches(row, j, B)) score += 40;
        if (matches(col, j, A) || matches(col, j, B)) score += 40;
      }
    }

    // Rule 4: overall balance of dark modules.
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c];
    const percent = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;

    return score;
  }

  function placeFormat(m, maskIndex, size) {
    const format = FORMAT_L[maskIndex];
    const bit = (i) => (format >> i) & 1;

    // First copy: down the left edge of the top-left finder, then along its bottom.
    for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
    m[7][8] = bit(6);
    m[8][8] = bit(7);
    m[8][7] = bit(8);
    for (let i = 9; i <= 14; i++) m[8][14 - i] = bit(i);

    // Second copy: along the bottom of the top-right finder, then down the
    // right of the bottom-left one.
    for (let i = 0; i <= 7; i++) m[8][size - 1 - i] = bit(i);
    for (let i = 8; i <= 14; i++) m[size - 15 + i][8] = bit(i);
    m[size - 8][8] = 1;
  }

  /** Encode a string, returning { size, modules } where modules[row][col] is 0 or 1. */
  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    const version = pickVersion(bytes.length);
    const size = version * 4 + 17;
    const codewords = interleave(buildCodewords(bytes, version), version);

    const reserved = blankMatrix(size);
    const base = blankMatrix(size);
    drawFunctionPatterns(base, reserved, version, size);
    placeData(base, reserved, codewords, size);

    let best = null;
    for (let maskIndex = 0; maskIndex < 8; maskIndex++) {
      const candidate = base.map((row) => row.slice());
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (!reserved[r][c] && MASKS[maskIndex](r, c)) candidate[r][c] ^= 1;
        }
      }
      placeFormat(candidate, maskIndex, size);
      const score = penalty(candidate, size);
      if (!best || score < best.score) best = { score, modules: candidate, maskIndex };
    }

    return { size, version, modules: best.modules, mask: best.maskIndex };
  }

  /** Render to an SVG string. Always drawn on white — cameras need the contrast. */
  function svg(text, opts) {
    const o = Object.assign({ quiet: 4, scale: 8 }, opts || {});
    const { size, modules } = encode(text);
    const total = size + o.quiet * 2;
    let path = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (modules[r][c]) path += `M${c + o.quiet} ${r + o.quiet}h1v1h-1z`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total * o.scale}" height="${total * o.scale}" shape-rendering="crispEdges" role="img" aria-label="Pairing QR code">
      <rect width="${total}" height="${total}" fill="#ffffff"/>
      <path d="${path}" fill="#000000"/>
    </svg>`;
  }

  return { encode, svg };
})();
