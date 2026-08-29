/* PoTracker — every derived number the app shows is computed here. */
window.PT = window.PT || {};

PT.stats = (function () {
  const RANGES = [
    { id: '7d',  label: '7D'  },
    { id: '30d', label: '30D' },
    { id: '90d', label: '3M'  },
    { id: 'ytd', label: 'YTD' },
    { id: 'all', label: 'All' }
  ];

  /** First date (inclusive) of a range, or null for "everything". */
  function rangeStart(range) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    switch (range) {
      case '7d':  return new Date(today.getTime() - 6 * 86400000);
      case '30d': return new Date(today.getTime() - 29 * 86400000);
      case '90d': return new Date(today.getTime() - 89 * 86400000);
      case 'ytd': return new Date(today.getFullYear(), 0, 1);
      default:    return null;
    }
  }

  function inRange(sessions, range) {
    const start = rangeStart(range);
    if (!start) return sessions.slice();
    const iso = PT.util.isoDate(start);
    return sessions.filter((s) => s.date >= iso);
  }

  const rangeLabel = (range) => ({
    '7d':  'Last 7 days',
    '30d': 'Last 30 days',
    '90d': 'Last 3 months',
    'ytd': 'This year',
    'all': 'All time'
  }[range] || 'All time');

  /* ── headline numbers ── */
  function summary(sessions) {
    const count = sessions.length;
    const net      = PT.util.sum(sessions, (s) => s.net);
    const minutes  = PT.util.sum(sessions, (s) => s.minutes);
    const invested = PT.util.sum(sessions, (s) => s.invested);
    const hours    = minutes / 60;
    // Volume only counts the sessions that recorded how many tables it was.
    const tableHours = PT.util.sum(sessions, (s) => s.tableHours || 0);
    const wins   = sessions.filter((s) => s.net > 0).length;
    const losses = sessions.filter((s) => s.net < 0).length;

    const sorted = sessions.slice().sort((a, b) => b.net - a.net);
    const best  = sorted[0] || null;
    const worst = sorted[sorted.length - 1] || null;

    return {
      count, net, minutes, hours, invested, wins, losses, tableHours,
      perHour:  hours > 0 ? net / hours : 0,
      perTableHour: tableHours > 0 ? net / tableHours : 0,
      winRate:  count ? (wins / count) * 100 : 0,
      roi:      invested > 0 ? (net / invested) * 100 : 0,
      avgNet:   count ? net / count : 0,
      avgMinutes: count ? minutes / count : 0,
      best:  best && best.net > 0 ? best : null,
      worst: worst && worst.net < 0 ? worst : null,
      rebuys: PT.util.sum(sessions, (s) => s.rebuys)
    };
  }

  /* ── cumulative profit curve (oldest → newest) ── */
  function cumulative(sessions) {
    const ordered = sessions.slice().sort(PT.util.chrono);
    let running = 0;
    return ordered.map((s, i) => {
      running += s.net;
      return { i, date: s.date, net: s.net, value: running, session: s };
    });
  }

  /* ── the curve you actually look at ──────────────────────────────────
     One point per session makes a month of grinding unreadable: three
     sessions on Saturday sit on top of each other while the empty week
     after them is a flat line, and the eye reads a saw blade instead of a
     trend. So the line is bucketed by time — days over a week or a month,
     weeks over a quarter, months over a year — and each point carries what
     that whole period made. A period with no poker in it is not a gap: it
     is a flat stretch, which is the truth. */

  const DAY = 86400000;
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const startOfWeek = (d) => {
    const day = startOfDay(d);
    day.setDate(day.getDate() - ((day.getDay() + 6) % 7)); // Monday
    return day;
  };
  const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);

  /** How wide a bucket has to be to keep the line readable. */
  function bucketUnit(from, to) {
    const days = (to - from) / DAY;
    if (days <= 45) return 'day';
    if (days <= 200) return 'week';
    return 'month';
  }

  const UNITS = {
    day:   { start: startOfDay,   next: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) },
    week:  { start: startOfWeek,  next: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7) },
    month: { start: startOfMonth, next: (d) => new Date(d.getFullYear(), d.getMonth() + 1, 1) }
  };

  function bucketLabel(unit, from, to) {
    if (unit === 'day') return PT.util.dateLabel(PT.util.isoDate(from));
    if (unit === 'month') {
      const sameYear = from.getFullYear() === new Date().getFullYear();
      return `${PT.util.MONTHS[from.getMonth()]}${sameYear ? '' : ' ' + from.getFullYear()}`;
    }
    const last = new Date(to.getTime() - DAY);
    const sameMonth = last.getMonth() === from.getMonth();
    return `${from.getDate()}${sameMonth ? '' : ' ' + PT.util.MONTHS_SHORT[from.getMonth()]}–${last.getDate()} ${PT.util.MONTHS_SHORT[last.getMonth()]}`;
  }

  /**
   * Cumulative profit sampled over time rather than per session.
   * @returns {{unit: string, from: Date, to: Date, points: Array}}
   */
  function series(sessions, range) {
    const ordered = sessions.slice().sort(PT.util.chrono);
    const today = startOfDay(new Date());
    const firstPlayed = ordered.length ? PT.util.parseDate(ordered[0].date) : today;
    const windowStart = rangeStart(range) || firstPlayed;
    const from = new Date(Math.min(windowStart.getTime(), firstPlayed.getTime()));

    const unit = bucketUnit(from.getTime(), today.getTime() + DAY);
    const { start, next } = UNITS[unit];

    const points = [];
    for (let edge = start(from); edge <= today; edge = next(edge)) {
      const to = next(edge);
      points.push({
        t: edge.getTime(), from: edge, to,
        label: bucketLabel(unit, edge, to),
        net: 0, count: 0, value: 0
      });
    }
    if (!points.length) return { unit, from, to: today, points: [] };

    for (const s of ordered) {
      const date = PT.util.parseDate(s.date);
      if (!date) continue;
      // Anything before the window (it cannot be after) belongs to the first bucket.
      let index = 0;
      for (let i = points.length - 1; i >= 0; i -= 1) {
        if (date.getTime() >= points[i].t) { index = i; break; }
      }
      points[index].net += s.net;
      points[index].count += 1;
    }

    let running = 0;
    for (const point of points) {
      running += point.net;
      point.value = running;
    }
    return { unit, from, to: today, points };
  }

  /** Worst peak-to-trough dip on the cumulative curve. */
  function maxDrawdown(curve) {
    let peak = 0;
    let worst = 0;
    for (const point of curve) {
      if (point.value > peak) peak = point.value;
      worst = Math.min(worst, point.value - peak);
    }
    return worst;
  }

  /** Longest run of winning and of losing sessions, plus the current one. */
  function streaks(sessions) {
    const ordered = sessions.slice().sort(PT.util.chrono);
    let bestWin = 0, bestLoss = 0, runWin = 0, runLoss = 0;
    for (const s of ordered) {
      if (s.net > 0) { runWin += 1; runLoss = 0; }
      else if (s.net < 0) { runLoss += 1; runWin = 0; }
      else { runWin = 0; runLoss = 0; }
      bestWin = Math.max(bestWin, runWin);
      bestLoss = Math.max(bestLoss, runLoss);
    }
    const current = runWin > 0 ? runWin : runLoss > 0 ? -runLoss : 0;
    return { bestWin, bestLoss, current };
  }

  /* ── breakdowns ── */
  function groupBy(sessions, keyFn) {
    const map = new Map();
    for (const s of sessions) {
      const key = keyFn(s);
      if (key === null || key === undefined || key === '') continue;
      if (!map.has(key)) map.set(key, { key, net: 0, minutes: 0, count: 0, invested: 0, wins: 0 });
      const bucket = map.get(key);
      bucket.net      += s.net;
      bucket.minutes  += s.minutes;
      bucket.invested += s.invested;
      bucket.count    += 1;
      if (s.net > 0) bucket.wins += 1;
    }
    return Array.from(map.values()).map((b) => Object.assign(b, {
      hours:   b.minutes / 60,
      perHour: b.minutes > 0 ? b.net / (b.minutes / 60) : 0,
      winRate: b.count ? (b.wins / b.count) * 100 : 0
    }));
  }

  const byRoom   = (sessions) => groupBy(sessions, (s) => s.room).sort((a, b) => b.net - a.net);
  const byGame   = (sessions) => groupBy(sessions, (s) => s.game).sort((a, b) => b.net - a.net);
  const byStakes = (sessions) => groupBy(sessions, (s) => s.stakes).sort((a, b) => b.net - a.net);

  /** Sunday-first, always all seven days so the chart shape stays stable. */
  function byWeekday(sessions) {
    const buckets = PT.util.DAYS_SHORT.map((label) => ({ key: label, net: 0, minutes: 0, count: 0 }));
    for (const s of sessions) {
      const d = PT.util.parseDate(s.date);
      if (!d) continue;
      const bucket = buckets[d.getDay()];
      bucket.net += s.net;
      bucket.minutes += s.minutes;
      bucket.count += 1;
    }
    // Monday-first reads better in Europe.
    return buckets.slice(1).concat(buckets.slice(0, 1))
      .map((b) => Object.assign(b, { hours: b.minutes / 60, perHour: b.minutes > 0 ? b.net / (b.minutes / 60) : 0 }));
  }

  /** Profit grouped by the hour of day the session started. */
  function byStartHour(sessions) {
    const buckets = [
      { key: 'Morning',   from: 6,  to: 12 },
      { key: 'Afternoon', from: 12, to: 18 },
      { key: 'Evening',   from: 18, to: 23 },
      { key: 'Late night',from: 23, to: 6  }
    ].map((b) => Object.assign(b, { net: 0, minutes: 0, count: 0 }));

    for (const s of sessions) {
      if (!s.start) continue;
      const hour = Number(String(s.start).split(':')[0]);
      if (Number.isNaN(hour)) continue;
      const bucket = buckets.find((b) => (b.from < b.to ? hour >= b.from && hour < b.to : hour >= b.from || hour < b.to));
      if (!bucket) continue;
      bucket.net += s.net;
      bucket.minutes += s.minutes;
      bucket.count += 1;
    }
    return buckets.filter((b) => b.count > 0)
      .map((b) => Object.assign(b, { hours: b.minutes / 60, perHour: b.minutes > 0 ? b.net / (b.minutes / 60) : 0 }));
  }

  /** Does a long session help or hurt? */
  function bySessionLength(sessions) {
    const buckets = [
      { key: '< 1h',  min: 0,   max: 60   },
      { key: '1–2h',  min: 60,  max: 120  },
      { key: '2–4h',  min: 120, max: 240  },
      { key: '4h+',   min: 240, max: 1e9  }
    ].map((b) => Object.assign(b, { net: 0, minutes: 0, count: 0 }));

    for (const s of sessions) {
      if (!s.minutes) continue;
      const bucket = buckets.find((b) => s.minutes >= b.min && s.minutes < b.max);
      if (!bucket) continue;
      bucket.net += s.net;
      bucket.minutes += s.minutes;
      bucket.count += 1;
    }
    return buckets.filter((b) => b.count > 0)
      .map((b) => Object.assign(b, { hours: b.minutes / 60, perHour: b.minutes > 0 ? b.net / (b.minutes / 60) : 0 }));
  }


  /* ── multi-tabling ────────────────────────────────────────────────────
     A second table doubles the hands you see in an hour and halves the
     attention each one gets. Which of the two wins is a question about you,
     not about poker, and the only number that answers it is money per hour
     of your life. Money per table-hour always falls as you add tables —
     that is arithmetic, not a verdict. It is here to show what the volume
     costs you, never to pick the winner. */

  const TABLE_BANDS = [
    { key: '1',   label: '1 table',    min: 0,   max: 1.5 },
    { key: '2',   label: '2 tables',   min: 1.5, max: 2.5 },
    { key: '3-4', label: '3–4 tables', min: 2.5, max: 4.5 },
    { key: '5-6', label: '5–6 tables', min: 4.5, max: 6.5 },
    { key: '7+',  label: '7+ tables',  min: 6.5, max: Infinity }
  ];

  /* Multi-tabling is an online cash idea. An MTT busted in level three and a
     six-hour deep run are both "one table", and neither says anything about
     how many you can handle, so cash is what the comparison defaults to. */
  const CASH_GAMES = ['Cash NLHE', 'Cash PLO', 'Fast-fold'];

  const TABLE_SCOPES = [
    { id: 'cash', label: 'Cash' },
    { id: 'all',  label: 'Everything' }
  ];

  // Zero is not the bottom band, it is the absence of one.
  const bandFor = (tables) => (tables > 0
    ? TABLE_BANDS.find((b) => tables >= b.min && tables < b.max) || null
    : null);

  /** Sessions carrying a table count and enough clock to rate. */
  function tableScoped(sessions, scope) {
    const counted = sessions.filter((s) => s.tables > 0 && s.minutes > 0);
    return scope === 'all' ? counted : counted.filter((s) => CASH_GAMES.includes(s.game));
  }

  /* ── what the timer measured ──────────────────────────────────────────
     Tables are not a fact about a session, they are something that changes
     inside it: you open a fourth when it runs well and drop to two when you
     are tired. Asked afterwards you would guess, so the running timer stamps
     every change instead, and the session ends up with a time-weighted
     average and the log that produced it. */

  /** Fold the timer's stamps into segments and their weighted average. */
  function tableAverage(marks, endMs) {
    const list = (marks || [])
      .filter((m) => m && Number.isFinite(m.at) && m.at <= endMs)
      .sort((a, b) => a.at - b.at);
    if (!list.length) return { tables: 0, log: '' };

    const segments = [];
    list.forEach((m, i) => {
      const until = i + 1 < list.length ? list[i + 1].at : endMs;
      const minutes = Math.round(Math.max(0, until - m.at) / 60000);
      const tables = Math.max(1, Math.round(Number(m.tables) || 1));
      if (!minutes) return;
      // Up and straight back down leaves no segment behind.
      const last = segments[segments.length - 1];
      if (last && last.tables === tables) last.minutes += minutes;
      else segments.push({ tables, minutes });
    });

    const total = segments.reduce((sum, s) => sum + s.minutes, 0);
    const lastCount = Math.max(1, Math.round(Number(list[list.length - 1].tables) || 1));
    // Nothing lasted a whole minute: too short to average, still one count.
    if (!total) return { tables: lastCount, log: '' };

    const weighted = segments.reduce((sum, s) => sum + s.tables * s.minutes, 0) / total;
    return {
      tables: Math.round(weighted * 10) / 10,
      // Only worth keeping when it says something the average does not.
      log: segments.length > 1 ? segments.map((s) => s.tables + 'x' + s.minutes).join('|') : ''
    };
  }

  /** "4x37|3x21" back into segments. */
  function parseTableLog(log) {
    return String(log || '').split('|').map((part) => {
      const bits = part.split('x');
      return { tables: Number(bits[0]), minutes: Number(bits[1]) };
    }).filter((s) => s.tables > 0 && s.minutes > 0);
  }

  /* ── the bands ── */

  /** What a band was mostly made of, so moving up in stakes at the same time
      as moving up in tables does not get read as a table effect. */
  function dominantMix(sessions) {
    const tally = new Map();
    let total = 0;
    for (const s of sessions) {
      const key = [s.game, s.stakes].filter(Boolean).join(' · ');
      tally.set(key, (tally.get(key) || 0) + s.minutes);
      total += s.minutes;
    }
    let top = null;
    tally.forEach((minutes, key) => { if (!top || minutes > top.minutes) top = { key, minutes }; });
    return top && total ? { key: top.key, share: top.minutes / total } : null;
  }

  function byTableBand(sessions) {
    const map = new Map();
    for (const s of sessions) {
      const band = bandFor(s.tables);
      if (!band) continue;
      if (!map.has(band.key)) {
        map.set(band.key, {
          key: band.key, label: band.label, order: TABLE_BANDS.indexOf(band),
          net: 0, minutes: 0, tableMinutes: 0, invested: 0, count: 0, wins: 0, sessions: []
        });
      }
      const b = map.get(band.key);
      b.net          += s.net;
      b.minutes      += s.minutes;
      b.tableMinutes += s.minutes * s.tables;
      b.invested     += s.invested;
      b.count        += 1;
      if (s.net > 0) b.wins += 1;
      b.sessions.push(s);
    }
    return Array.from(map.values()).sort((a, b) => a.order - b.order).map((b) => Object.assign(b, {
      hours:        b.minutes / 60,
      tableHours:   b.tableMinutes / 60,
      avgTables:    b.minutes > 0 ? b.tableMinutes / b.minutes : 0,
      perHour:      b.minutes > 0 ? b.net / (b.minutes / 60) : 0,
      perTableHour: b.tableMinutes > 0 ? b.net / (b.tableMinutes / 60) : 0,
      roi:          b.invested > 0 ? (b.net / b.invested) * 100 : 0,
      winRate:      b.count ? (b.wins / b.count) * 100 : 0,
      mix:          dominantMix(b.sessions)
    }));
  }

  /* ── is the gap real, or was one of them a good month? ────────────────
     Hourly rates swing far enough that the winning band is usually just the
     luckier one, and a table of averages hides that completely. So rather
     than trust the gap, the app resamples what it has — drawing whole
     sessions back out with replacement, a couple of thousand times — and
     reports the range the difference lands in 90% of the time. While that
     range still contains zero the honest answer is "not yet", and the app
     says so instead of crowning a winner. */

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const hourlyRate = (list) => {
    let net = 0, minutes = 0;
    for (const s of list) { net += s.net; minutes += s.minutes; }
    return minutes > 0 ? net / (minutes / 60) : 0;
  };

  /** 90% interval for hourlyRate(b) − hourlyRate(a). */
  function rateDifference(a, b, iterations) {
    const iters = iterations || 2000;
    // Seeded from the data itself, so the same sessions always give the same
    // interval and the figure does not wobble between two renders.
    const seed = Math.abs(Math.round(hourlyRate(a) * 100 + hourlyRate(b) * 977))
      + a.length * 7919 + b.length * 104729;
    const rand = mulberry32(seed);

    const resample = (list) => {
      let net = 0, minutes = 0;
      for (let i = 0; i < list.length; i += 1) {
        const s = list[(rand() * list.length) | 0];
        net += s.net; minutes += s.minutes;
      }
      return minutes > 0 ? net / (minutes / 60) : 0;
    };

    const draws = new Array(iters);
    for (let i = 0; i < iters; i += 1) draws[i] = resample(b) - resample(a);
    draws.sort((x, y) => x - y);
    const at = (p) => draws[PT.util.clamp(Math.round(p * (iters - 1)), 0, iters - 1)];
    return { lo: at(0.05), hi: at(0.95) };
  }

  /** Roughly how much more of both it would take for the interval to clear
      zero, given it narrows with the square root of the sample. */
  function hoursToDecide(have, lo, hi, delta) {
    const half = (hi - lo) / 2;
    if (!(half > 0) || !(Math.abs(delta) > 0) || !(have > 0)) return null;
    const extra = have * Math.pow(half / Math.abs(delta), 2) - have;
    return Number.isFinite(extra) && extra > 0 ? extra : null;
  }

  /* A band is only rated once there is enough of it to be worth comparing.
     Below this its average is noise wearing a number. */
  const BAND_MIN_SESSIONS = 5;
  const BAND_MIN_HOURS = 5;

  function multitabling(sessions, scope) {
    const eligible = tableScoped(sessions, scope);
    const missing = sessions.filter((s) => s.minutes > 0 && !(s.tables > 0)).length;
    const bands = byTableBand(eligible);
    const rated = bands.filter((b) => b.count >= BAND_MIN_SESSIONS && b.hours >= BAND_MIN_HOURS);

    let comparison = null;
    if (rated.length >= 2) {
      // The fewest tables you play enough of is the thing to beat.
      const baseline = rated[0];
      const best = rated.reduce((a, b) => (b.perHour > a.perHour ? b : a));
      if (best.key !== baseline.key) {
        const spread = rateDifference(baseline.sessions, best.sessions);
        const delta = best.perHour - baseline.perHour;
        const decided = spread.lo > 0 || spread.hi < 0;
        comparison = {
          baseline, best, delta, lo: spread.lo, hi: spread.hi, decided,
          hoursNeeded: decided ? null : hoursToDecide(baseline.hours + best.hours, spread.lo, spread.hi, delta),
          // Same tables but different stakes is a different experiment.
          confounded: Boolean(baseline.mix && best.mix && baseline.mix.key !== best.mix.key
            && baseline.mix.share > 0.5 && best.mix.share > 0.5)
        };
      }
    }

    const minutes = eligible.reduce((sum, s) => sum + s.minutes, 0);
    const tableMinutes = eligible.reduce((sum, s) => sum + s.minutes * s.tables, 0);
    return {
      scope: scope === 'all' ? 'all' : 'cash',
      bands, rated, comparison,
      tracked: eligible.length,
      missing,
      hours: minutes / 60,
      tableHours: tableMinutes / 60,
      avgTables: minutes > 0 ? tableMinutes / minutes : 0
    };
  }

  /* ── months ── */
  function byMonth(sessions) {
    const map = new Map();
    for (const s of sessions) {
      const key = PT.util.monthKey(s.date);
      if (!key) continue;
      if (!map.has(key)) map.set(key, { key, net: 0, minutes: 0, count: 0 });
      const bucket = map.get(key);
      bucket.net += s.net;
      bucket.minutes += s.minutes;
      bucket.count += 1;
    }
    return Array.from(map.values())
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .map((b) => Object.assign(b, { hours: b.minutes / 60 }));
  }

  /** Progress towards this month's goal, as three 0–1 ratios for the rings. */
  function monthProgress(sessions, goals) {
    const key = PT.util.monthKey(PT.util.isoDate());
    const goal = (goals || []).find((g) => g.month === key) || null;
    const mine = sessions.filter((s) => PT.util.monthKey(s.date) === key);
    const done = {
      profit:   PT.util.sum(mine, (s) => s.net),
      hours:    PT.util.sum(mine, (s) => s.minutes) / 60,
      sessions: mine.length
    };
    const target = {
      profit:   goal ? goal.profit : 0,
      hours:    goal ? goal.hours : 0,
      sessions: goal ? goal.sessions : 0
    };
    const ratio = (a, b) => (b > 0 ? PT.util.clamp(a / b, 0, 1.4) : 0);
    return {
      key, goal, done, target,
      ratios: {
        profit:   ratio(done.profit, target.profit),
        hours:    ratio(done.hours, target.hours),
        sessions: ratio(done.sessions, target.sessions)
      },
      hasGoal: Boolean(goal && (target.profit || target.hours || target.sessions))
    };
  }

  /* ── rooms & bankroll ─────────────────────────────────────────────────
     Money model, kept deliberately explicit because it is easy to get wrong:

       balance = deposited − withdrawn + bonuses + played + adjustments

     A buy-in is NOT money leaving the room — it just moves your own money
     from the room's cashier onto a table and back again. Only deposits,
     withdrawals and results change what a room actually holds. Buy-ins and
     rebuys are therefore tracked for ROI and risk, never for the balance.

     On top of that sum sits `unexplained`: the gap between the log and the
     last balance you actually read off the cashier. Keeping it as its own
     line means the balance shown matches reality without pretending the
     difference was profit. */

  /** Signed effect of a cash movement on what a room holds. */
  function movementDelta(e) {
    if (e.type === 'Deposit')    return Math.abs(e.amount);
    if (e.type === 'Withdrawal') return -Math.abs(e.amount);
    if (e.type === 'Bonus' || e.type === 'Rakeback') return Math.abs(e.amount);
    return e.amount; // Result and Adjustment are already signed
  }

  /** How much of a room's last known balance the logged history cannot explain. */
  function unexplainedIn(room, sessions, entries) {
    const mine = (sessions || []).filter((s) => s.room === room).sort(PT.util.chrono);
    const anchor = anchorFor(mine);
    if (!anchor) return 0;

    // Everything up to and including the anchor — the mirror image of the
    // "after the anchor" split balanceBefore() replays.
    const upto = mine.filter((s) => PT.util.chrono(s, anchor) <= 0);
    const cash = (entries || []).filter((e) => e.room === room && e.date
      && (e.date < anchor.date
        || (e.date === anchor.date && (e.created || 0) <= (anchor.created || 0))));

    let logged = 0;
    for (const s of upto) logged += s.net;
    for (const e of cash) logged += movementDelta(e);
    return (Number(anchor.closing) || 0) - logged;
  }

  function roomLedger(sessions, entries) {
    const map = new Map();
    const touch = (room) => {
      if (!map.has(room)) {
        map.set(room, {
          key: room, deposited: 0, withdrawn: 0, bonuses: 0,
          played: 0, adjustments: 0, sessions: 0, minutes: 0, wagered: 0, rebuys: 0
        });
      }
      return map.get(room);
    };

    for (const s of sessions) {
      const r = touch(s.room);
      r.played  += s.net;
      r.wagered += s.invested;
      r.rebuys  += s.rebuys;
      r.minutes += s.minutes;
      r.sessions += 1;
    }

    for (const e of (entries || [])) {
      const r = touch(e.room);
      if (e.type === 'Deposit')          r.deposited += Math.abs(e.amount);
      else if (e.type === 'Withdrawal')  r.withdrawn += Math.abs(e.amount);
      else if (e.type === 'Bonus' || e.type === 'Rakeback') r.bonuses += Math.abs(e.amount);
      else if (e.type === 'Result')      r.played += e.amount;      // signed: unlogged play
      else                               r.adjustments += e.amount; // signed
    }

    return Array.from(map.values()).map((r) => {
      const unexplained = unexplainedIn(r.key, sessions, entries);
      return Object.assign(r, {
        unexplained,
        balance: r.deposited - r.withdrawn + r.bonuses + r.played + r.adjustments + unexplained,
        // What the room has actually made you, ignoring your own money.
        profit: r.played + r.bonuses,
        atRisk: r.deposited - r.withdrawn,
        hours: r.minutes / 60
      });
    }).sort((a, b) => b.balance - a.balance);
  }

  /** The same numbers rolled up across every room. */
  function bankrollSummary(sessions, entries) {
    const rooms = roomLedger(sessions, entries);
    const total = (fn) => PT.util.sum(rooms, fn);
    const bonuses = total((r) => r.bonuses);
    const adjustments = total((r) => r.adjustments);
    return {
      rooms,
      deposits:    total((r) => r.deposited),
      withdrawals: total((r) => r.withdrawn),
      bonuses, adjustments,
      unexplained: total((r) => r.unexplained),
      played:      total((r) => r.played),
      current:     total((r) => r.balance),
      profit:      total((r) => r.profit),
      // Kept under their original names so the Bankroll card stays as it was.
      extras:      bonuses + adjustments,
      netProfit:   total((r) => r.played),
      lifetime:    total((r) => r.profit)
    };
  }

  /** Balance per room, for the existing "balance by room" chart. */
  function bankrollByRoom(sessions, entries) {
    return roomLedger(sessions, entries).map((r) => ({ key: r.key, net: r.balance }));
  }

  /** Balance a room should hold right now, used to reconcile against reality. */
  function expectedBalance(room, sessions, entries) {
    const found = roomLedger(sessions, entries).find((r) => r.key === room);
    return found ? found.balance : 0;
  }

  /* ── logging a session by its closing balance ─────────────────────────
     Instead of adding up what you won, you type the one number already on
     screen: what the room holds when you stand up. The result is then

       net = closing balance − whatever the room held before this session

     and "whatever it held before" is read off the **last session you closed**,
     not off your deposits. Anything else drifts: one session typed by cash-out,
     one figure fixed by hand in Airtable, and every later result would be
     measured against a running total that no longer matches the cashier.

     Rebuys need no correction: taking another 20 € onto the table moves your
     own money inside the room, so the room's balance never changed. Topping
     the room up with NEW money does change it, which is why that has to be
     logged as a deposit — it then lands in the "before" figure below. */

  /** The last session in an ordered list whose closing balance we can trust. */
  function anchorFor(ordered) {
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      if (ordered[i].closing !== null && ordered[i].closing !== undefined) return ordered[i];
    }
    return null;
  }

  /**
   * What `room` held immediately before `session`.
   * @param {object} session the session being logged or edited (may have no id yet)
   * @param {string} [excludeId] session id to leave out, when editing
   */
  function balanceBefore(session, sessions, entries, excludeId) {
    const room = session.room;

    const earlier = (sessions || [])
      .filter((s) => s.room === room && s.id !== excludeId && PT.util.chrono(s, session) < 0)
      .sort(PT.util.chrono);

    // Cash movements are only dated, so treat them as happening before any
    // session played that same day — which is the order you actually do it in.
    const movements = (entries || []).filter((e) =>
      e.room === room && e.date && e.date <= (session.date || ''));

    const anchor = anchorFor(earlier);

    if (anchor) {
      // Start from the balance you actually saw, then replay only what
      // happened after it. Movements dated on the anchor's own day are
      // already inside that balance unless they were logged afterwards.
      const since = earlier.filter((s) => PT.util.chrono(anchor, s) < 0);
      const cash = movements.filter((e) => e.date > anchor.date
        || (e.date === anchor.date && (e.created || 0) > (anchor.created || 0)));

      let balance = Number(anchor.closing) || 0;
      for (const s of since) balance += s.net;
      for (const e of cash) balance += movementDelta(e);

      return {
        balance,
        hasReference: true,
        source: 'anchor',
        anchor,
        priorSessions: earlier.length,
        sinceAnchor: since.length,
        movements: cash.length
      };
    }

    // Nothing closed yet in this room: fall back to adding up what is logged.
    let balance = 0;
    for (const s of earlier) balance += s.net;
    for (const e of movements) balance += movementDelta(e);

    return {
      balance,
      // With no deposits and no earlier sessions there is nothing to subtract
      // from, so the whole closing balance would look like profit.
      hasReference: earlier.length > 0 || movements.length > 0,
      source: earlier.length || movements.length ? 'running' : 'none',
      anchor: null,
      priorSessions: earlier.length,
      sinceAnchor: 0,
      movements: movements.length
    };
  }

  /** Net implied by a closing balance. */
  function netFromClosing(session, sessions, entries, excludeId) {
    const before = balanceBefore(session, sessions, entries, excludeId);
    return Object.assign({}, before, {
      net: (Number(session.closing) || 0) - before.balance
    });
  }

  return {
    RANGES, rangeStart, inRange, rangeLabel,
    summary, cumulative, series, maxDrawdown, streaks,
    groupBy, byRoom, byGame, byStakes, byWeekday, byStartHour, bySessionLength, byMonth,
    TABLE_BANDS, TABLE_SCOPES, CASH_GAMES, bandFor, tableAverage, parseTableLog,
    byTableBand, rateDifference, multitabling,
    monthProgress, roomLedger, bankrollSummary, bankrollByRoom, expectedBalance,
    balanceBefore, netFromClosing
  };
})();
