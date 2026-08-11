/* PoTracker — renders a result card to a canvas so a session (or a whole
   period) can be shared with friends as a real image, not a screenshot. */
window.PT = window.PT || {};

PT.share = (function () {
  const W = 1080, H = 1350;
  const FONT = '"SF Pro Display", "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif';

  const GREEN = '#30d158';
  const RED   = '#ff453a';
  const DIM   = 'rgba(235,235,245,0.55)';
  const DIM_2 = 'rgba(235,235,245,0.32)';

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function text(ctx, str, x, y, opts) {
    const o = Object.assign({ size: 40, weight: 400, color: '#fff', align: 'left', tracking: 0 }, opts || {});
    ctx.font = `${o.weight} ${o.size}px ${FONT}`;
    ctx.fillStyle = o.color;
    ctx.textAlign = o.tracking ? 'left' : o.align;
    ctx.textBaseline = 'alphabetic';

    if (!o.tracking) {
      ctx.fillText(str, x, y);
      return ctx.measureText(str).width;
    }
    // Manual letter-spacing: canvas has no tracking property everywhere yet.
    const chars = String(str).split('');
    const total = chars.reduce((acc, ch) => acc + ctx.measureText(ch).width + o.tracking, -o.tracking);
    let cursor = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x;
    for (const ch of chars) {
      ctx.fillText(ch, cursor, y);
      cursor += ctx.measureText(ch).width + o.tracking;
    }
    return total;
  }

  function background(ctx, accent) {
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0d1117');
    bg.addColorStop(1, '#161b22');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // A soft wash of the result colour behind the headline number.
    const glow = ctx.createRadialGradient(W / 2, H * 0.42, 30, W / 2, H * 0.42, W * 0.72);
    glow.addColorStop(0, accent + '2e');
    glow.addColorStop(1, accent + '00');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 2;
    roundRect(ctx, 40, 40, W - 80, H - 80, 44);
    ctx.stroke();
  }

  function wordmark(ctx) {
    text(ctx, '♠  POTRACKER', W / 2, 132, { size: 26, weight: 700, color: DIM_2, align: 'center', tracking: 7 });
  }

  function statRow(ctx, stats, y) {
    const cell = (W - 160) / stats.length;
    stats.forEach((stat, i) => {
      const cx = 80 + cell * i + cell / 2;
      text(ctx, stat.label.toUpperCase(), cx, y, { size: 23, weight: 600, color: DIM_2, align: 'center', tracking: 2.5 });
      text(ctx, stat.value, cx, y + 58, { size: 44, weight: 650, color: stat.color || '#fff', align: 'center' });
    });
  }

  function divider(ctx, y) {
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(90, y);
    ctx.lineTo(W - 90, y);
    ctx.stroke();
  }

  /* ── one session ── */
  function drawSession(ctx, session) {
    const accent = session.net >= 0 ? GREEN : RED;
    background(ctx, accent);
    wordmark(ctx);

    const d = PT.util.parseDate(session.date);
    const dateStr = d
      ? `${PT.util.DAYS[d.getDay()]}, ${d.getDate()} ${PT.util.MONTHS[d.getMonth()]} ${d.getFullYear()}`
      : session.date;

    text(ctx, dateStr, W / 2, 300, { size: 32, weight: 500, color: DIM, align: 'center' });

    // Room badge
    ctx.font = `600 34px ${FONT}`;
    const roomWidth = ctx.measureText(session.room).width + 64;
    ctx.fillStyle = PT.util.roomColor(session.room) + '2b';
    roundRect(ctx, W / 2 - roomWidth / 2, 348, roomWidth, 68, 34);
    ctx.fill();
    text(ctx, session.room, W / 2, 393, { size: 34, weight: 600, color: PT.util.roomColor(session.room), align: 'center' });

    text(ctx, session.net >= 0 ? 'PROFIT' : 'LOSS', W / 2, 520, { size: 24, weight: 700, color: DIM_2, align: 'center', tracking: 6 });
    text(ctx, PT.util.signed(session.net, { decimals: Number.isInteger(session.net) ? 0 : 2 }), W / 2, 660,
      { size: 152, weight: 700, color: accent, align: 'center' });

    const meta = [session.game, session.stakes, session.table].filter(Boolean).join('  ·  ');
    if (meta) text(ctx, meta, W / 2, 720, { size: 30, weight: 500, color: DIM, align: 'center' });

    divider(ctx, 810);

    statRow(ctx, [
      { label: 'Time played', value: PT.util.hoursLabel(session.minutes) },
      { label: 'Per hour', value: session.minutes ? PT.util.signed(session.perHour, { decimals: 0 }) : '—', color: session.perHour >= 0 ? GREEN : RED },
      { label: 'ROI', value: session.invested ? `${session.roi >= 0 ? '+' : '−'}${Math.abs(Math.round(session.roi))}%` : '—', color: session.roi >= 0 ? GREEN : RED }
    ], 890);

    divider(ctx, 1010);

    statRow(ctx, [
      { label: 'Buy-in', value: PT.util.money(session.buyIn) },
      { label: 'Rebuys', value: session.rebuys ? `${session.rebuys} · ${PT.util.money(session.rebuyTotal)}` : '0' },
      { label: 'Cashed out', value: PT.util.money(session.cashOut) }
    ], 1090);

    if (session.rating) {
      const stars = '★'.repeat(session.rating) + '☆'.repeat(5 - session.rating);
      text(ctx, stars, W / 2, 1250, { size: 36, weight: 400, color: 'rgba(255,214,10,0.85)', align: 'center', tracking: 6 });
    }
  }

  /* ── a period ── */
  function drawSummary(ctx, payload) {
    const s = payload.summary;
    const accent = s.net >= 0 ? GREEN : RED;
    background(ctx, accent);
    wordmark(ctx);

    text(ctx, payload.title.toUpperCase(), W / 2, 306, { size: 26, weight: 700, color: DIM_2, align: 'center', tracking: 5 });
    text(ctx, payload.subtitle || '', W / 2, 358, { size: 30, weight: 500, color: DIM, align: 'center' });

    text(ctx, s.net >= 0 ? 'UP' : 'DOWN', W / 2, 520, { size: 24, weight: 700, color: DIM_2, align: 'center', tracking: 6 });
    text(ctx, PT.util.signed(s.net, { decimals: 0 }), W / 2, 665, { size: 152, weight: 700, color: accent, align: 'center' });

    divider(ctx, 800);
    statRow(ctx, [
      { label: 'Sessions', value: String(s.count) },
      { label: 'Hours', value: PT.util.num(s.hours, 1) },
      { label: 'Per hour', value: PT.util.signed(s.perHour, { decimals: 0 }), color: s.perHour >= 0 ? GREEN : RED }
    ], 880);

    divider(ctx, 1000);
    statRow(ctx, [
      { label: 'Win rate', value: `${Math.round(s.winRate)}%` },
      { label: 'Best', value: s.best ? PT.util.signed(s.best.net, { decimals: 0 }) : '—', color: GREEN },
      { label: 'Worst', value: s.worst ? PT.util.signed(s.worst.net, { decimals: 0 }) : '—', color: RED }
    ], 1080);

    if (payload.curve && payload.curve.length > 1) {
      drawCurve(ctx, payload.curve, accent, 90, 1180, W - 180, 96);
    }
  }

  function drawCurve(ctx, curve, accent, x, y, w, h) {
    const values = curve.map((p) => p.value);
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const span = (max - min) || 1;
    const px = (i) => x + (i / Math.max(1, curve.length - 1)) * w;
    const py = (v) => y + h - ((v - min) / span) * h;

    ctx.beginPath();
    curve.forEach((p, i) => (i === 0 ? ctx.moveTo(px(i), py(p.value)) : ctx.lineTo(px(i), py(p.value))));
    ctx.strokeStyle = accent;
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.lineTo(px(curve.length - 1), y + h);
    ctx.lineTo(px(0), y + h);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, y, 0, y + h);
    fill.addColorStop(0, accent + '40');
    fill.addColorStop(1, accent + '00');
    ctx.fillStyle = fill;
    ctx.fill();
  }

  /* ── public API ── */
  function render(kind, payload) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (kind === 'session') drawSession(ctx, payload);
    else drawSummary(ctx, payload);
    return canvas;
  }

  const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));

  function sessionText(session) {
    const lines = [
      `${session.net >= 0 ? '🟢' : '🔴'} ${PT.util.signed(session.net)} — ${session.room}`,
      `${PT.util.dateLabel(session.date)} · ${PT.util.hoursLabel(session.minutes)}${session.stakes ? ' · ' + session.stakes : ''}`,
      `${PT.util.signed(session.perHour, { decimals: 0 })}/h${session.invested ? ` · ROI ${session.roi >= 0 ? '+' : '−'}${Math.abs(Math.round(session.roi))}%` : ''}`
    ];
    return lines.join('\n');
  }

  function summaryText(title, s) {
    return [
      `${s.net >= 0 ? '🟢' : '🔴'} ${title}: ${PT.util.signed(s.net)}`,
      `${s.count} sessions · ${PT.util.num(s.hours, 1)}h · ${PT.util.signed(s.perHour, { decimals: 0 })}/h`,
      `Win rate ${Math.round(s.winRate)}%`
    ].join('\n');
  }

  /** Share sheet on mobile, download + clipboard everywhere else. */
  async function shareCanvas(canvas, filename, message) {
    const blob = await toBlob(canvas);
    if (!blob) throw new Error('Could not render the card');
    const file = new File([blob], filename, { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: message });
        return 'shared';
      } catch (err) {
        if (err && err.name === 'AbortError') return 'cancelled';
      }
    }
    PT.util.download(filename, blob);
    try { await navigator.clipboard.writeText(message); } catch (_) { /* clipboard may be blocked */ }
    return 'downloaded';
  }

  return { render, toBlob, shareCanvas, sessionText, summaryText };
})();
