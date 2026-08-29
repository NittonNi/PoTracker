/* PoTracker — client state: settings, cached records, running timer, offline queue.
   Everything lives in localStorage so the app opens instantly and works offline. */
window.PT = window.PT || {};

PT.store = (function () {
  const KEY = {
    settings: 'potracker.settings',
    sessions: 'potracker.cache.sessions',
    bankroll: 'potracker.cache.bankroll',
    goals:    'potracker.cache.goals',
    timer:    'potracker.timer',
    outbox:   'potracker.outbox',
    syncedAt: 'potracker.syncedAt'
  };

  const DEFAULT_SETTINGS = {
    airtable: { token: '', baseId: '' },
    currency: '€',
    theme: 'system',
    range: '30d',
    weekdayMetric: 'net',
    tableScope: 'cash',
    entryMode: 'closing',
    autoRebuyTotal: true,
    confirmDelete: true,
    defaults: { room: 'Winamax', game: 'Cash NLHE', stakes: '', table: '6-max', tables: 1, buyIn: 20 }
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('[PoTracker] could not persist', key, err);
    }
  }

  /* Deep-ish merge so new settings added in a later version get their defaults. */
  function withDefaults(saved) {
    const s = Object.assign({}, DEFAULT_SETTINGS, saved || {});
    s.airtable = Object.assign({}, DEFAULT_SETTINGS.airtable, (saved || {}).airtable);
    s.defaults = Object.assign({}, DEFAULT_SETTINGS.defaults, (saved || {}).defaults);
    return s;
  }

  const state = {
    settings: withDefaults(read(KEY.settings, null)),
    sessions: read(KEY.sessions, []),
    bankroll: read(KEY.bankroll, []),
    goals:    read(KEY.goals, []),
    timer:    read(KEY.timer, null),
    outbox:   read(KEY.outbox, []),
    syncedAt: read(KEY.syncedAt, null),
    loading:  false
  };

  /* ── tiny pub/sub ── */
  const listeners = {};
  function on(event, fn) {
    (listeners[event] = listeners[event] || []).push(fn);
    return () => { listeners[event] = listeners[event].filter((f) => f !== fn); };
  }
  function emit(event, payload) {
    (listeners[event] || []).forEach((fn) => {
      try { fn(payload); } catch (err) { console.error('[PoTracker] listener failed', err); }
    });
  }

  /* ── settings ── */
  function saveSettings(patch) {
    state.settings = withDefaults(Object.assign({}, state.settings, patch || {}));
    write(KEY.settings, state.settings);
    emit('settings', state.settings);
  }

  const isConfigured = () => Boolean(state.settings.airtable.token && state.settings.airtable.baseId);

  function applyTheme() {
    const theme = state.settings.theme;
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }

  /* ── record normalisation ────────────────────────────────────────────
     Airtable's formula fields are the source of truth *inside* Airtable,
     but the app recomputes every derived number locally: that way a
     session typed while offline shows correct maths before it ever syncs. */
  /** When a record came into being: Airtable's stamp, or now for a local one. */
  function stamp(record) {
    if (record.created) return Number(record.created);
    if (record.createdTime) return Date.parse(record.createdTime);
    return Date.now();
  }

  function normaliseSession(record) {
    const f = record.fields || {};
    const buyIn      = Number(f['Buy-in']) || 0;
    const rebuyTotal = Number(f['Rebuy Total']) || 0;
    const cashOut    = Number(f['Cash Out']) || 0;
    const minutes    = Number(f['Minutes']) || 0;
    const invested   = buyIn + rebuyTotal;
    const net        = cashOut - invested;
    const hours      = minutes / 60;
    // How many tables at once. Blank on every session logged before the app
    // asked, and 0 is not 1: a session with no count stays out of the
    // multi-tabling comparison rather than quietly claiming it was one table.
    const tables     = Number(f['Tables']) || 0;
    const tableHours = tables > 0 ? hours * tables : 0;

    return {
      id: record.id,
      pending: Boolean(record.pending),
      // Tie-breaker for two sessions the same day with no times on them.
      created: stamp(record),
      clientId: f['Client ID'] || '',
      date:    f['Date'] || '',
      start:   f['Start Time'] || '',
      end:     f['End Time'] || '',
      minutes,
      room:    f['Room'] || 'Other',
      game:    f['Game'] || 'Other',
      stakes:  f['Stakes'] || '',
      table:   f['Table'] || '',
      tables,
      tableHours,
      // The timer's record of how the count changed, e.g. "4x37|3x21".
      tableLog: f['Table Log'] || '',
      buyIn, rebuyTotal, cashOut, invested, net, hours,
      // Only set when the session was logged by closing balance rather than
      // by cash-out. Kept for the audit trail; Cash Out stays the source of truth.
      closing: f['Closing Balance'] === undefined || f['Closing Balance'] === null
        ? null : Number(f['Closing Balance']),
      rebuys:  Number(f['Rebuys']) || 0,
      rating:  Number(f['Rating']) || 0,
      tags:    f['Tags'] || [],
      notes:   f['Notes'] || '',
      perHour: minutes > 0 ? net / hours : 0,
      perTableHour: tableHours > 0 ? net / tableHours : 0,
      roi:     invested > 0 ? (net / invested) * 100 : 0
    };
  }

  function normaliseBankroll(record) {
    const f = record.fields || {};
    return {
      id: record.id,
      pending: Boolean(record.pending),
      created: stamp(record),
      clientId: f['Client ID'] || '',
      entry:  f['Entry'] || '',
      date:   f['Date'] || '',
      type:   f['Type'] || 'Adjustment',
      room:   f['Room'] || 'Other',
      amount: Number(f['Amount']) || 0,
      notes:  f['Notes'] || ''
    };
  }

  function normaliseGoal(record) {
    const f = record.fields || {};
    return {
      id: record.id,
      goal:     f['Goal'] || '',
      month:    (f['Month'] || '').slice(0, 7),
      profit:   Number(f['Target Profit']) || 0,
      hours:    Number(f['Target Hours']) || 0,
      sessions: Number(f['Target Sessions']) || 0,
      notes:    f['Notes'] || ''
    };
  }

  /** Turn the app's session object back into Airtable field names. */
  function toSessionFields(s) {
    const fields = {
      'Client ID':   s.clientId || '',
      'Session':     s.label || buildLabel(s),
      'Date':        s.date,
      'Start Time':  s.start || '',
      'End Time':    s.end || '',
      'Minutes':     Math.round(Number(s.minutes) || 0),
      'Room':        s.room || 'Other',
      'Game':        s.game || 'Other',
      'Stakes':      s.stakes || '',
      'Buy-in':      round2(s.buyIn),
      'Rebuys':      Math.round(Number(s.rebuys) || 0),
      'Rebuy Total': round2(s.rebuyTotal),
      'Cash Out':    round2(s.cashOut),
      'Rating':      Math.round(Number(s.rating) || 0),
      'Tags':        s.tags || [],
      'Notes':       s.notes || ''
    };
    if (s.table) fields['Table'] = s.table;
    // Written every time, null included: a session edited back to "no idea how
    // many tables" must not keep a count from an earlier attempt, or it would
    // sit in a bucket it no longer belongs to.
    fields['Tables'] = Number(s.tables) > 0 ? Math.round(Number(s.tables) * 10) / 10 : null;
    fields['Table Log'] = s.tableLog || '';
    // Always written, null included: a session switched back to "cashed out"
    // must not keep the balance typed on an earlier attempt, or every later
    // session would measure itself against a figure that no longer applies.
    fields['Closing Balance'] = (s.closing === null || s.closing === undefined || s.closing === '')
      ? null : round2(s.closing);
    return fields;
  }

  function toBankrollFields(b) {
    return {
      'Client ID': b.clientId || '',
      'Entry':  b.entry || `${b.type} · ${PT.util.dateLabel(b.date)}`,
      'Date':   b.date,
      'Type':   b.type,
      'Room':   b.room || 'Other',
      'Amount': round2(b.amount),
      'Notes':  b.notes || ''
    };
  }

  function toGoalFields(g) {
    return {
      'Goal':            g.goal || PT.util.monthLabel(g.month),
      'Month':           `${g.month}-01`,
      'Target Profit':   round2(g.profit),
      'Target Hours':    Number(g.hours) || 0,
      'Target Sessions': Math.round(Number(g.sessions) || 0),
      'Notes':           g.notes || ''
    };
  }

  function buildLabel(s) {
    const d = PT.util.parseDate(s.date);
    const day = d ? `${d.getDate()} ${PT.util.MONTHS_SHORT[d.getMonth()]}` : s.date;
    return [day, s.room, s.stakes || s.game].filter(Boolean).join(' · ');
  }

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  /* ── cache ── */
  function setSessions(list) {
    state.sessions = list;
    write(KEY.sessions, list);
    emit('data', 'sessions');
  }
  function setBankroll(list) {
    state.bankroll = list;
    write(KEY.bankroll, list);
    emit('data', 'bankroll');
  }
  function setGoals(list) {
    state.goals = list;
    write(KEY.goals, list);
    emit('data', 'goals');
  }
  function markSynced() {
    state.syncedAt = Date.now();
    write(KEY.syncedAt, state.syncedAt);
  }

  /** Sessions newest first — the order every view expects. */
  function sortedSessions() {
    return state.sessions.slice().sort((a, b) => PT.util.chrono(b, a));
  }

  /* Optimistic local mutations. The record keeps its temporary id until a
     sync replaces it with the real Airtable one. */
  function upsertSession(session) {
    const list = state.sessions.slice();
    const i = list.findIndex((s) => s.id === session.id);
    if (i >= 0) list[i] = session; else list.push(session);
    setSessions(list);
  }
  function removeSession(id) {
    setSessions(state.sessions.filter((s) => s.id !== id));
  }
  function upsertBankroll(entry) {
    const list = state.bankroll.slice();
    const i = list.findIndex((b) => b.id === entry.id);
    if (i >= 0) list[i] = entry; else list.push(entry);
    setBankroll(list);
  }
  function removeBankroll(id) {
    setBankroll(state.bankroll.filter((b) => b.id !== id));
  }
  function upsertGoal(goal) {
    const list = state.goals.slice();
    const i = list.findIndex((g) => g.month === goal.month);
    if (i >= 0) list[i] = goal; else list.push(goal);
    setGoals(list);
  }

  /* ── running timer ── */
  function startTimer(seed) {
    state.timer = Object.assign({ startedAt: Date.now(), rebuys: 0, rebuyTotal: 0, tables: 1 }, seed || {});
    // Every change of table count is stamped as it happens, so the average the
    // session ends up with is measured rather than remembered afterwards.
    state.timer.tableMarks = [{ at: state.timer.startedAt, tables: Math.max(1, Number(state.timer.tables) || 1) }];
    write(KEY.timer, state.timer);
    emit('timer', state.timer);
  }
  function updateTimer(patch) {
    if (!state.timer) return;
    state.timer = Object.assign({}, state.timer, patch);
    write(KEY.timer, state.timer);
    emit('timer', state.timer);
  }
  /** Change how many tables are open right now, stamping when it happened. */
  function setTimerTables(count) {
    if (!state.timer) return;
    const tables = Math.max(1, Math.round(Number(count) || 1));
    if (tables === Number(state.timer.tables)) return;
    const marks = (state.timer.tableMarks || []).slice();
    const now = Date.now();
    // Two taps in the same second are one decision, not a segment.
    if (marks.length && now - marks[marks.length - 1].at < 1000) marks[marks.length - 1] = { at: marks[marks.length - 1].at, tables };
    else marks.push({ at: now, tables });
    updateTimer({ tables, tableMarks: marks });
  }
  function stopTimer() {
    const finished = state.timer;
    state.timer = null;
    localStorage.removeItem(KEY.timer);
    emit('timer', null);
    return finished;
  }
  const timerSeconds = () => (state.timer ? Math.floor((Date.now() - state.timer.startedAt) / 1000) : 0);

  /* ── offline outbox ── */
  function queue(job) {
    state.outbox = state.outbox.concat([Object.assign({ id: PT.util.uid(), ts: Date.now() }, job)]);
    write(KEY.outbox, state.outbox);
    emit('outbox', state.outbox);
  }
  function setOutbox(list) {
    state.outbox = list;
    write(KEY.outbox, list);
    emit('outbox', list);
  }

  function clearCache() {
    [KEY.sessions, KEY.bankroll, KEY.goals, KEY.syncedAt, KEY.outbox].forEach((k) => localStorage.removeItem(k));
    state.sessions = []; state.bankroll = []; state.goals = []; state.outbox = []; state.syncedAt = null;
    emit('data', 'all');
  }

  return {
    state,
    get settings() { return state.settings; },
    KEY, DEFAULT_SETTINGS,
    on, emit,
    saveSettings, isConfigured, applyTheme,
    normaliseSession, normaliseBankroll, normaliseGoal,
    toSessionFields, toBankrollFields, toGoalFields, buildLabel, round2,
    setSessions, setBankroll, setGoals, markSynced, sortedSessions,
    upsertSession, removeSession, upsertBankroll, removeBankroll, upsertGoal,
    startTimer, updateTimer, stopTimer, timerSeconds, setTimerTables,
    queue, setOutbox, clearCache
  };
})();
