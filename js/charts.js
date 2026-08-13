/* PoTracker — hand-rolled SVG charts. No chart library, no external requests,
   and every colour comes from the CSS variables so light/dark just works. */
window.PT = window.PT || {};

PT.charts = (function () {
  let gradientSeq = 0;

  /* ── cumulative profit curve ──────────────────────────────────────────
     Straight segments on purpose: a smoothed spline would invent profit
     between two sessions that never existed.

     The horizontal axis is time, not session number. Evenly spaced points
     would draw a fortnight off and two hands in one night as the same
     distance, which makes the shape of a month unreadable. So the line
     starts flat at zero on the first day of the range, steps on the days
     you actually played, and runs flat to today. */

  /** When a session sits on the clock. Same-day sessions need separating. */
  function sessionTime(point) {
    const date = PT.util.parseDate(point.date);
    if (!date) return null;
    const [h, m] = String((point.session && point.session.start) || '12:00').split(':').map(Number);
    date.setHours(Number.isNaN(h) ? 12 : h, Number.isNaN(m) ? 0 : m, 0, 0);
    return date.getTime();
  }

  /** Three or four dates along the bottom, worded for how long the range is. */
  function axisTicks(from, to, count) {
    const days = (to - from) / 86400000;
    const label = (ms) => {
      const d = new Date(ms);
      if (days <= 14) return PT.util.DAYS_SHORT[d.getDay()];
      if (days <= 130) return `${d.getDate()} ${PT.util.MONTHS_SHORT[d.getMonth()]}`;
      const year = d.getFullYear() === new Date().getFullYear() ? '' : ` ${String(d.getFullYear()).slice(2)}`;
      return `${PT.util.MONTHS_SHORT[d.getMonth()]}${year}`;
    };
    const ticks = [];
    for (let i = 0; i < count; i += 1) {
      const ms = from + ((to - from) * i) / (count - 1);
      ticks.push({ ms, text: label(ms) });
    }
    return ticks;
  }

  function area(curve, opts) {
    const o = Object.assign({ width: 680, height: 190, pad: 14, axisHeight: 20, from: null }, opts || {});
    if (!curve || curve.length === 0) {
      return '<div class="chart-empty">No sessions in this range</div>';
    }

    const W = o.width, H = o.height, P = o.pad;
    const plotBottom = H - o.axisHeight;

    /* Time domain: the whole selected range when we know it, so an empty
       fortnight reads as an empty fortnight instead of vanishing. */
    const times = curve.map(sessionTime).map((t, i) => (t === null ? i : t));
    const startOfRange = o.from ? o.from.getTime() : times[0];
    const from = Math.min(startOfRange, times[0]);
    const to = Math.max(Date.now(), times[times.length - 1]);
    const timeSpan = Math.max(to - from, 3600000);

    const values = curve.map((p) => p.value);
    let min = Math.min(0, ...values);
    let max = Math.max(0, ...values);
    if (min === max) { min -= 1; max += 1; }
    const valueSpan = max - min;

    const x = (t) => P + ((t - from) / timeSpan) * (W - P * 2);
    const y = (v) => P + (1 - (v - min) / valueSpan) * (plotBottom - P * 2);

    /* Sessions played hours apart land on the same pixel, and one of them
       disappears under the other. Nudge them along so every session keeps a
       dot you can aim at — a couple of pixels of licence, in the order they
       were played, rather than a session you cannot see or select. */
    const xs = [];
    curve.forEach((p, i) => {
      const wanted = x(times[i]);
      xs.push(i === 0 ? wanted : Math.max(wanted, xs[i - 1] + 5));
    });
    const overflow = Math.max(0, xs[xs.length - 1] - (W - P));
    if (overflow > 0) for (let i = 0; i < xs.length; i += 1) xs[i] -= overflow * (i / (xs.length - 1 || 1));

    // Flat at zero until the first session, flat again from the last to now.
    const last = values[values.length - 1];
    const nodes = [{ x: x(from), v: 0 }]
      .concat(curve.map((p, i) => ({ x: xs[i], v: p.value })))
      .concat([{ x: Math.max(x(to), xs[xs.length - 1]), v: last }]);
    const colorVar = last >= 0 ? 'var(--green)' : 'var(--red)';
    const gid = `ptGrad${++gradientSeq}`;

    const line = nodes.map((n, i) => `${i === 0 ? 'M' : 'L'}${n.x.toFixed(1)},${y(n.v).toFixed(1)}`).join(' ');
    const fill = `${line} L${nodes[nodes.length - 1].x.toFixed(1)},${plotBottom.toFixed(1)} L${nodes[0].x.toFixed(1)},${plotBottom.toFixed(1)} Z`;
    const zeroY = y(0);

    // Each session gets a dot while there are few enough to aim at.
    const dots = curve.length <= 24 ? curve.map((p, i) =>
      `<circle cx="${xs[i].toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="2.6"
               style="fill:${colorVar}" opacity=".55"/>`).join('') : '';

    const ticks = axisTicks(from, to, W < 380 ? 3 : 4).map((tick, i, all) => {
      const anchor = i === 0 ? 'start' : i === all.length - 1 ? 'end' : 'middle';
      const tx = PT.util.clamp(x(tick.ms), P, W - P);
      return `<text class="chart-tick" x="${tx.toFixed(1)}" y="${(H - 5).toFixed(1)}" text-anchor="${anchor}">${PT.util.esc(tick.text)}</text>`;
    }).join('');

    const lastX = xs[xs.length - 1];
    const lastY = y(last);
    const geom = curve.map((p, i) => `${xs[i].toFixed(1)},${y(p.value).toFixed(1)}`).join(';');

    return `
<svg class="chart" viewBox="0 0 ${W} ${H}" style="height:${H}px" data-geom="${geom}"
     role="img" aria-label="Cumulative profit over time">
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
        stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}
  <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4" style="fill:${colorVar}"/>
  <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="8" style="fill:${colorVar}" opacity=".22"/>
  ${ticks}
  <g class="chart-scrub" opacity="0">
    <line y1="${P}" y2="${plotBottom.toFixed(1)}" style="stroke:var(--label-2)" stroke-width="1" stroke-dasharray="3 3"/>
    <circle r="5.5" style="fill:${colorVar};stroke:var(--bg-elev)" stroke-width="2.5"/>
  </g>
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
    const o = Object.assign({
      height: 150,
      value: (d) => d.net,
      label: (d) => d.key,
      format: (v) => PT.util.signed(v, { decimals: 0 }),
      // Time is never a win or a loss: colouring it green would read as good.
      neutral: false
    }, opts || {});
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
        const text = o.format(v, d);
        return `<div class="col-item">
          <div class="col-track">
            <div class="col-bar ${o.neutral ? 'is-flat' : up ? 'is-up' : 'is-down'}"
                 style="height:${pct.toFixed(2)}%;${up ? `bottom:${(100 - zeroPct).toFixed(2)}%` : `top:${zeroPct.toFixed(2)}%`}"
                 title="${PT.util.esc(o.label(d))}: ${PT.util.esc(text)}"></div>
          </div>
          <div class="col-label">${PT.util.esc(o.label(d))}</div>
          <div class="col-value ${o.neutral ? '' : PT.util.tone(v)}">${PT.util.esc(text)}</div>
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

  /** Follow the pointer across the profit curve and report the nearest point.
      Snaps to real sessions: between two of them there is nothing to read. */
  function trackArea(container, curve, onHover) {
    const svg = container.querySelector('svg.chart');
    if (!svg || !curve.length) return;

    const geom = (svg.dataset.geom || '').split(';').filter(Boolean)
      .map((pair) => pair.split(',').map(Number));
    if (geom.length !== curve.length) return;

    const scrub = svg.querySelector('.chart-scrub');
    const scrubLine = scrub.querySelector('line');
    const scrubDot = scrub.querySelector('circle');
    const viewWidth = svg.viewBox.baseVal.width;

    const move = (event) => {
      const rect = svg.getBoundingClientRect();
      const clientX = event.touches ? event.touches[0].clientX : event.clientX;
      const ux = ((clientX - rect.left) / rect.width) * viewWidth;

      let index = 0;
      for (let i = 1; i < geom.length; i += 1) {
        if (Math.abs(geom[i][0] - ux) < Math.abs(geom[index][0] - ux)) index = i;
      }

      scrub.setAttribute('opacity', '1');
      scrubLine.setAttribute('x1', geom[index][0]);
      scrubLine.setAttribute('x2', geom[index][0]);
      scrubDot.setAttribute('cx', geom[index][0]);
      scrubDot.setAttribute('cy', geom[index][1]);
      onHover(curve[index], index);
    };
    const leave = () => {
      scrub.setAttribute('opacity', '0');
      onHover(null, -1);
    };

    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', leave);
    svg.addEventListener('pointerup', leave);
    svg.addEventListener('touchmove', move, { passive: true });
    svg.addEventListener('touchend', leave);
  }

  return { area, bars, columns, rings, sparkline, trackArea };
})();
