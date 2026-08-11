/* PoTracker — Airtable REST client.
   The browser talks to api.airtable.com directly (it sends permissive CORS
   headers), so there is no server in the middle and no third party sees the data. */
window.PT = window.PT || {};

PT.api = (function () {
  const BASE_URL = 'https://api.airtable.com/v0';
  const TABLES = { sessions: 'Sessions', bankroll: 'Bankroll', goals: 'Goals' };

  const creds = () => PT.store.settings.airtable;
  const isTemp = (id) => typeof id === 'string' && id.startsWith('tmp_');

  function headers(token) {
    return {
      Authorization: `Bearer ${token || creds().token}`,
      'Content-Type': 'application/json'
    };
  }

  function url(table, path, baseId) {
    const base = baseId || creds().baseId;
    return `${BASE_URL}/${base}/${encodeURIComponent(table)}${path || ''}`;
  }

  async function request(fullUrl, options) {
    const res = await fetch(fullUrl, options);
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = (body && body.error && (body.error.message || body.error.type)) || '';
      } catch (_) { /* non-JSON error body */ }
      const err = new Error(detail || `Airtable returned ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  /** Verify a token/base pair before we save it. */
  async function test(token, baseId) {
    const data = await request(`${BASE_URL}/${baseId}/${encodeURIComponent(TABLES.sessions)}?maxRecords=1`, {
      headers: headers(token)
    });
    return Array.isArray(data.records);
  }

  /** Page through a whole table (100 records per request). */
  async function fetchAll(table, params) {
    const out = [];
    let offset = null;
    do {
      const qs = new URLSearchParams(params || {});
      qs.set('pageSize', '100');
      if (offset) qs.set('offset', offset);
      const data = await request(url(table, `?${qs.toString()}`), { headers: headers() });
      out.push(...(data.records || []));
      offset = data.offset || null;
    } while (offset);
    return out;
  }

  /** Pull everything, keeping any not-yet-synced local records on top. */
  async function pull() {
    const [sessionRecords, bankrollRecords, goalRecords] = await Promise.all([
      fetchAll(TABLES.sessions, { 'sort[0][field]': 'Date', 'sort[0][direction]': 'desc' }),
      fetchAll(TABLES.bankroll, { 'sort[0][field]': 'Date', 'sort[0][direction]': 'desc' }),
      fetchAll(TABLES.goals)
    ]);

    const pendingSessions = PT.store.state.sessions.filter((s) => isTemp(s.id));
    const pendingBankroll = PT.store.state.bankroll.filter((b) => isTemp(b.id));

    PT.store.setSessions(pendingSessions.concat(sessionRecords.map(PT.store.normaliseSession)));
    PT.store.setBankroll(pendingBankroll.concat(bankrollRecords.map(PT.store.normaliseBankroll)));
    PT.store.setGoals(goalRecords.map(PT.store.normaliseGoal));
    PT.store.markSynced();
    return true;
  }

  async function createRecord(table, fields) {
    const data = await request(url(table), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ records: [{ fields }], typecast: true })
    });
    return data.records[0];
  }

  async function updateRecord(table, recordId, fields) {
    return request(url(table, `/${recordId}`), {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ fields, typecast: true })
    });
  }

  async function deleteRecord(table, recordId) {
    return request(url(table, `/${recordId}`), { method: 'DELETE', headers: headers() });
  }

  /* ── writes with an offline fallback ──────────────────────────────────
     Every mutation updates the local cache first so the UI never waits on
     the network. If the call fails we park the job in the outbox and retry
     on the next sync or when the browser comes back online. */

  async function saveSession(session) {
    const fields = PT.store.toSessionFields(session);
    const creating = !session.id || isTemp(session.id);
    const localId = session.id || PT.util.uid();

    PT.store.upsertSession(PT.store.normaliseSession({ id: localId, fields, pending: true }));

    try {
      if (creating) {
        const record = await createRecord(TABLES.sessions, fields);
        PT.store.removeSession(localId);
        PT.store.upsertSession(PT.store.normaliseSession(record));
        return record.id;
      }
      await updateRecord(TABLES.sessions, session.id, fields);
      PT.store.upsertSession(PT.store.normaliseSession({ id: session.id, fields }));
      return session.id;
    } catch (err) {
      queueWrite({ op: creating ? 'create' : 'update', table: TABLES.sessions, localId, recordId: creating ? null : session.id, fields });
      throw err;
    }
  }

  async function deleteSession(id) {
    PT.store.removeSession(id);
    if (isTemp(id)) { dropQueuedFor(id); return; }
    try {
      await deleteRecord(TABLES.sessions, id);
    } catch (err) {
      queueWrite({ op: 'delete', table: TABLES.sessions, recordId: id });
      throw err;
    }
  }

  async function saveBankroll(entry) {
    const fields = PT.store.toBankrollFields(entry);
    const creating = !entry.id || isTemp(entry.id);
    const localId = entry.id || PT.util.uid();

    PT.store.upsertBankroll(PT.store.normaliseBankroll({ id: localId, fields, pending: true }));

    try {
      if (creating) {
        const record = await createRecord(TABLES.bankroll, fields);
        PT.store.removeBankroll(localId);
        PT.store.upsertBankroll(PT.store.normaliseBankroll(record));
        return record.id;
      }
      await updateRecord(TABLES.bankroll, entry.id, fields);
      PT.store.upsertBankroll(PT.store.normaliseBankroll({ id: entry.id, fields }));
      return entry.id;
    } catch (err) {
      queueWrite({ op: creating ? 'create' : 'update', table: TABLES.bankroll, localId, recordId: creating ? null : entry.id, fields });
      throw err;
    }
  }

  async function deleteBankroll(id) {
    PT.store.removeBankroll(id);
    if (isTemp(id)) { dropQueuedFor(id); return; }
    try {
      await deleteRecord(TABLES.bankroll, id);
    } catch (err) {
      queueWrite({ op: 'delete', table: TABLES.bankroll, recordId: id });
      throw err;
    }
  }

  async function saveGoal(goal) {
    const fields = PT.store.toGoalFields(goal);
    const existing = PT.store.state.goals.find((g) => g.month === goal.month);
    PT.store.upsertGoal(Object.assign({}, goal, { id: existing ? existing.id : PT.util.uid() }));

    if (existing && !isTemp(existing.id)) {
      await updateRecord(TABLES.goals, existing.id, fields);
      return existing.id;
    }
    const record = await createRecord(TABLES.goals, fields);
    PT.store.upsertGoal(PT.store.normaliseGoal(record));
    return record.id;
  }

  /* ── outbox ── */
  function queueWrite(job) {
    // A record created offline and then edited again must stay a single create,
    // otherwise it gets inserted twice the moment the connection comes back.
    const localId = job.localId || (isTemp(job.recordId || '') ? job.recordId : null);
    if (localId) {
      const pending = PT.store.state.outbox.slice();
      const i = pending.findIndex((j) => j.op === 'create' && j.localId === localId);
      if (i >= 0) {
        pending[i] = Object.assign({}, pending[i], { fields: job.fields });
        PT.store.setOutbox(pending);
        return;
      }
    }
    PT.store.queue(job);
  }

  function dropQueuedFor(localId) {
    PT.store.setOutbox(PT.store.state.outbox.filter((j) => j.localId !== localId));
  }

  /** Replay queued writes. Jobs that fail stay queued for the next attempt. */
  async function flush() {
    if (!PT.store.state.outbox.length || !navigator.onLine) return 0;
    const jobs = PT.store.state.outbox.slice();
    const survivors = [];
    let done = 0;

    for (const job of jobs) {
      try {
        if (job.op === 'create') {
          const record = await createRecord(job.table, job.fields);
          if (job.table === TABLES.sessions) {
            PT.store.removeSession(job.localId);
            PT.store.upsertSession(PT.store.normaliseSession(record));
          } else if (job.table === TABLES.bankroll) {
            PT.store.removeBankroll(job.localId);
            PT.store.upsertBankroll(PT.store.normaliseBankroll(record));
          }
        } else if (job.op === 'update') {
          await updateRecord(job.table, job.recordId, job.fields);
        } else if (job.op === 'delete') {
          await deleteRecord(job.table, job.recordId);
        }
        done += 1;
      } catch (err) {
        // A 404 on delete/update means the record is already gone: drop the job.
        if (err.status !== 404) survivors.push(job);
      }
    }

    PT.store.setOutbox(survivors);
    return done;
  }

  return {
    TABLES, test, pull, flush,
    fetchAll, createRecord, updateRecord, deleteRecord,
    saveSession, deleteSession,
    saveBankroll, deleteBankroll,
    saveGoal,
    isTemp
  };
})();
