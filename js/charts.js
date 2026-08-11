/* PoTracker — hand-rolled SVG charts. No chart library, no external requests,
   and every colour comes from the CSS variables so light/dark just works. */
window.PT = window.PT || {};

PT.charts = (function () {
  let gradientSeq = 0;

  /* ── cumulative profit curve ──────────────────────────────────────────
     Straight segments on purpose: a smoothed spline would invent profit
     between two sessions that never existed. */
  function area(curve, opts) {
    const o = Object.assign({ width: 680, height: 190, pad: 14 }, opts || {});
    if (!curve || curve.length === 0) {
      return '<div class="chart-empty">No sessions in this range</div>';
    }

    const W = o.width, H = o.height, P = o.pad;
    const values = curve.map((p) => p.value);
    const points = curve.length === 1 ? [{ value: 0 }].concat(curve) : curve;
    const allValues = curve.length === 1 ? [0].concat(values) : values;

    let min = Math.min(0, ...allValues);
    let max = Math.max(0, ...allValues);
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;

    const x = (i) => P + (i / Math.max(1, points.length - 1)) * (W - P * 2);
    const y = (v) => P + (1 - (v - min) / span) * (H - P * 2);

    const last = allValues[allValues.length - 1];
    const positive = last >= 0;
    const colorVar = positive ? 'var(--green)' : 'var(--red)';
    const gid = `ptGrad${++gradientSeq}`;

    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(allValues[i]).toFixed(1)}`).join(' ');
    const fill = `${line} L${x(points.length - 1).toFixed(1)},${(H - P).toFixed(1)} L${x(0).toFixed(1)},${(H - P).toFixed(1)} Z`;
    const zeroY = y(0);

    const lastX = x(points.length - 1);
    const lastY = y(last);

    return `
<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px" role="img" aria-label="Cumulative profit">
  <defs>
    <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   style="stop-color:${colorVar}" stop-opacity=".30"/>
      <stop offset="100%" style="stop-color:${colorVar}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <line x1="${P}" y1="${zeroY.toFixed(1)}" x2="${W - P}" y2="${zeroY.toFixed(1)}"
        style="stroke:var(--label-3)" stroke-width="1" stroke-dasharray="3 4"/>
  <path d="${fill}" fill="url(#${gid})"/>
  <path d="${line}" fill="none" style="stroke:${colorVar}" stroke-width="2.4"
        stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4" style="fill:${colorVar}"/>
  <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="8" style="fill:${colorVar}" opacity=".22"/>
</svg>`;
  }

  /* ── diverging horizontal bars (HTML, so labels stay selectable) ── */
  function bars(items, opts) {
    const o = Object.assign({ value: (d) => d.net, label: (d) => d.key, format: (d) => PT.util.signed(d.net), color: null }, opts || {});
    if (!items || !items.length) return '<div class="chart-empty">Nothing to show yet</div>';

    const magnitudes = items.map((d) => Math.abs(o.value(d)));
    const peak = Math.max(1, ...magnitudes);
    const hasNegative = items.some((d) => o.value(d) < 0);
    // With negatives the axis sits in the middle, otherwise bars grow from the left.
    const origin = hasNegative ? 50 : 0;

    return `<div class="bar-list">${items.map((d) => {
      const v = o.value(d);
      const width = (Math.abs(v) / peak) * (hasNegative ? 50 : 100);
      const left = v < 0 ? origin - width : origin;
      const color = o.color ? o.color(d) : (v >= 0 ? 'var(--green)' : 'var(--red)');
      return `<div class="bar-item">
        <div class="bar-name" title="${PT.util.esc(o.label(d))}">${PT.util.esc(o.label(d))}</div>
        <div class="bar-track">
          <div class="bar-fill" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%;background:${color}"></div>
        </div>
        <div class="bar-value ${PT.util.tone(v)}">${o.format(d)}</div>
      </div>`;
    }).join('')}</div>`;
  }

  /* ── vertical columns above/below a zero line ── */
  function columns(items, opts) {
    const o = Object.assign({ height: 150, value: (d) => d.net, label: (d) => d.key }, opts || {});
    if (!items || !items.length) return '<div class="chart-empty">Nothing to show yet</div>';

    const values = items.map(o.value);
    const max = Math.max(0, ...values);
    const min = Math.min(0, ...values);
    const span = (max - min) || 1;
    const H = o.height;
    const zeroPct = (max / span) * 100;

    return `<div class="col-chart" style="--zero:${zeroPct.toFixed(2)}%;--h:${H}px">
      ${items.map((d) => {
        const v = o.value(d);
        const pct = (Math.abs(v) / span) * 100;
        const up = v >= 0;
        return `<div class="col-item">
          <div class="col-track">
            <div class="col-bar ${up ? 'is-up' : 'is-down'}"
                 style="height:${pct.toFixed(2)}%;${up ? `bottom:${(100 - zeroPct).toFixed(2)}%` : `top:${zeroPct.toFixed(2)}%`}"
                 title="${PT.util.esc(o.label(d))}: ${PT.util.signed(v)}"></div>
          </div>
          <div class="col-label">${PT.util.esc(o.label(d))}</div>
          <div class="col-value ${PT.util.tone(v)}">${PT.util.signed(v, { decimals: 0 })}</div>
        </div>`;
      }).join('')}
    </div>`;
  }

  /* ── Apple-style activity rings ── */
  function rings(ratios, opts) {
    const o = Object.assign({ size: 132 }, opts || {});
    const S = o.size;
    const c = S / 2;
    const specs = [
      { key: 'profit',   r: c - 11, color: 'var(--green)' },
      { key: 'hours',    r: c - 26, color: 'var(--blue)' },
      { key: 'sessions', r: c - 41, color: 'var(--orange)' }
    ];

    const arcs = specs.map((spec) => {
      const circumference = 2 * Math.PI * spec.r;
      const ratio = PT.util.clamp(Number(ratios[spec.key]) || 0, 0, 1);
      const dash = circumference * ratio;
      return `
      <circle cx="${c}" cy="${c}" r="${spec.r}" fill="none" style="stroke:${spec.color}" stroke-opacity=".18" stroke-width="11"/>
      <circle cx="${c}" cy="${c}" r="${spec.r}" fill="none" style="stroke:${spec.color}" stroke-width="11"
              stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
              transform="rotate(-90 ${c} ${c})">
        <animate attributeName="stroke-dasharray" from="0 ${circumference.toFixed(2)}"
                 to="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" dur="0.9s" fill="freeze"
                 calcMode="spline" keySplines="0.32 0.72 0 1" keyTimes="0;1"/>
      </circle>`;
    }).join('');

    return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="Monthly goal progress">${arcs}</svg>`;
  }

  /** Tiny inline trend line for a stat tile. */
  function sparkline(values, opts) {
    const o = Object.assign({ width: 90, height: 26 }, opts || {});
    if (!values || values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = (max - min) || 1;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * o.width;
      const y = o.height - ((v - min) / span) * o.height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const color = values[values.length - 1] >= values[0] ? 'var(--green)' : 'var(--red)';
    return `<svg width="${o.width}" height="${o.height}" viewBox="0 0 ${o.width} ${o.height}" aria-hidden="true">
      <polyline points="${pts}" fill="none" style="stroke:${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  /** Follow the pointer across the profit curve and report the nearest point. */
  function trackArea(container, curve, onHover) {
    const svg = container.querySelector('svg.chart');
    if (!svg || !curve.length) return;

    const move = (event) => {
      const rect = svg.getBoundingClientRect();
      const clientX = event.touches ? event.touches[0].clientX : event.clientX;
      const t = PT.util.clamp((clientX - rect.left) / rect.width, 0, 1);
      const index = Math.round(t * (curve.length - 1));
      onHover(curve[index], index);
    };
    const leave = () => onHover(null, -1);

    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerleave', leave);
    svg.addEventListener('touchmove', move, { passive: true });
    svg.addEventListener('touchend', leave);
  }

  return { area, bars, columns, rings, sparkline, trackArea };
})();
