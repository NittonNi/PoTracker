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
    const wins   = sessions.filter((s) => s.net > 0).length;
    const losses = sessions.filter((s) => s.net < 0).length;

    const sorted = sessions.slice().sort((a, b) => b.net - a.net);
    const best  = sorted[0] || null;
    const worst = sorted[sorted.length - 1] || null;

    return {
      count, net, minutes, hours, invested, wins, losses,
      perHour:  hours > 0 ? net / hours : 0,
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
    const ordered = sessions.slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.start || '').localeCompare(b.start || '');
    });
    let running = 0;
    return ordered.map((s, i) => {
      running += s.net;
      return { i, date: s.date, net: s.net, value: running, session: s };
    });
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
    const ordered = sessions.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
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
     rebuys are therefore tracked for ROI and risk, never for the balance. */
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

    return Array.from(map.values()).map((r) => Object.assign(r, {
      balance: r.deposited - r.withdrawn + r.bonuses + r.played + r.adjustments,
      // What the room has actually made you, ignoring your own money.
      profit: r.played + r.bonuses,
      atRisk: r.deposited - r.withdrawn,
      hours: r.minutes / 60
    })).sort((a, b) => b.balance - a.balance);
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

  return {
    RANGES, rangeStart, inRange, rangeLabel,
    summary, cumulative, maxDrawdown, streaks,
    groupBy, byRoom, byGame, byStakes, byWeekday, byStartHour, bySessionLength, byMonth,
    monthProgress, roomLedger, bankrollSummary, bankrollByRoom, expectedBalance
  };
})();
