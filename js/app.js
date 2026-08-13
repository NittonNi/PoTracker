/* PoTracker — application controller: routing, sheets, the running timer and sync. */
window.PT = window.PT || {};

/* Shown in Settings so "which build am I on?" is answerable without guessing.
   Bump it and the matching VERSION in sw.js when deploying. */
PT.BUILD = '2026-08-13.2';

PT.app = (function () {
  const u = PT.util;
  const VIEWS = {
    home:     { title: 'Overview',  render: PT.views.home,     mount: PT.views.mountHome },
    sessions: { title: 'Sessions',  render: PT.views.sessions, mount: PT.views.mountSessions },
    stats:    { title: 'Stats',     render: PT.views.stats,    mount: null },
    settings: { title: 'Settings',  render: PT.views.settings, mount: PT.views.mountSettings }
  };

  let current = 'home';
  let timerHandle = null;

  /* ══════════════════ rendering ══════════════════ */
  function render(view, opts) {
    const name = view || current;
    if (!VIEWS[name]) return;
    if (name !== current) switchView(name);

    const root = u.$(`#view-${name}`);
    const scroll = window.scrollY;
    root.innerHTML = VIEWS[name].render();
    if (VIEWS[name].mount) VIEWS[name].mount(root);

    if (opts && opts.keepFocus) {
      const node = root.querySelector(opts.keepFocus);
      if (node) {
        node.focus();
        if (node.setSelectionRange && node.value) node.setSelectionRange(node.value.length, node.value.length);
      }
      window.scrollTo(0, scroll);
    }
  }

  function switchView(name) {
    current = name;
    u.$$('.view').forEach((v) => v.classList.add('hidden'));
    u.$(`#view-${name}`).classList.remove('hidden');
    u.$$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === name));
    u.$('#topbar-title').textContent = VIEWS[name].title;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function go(name) {
    if (name === current) { render(name); return; }
    render(name);
  }

  /* ══════════════════ sheets ══════════════════ */
  let openSheets = 0;

  function openSheet(config) {
    const root = u.$('#sheet-root');
    const backdrop = u.el('div', { class: 'sheet-backdrop' });
    const sheet = u.el('div', { class: 'sheet' });

    sheet.innerHTML = `
      <div class="sheet-grabber"></div>
      <div class="sheet-head">
        <div class="sheet-title">${u.esc(config.title || '')}</div>
        <button class="sheet-close" aria-label="Close">${u.icon('close', 17)}</button>
      </div>
      <div class="sheet-body">${config.body || ''}</div>
      ${config.footer ? `<div class="sheet-foot">${config.footer}</div>` : ''}`;

    root.appendChild(backdrop);
    root.appendChild(sheet);
    openSheets += 1;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('has-sheet');

    requestAnimationFrame(() => {
      backdrop.classList.add('is-open');
      sheet.classList.add('is-open');
    });

    let closed = false;
    function close(result) {
      if (closed) return;
      closed = true;
      backdrop.classList.remove('is-open');
      sheet.classList.remove('is-open');
      openSheets -= 1;
      if (openSheets <= 0) {
        document.body.style.overflow = '';
        document.body.classList.remove('has-sheet');
      }
      document.removeEventListener('keydown', onKey);
      setTimeout(() => { backdrop.remove(); sheet.remove(); }, 420);
      if (config.onClose) config.onClose(result);
    }

    function onKey(e) { if (e.key === 'Escape') close(); }

    backdrop.addEventListener('click', () => close());
    sheet.querySelector('.sheet-close').addEventListener('click', () => close());
    document.addEventListener('keydown', onKey);

    const api = { root: sheet, body: sheet.querySelector('.sheet-body'), foot: sheet.querySelector('.sheet-foot'), close };
    if (config.onMount) config.onMount(api);
    return api;
  }

  function confirmSheet(title, message, confirmLabel, danger) {
    return new Promise((resolve) => {
      let answered = false;
      const sheet = openSheet({
        title,
        body: `<p class="muted" style="line-height:1.5;margin-bottom:16px">${u.esc(message)}</p>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-block btn-lg" data-yes>${u.esc(confirmLabel)}</button>
               <button class="btn btn-ghost btn-block" data-no style="margin-top:8px">Cancel</button>`,
        onClose: () => { if (!answered) resolve(false); }
      });
      sheet.body.querySelector('[data-yes]').addEventListener('click', () => { answered = true; sheet.close(); resolve(true); });
      sheet.body.querySelector('[data-no]').addEventListener('click', () => { answered = true; sheet.close(); resolve(false); });
    });
  }

  /* ══════════════════ session form ══════════════════ */
  function minutesBetween(start, end) {
    if (!start || !end) return null;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if ([sh, sm, eh, em].some(Number.isNaN)) return null;
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins < 0) mins += 1440; // played past midnight
    return mins;
  }

  function sessionFormSheet(existing, seed) {
    const d = PT.store.settings.defaults;
    const form = Object.assign({
      id: null,
      created: Date.now(), // orders it after anything already logged today
      date: u.isoDate(),
      start: '', end: '', minutes: 0,
      room: d.room, game: d.game, stakes: d.stakes, table: d.table,
      buyIn: d.buyIn, rebuys: 0, rebuyTotal: 0, cashOut: 0, closing: null,
      rating: 0, tags: [], notes: ''
    }, existing || {}, seed || {});
    form.tags = (form.tags || []).slice();

    // Live games have no cashier, so there is no balance to read off a screen.
    const LIVE = ['Casino (live)', 'Home game'];
    if (!form.mode) {
      form.mode = (existing && existing.closing !== null && existing.closing !== undefined) ? 'closing'
        : LIVE.includes(form.room) ? 'cashout'
        : (PT.store.settings.entryMode || 'closing');
    }

    const symbol = PT.store.settings.currency;
    const quick = [5, 10, 20, 50, 100, 200];

    const body = `
      <div class="live-result" id="live-result"></div>

      <div class="field-inline">
        <label class="field">
          <span class="field-label">Date</span>
          <input id="f-date" type="date" value="${u.esc(form.date)}">
        </label>
        <label class="field">
          <span class="field-label">Duration (min)</span>
          <input id="f-minutes" type="number" inputmode="numeric" min="0" step="5" value="${form.minutes || ''}">
        </label>
      </div>

      <div class="field-inline">
        <label class="field">
          <span class="field-label">Started</span>
          <input id="f-start" type="time" value="${u.esc(form.start)}">
        </label>
        <label class="field">
          <span class="field-label">Finished</span>
          <input id="f-end" type="time" value="${u.esc(form.end)}">
        </label>
      </div>

      <div class="field">
        <span class="field-label">Room</span>
        <div class="chips" id="f-room">${PT.views.ROOMS.map((r) => `
          <button type="button" class="chip ${r === form.room ? 'is-active' : ''}" data-value="${u.esc(r)}">
            <span class="chip-dot" style="background:${u.roomColor(r)}"></span>${u.esc(r)}
          </button>`).join('')}</div>
        <div class="field-note" id="f-room-balance"></div>
      </div>

      <div class="field">
        <span class="field-label">Game</span>
        <div class="chips" id="f-game">${PT.views.GAMES.map((g) => `
          <button type="button" class="chip ${g === form.game ? 'is-active' : ''}" data-value="${u.esc(g)}">${u.esc(g)}</button>`).join('')}</div>
      </div>

      <div class="field-inline">
        <label class="field">
          <span class="field-label">Stakes</span>
          <input id="f-stakes" type="text" placeholder="NL10 · 20${u.esc(symbol)} MTT" value="${u.esc(form.stakes)}">
        </label>
        <div class="field">
          <span class="field-label">Table</span>
          <select id="f-table">
            <option value="">—</option>
            ${PT.views.TABLES.map((t) => `<option ${t === form.table ? 'selected' : ''}>${u.esc(t)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="field">
        <span class="field-label">Buy-in <span class="muted" style="font-weight:400">— what you take to the table, not a deposit</span></span>
        <div class="input-money" data-symbol="${u.esc(symbol)}">
          <input id="f-buyin" type="number" inputmode="decimal" step="0.01" value="${form.buyIn || ''}">
        </div>
        <div class="chips" style="margin-top:8px">
          ${quick.map((v) => `<button type="button" class="chip" data-quick-buyin="${v}">${u.esc(symbol)}${v}</button>`).join('')}
        </div>
      </div>

      <div class="field-inline">
        <div class="field">
          <span class="field-label">Rebuys</span>
          <div class="stepper">
            <button type="button" id="f-rebuy-minus">${u.icon('minus', 18)}</button>
            <span class="stepper-value" id="f-rebuys">${form.rebuys}</span>
            <button type="button" id="f-rebuy-plus">${u.icon('plus', 18)}</button>
          </div>
        </div>
        <label class="field">
          <span class="field-label">Rebuy total</span>
          <div class="input-money" data-symbol="${u.esc(symbol)}">
            <input id="f-rebuytotal" type="number" inputmode="decimal" step="0.01" value="${form.rebuyTotal || ''}">
          </div>
        </label>
      </div>

      <div class="field">
        <span class="field-label">How did it end?</span>
        ${PT.views.segmented('f-mode', [
          { id: 'closing', label: 'Room balance' },
          { id: 'cashout', label: 'Cashed out' }
        ], form.mode)}
      </div>

      <label class="field" id="f-closing-field">
        <span class="field-label">Balance when you finished <span class="muted" style="font-weight:400">— what the cashier shows</span></span>
        <div class="input-money" data-symbol="${u.esc(symbol)}">
          <input id="f-closing" type="number" inputmode="decimal" step="0.01" value="${form.closing === null || form.closing === undefined ? '' : form.closing}">
        </div>
        <div class="field-note" id="f-closing-note"></div>
      </label>

      <label class="field" id="f-cashout-field">
        <span class="field-label">Cashed out <span class="muted" style="font-weight:400">— what you took off the table</span></span>
        <div class="input-money" data-symbol="${u.esc(symbol)}">
          <input id="f-cashout" type="number" inputmode="decimal" step="0.01" value="${form.cashOut || ''}">
        </div>
      </label>

      <div class="field">
        <span class="field-label">How well did you play?</span>
        <div class="stars" id="f-rating">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" class="${n <= form.rating ? 'is-on' : ''}">${u.icon('star', 26)}</button>`).join('')}
        </div>
      </div>

      <div class="field">
        <span class="field-label">Tags</span>
        <div class="chips" id="f-tags">${PT.views.TAGS.map((t) => `
          <button type="button" class="chip ${form.tags.includes(t) ? 'is-active' : ''}" data-value="${u.esc(t)}">${u.esc(t)}</button>`).join('')}</div>
      </div>

      <label class="field">
        <span class="field-label">Notes</span>
        <textarea id="f-notes" placeholder="Table was soft, ran into two coolers…">${u.esc(form.notes)}</textarea>
      </label>

      ${existing && existing.id ? `<button class="btn btn-ghost btn-block danger-text" id="f-delete" style="margin-top:6px">Delete this session</button>` : ''}`;

    const sheet = openSheet({
      title: existing && existing.id ? 'Edit session' : 'New session',
      body,
      footer: `<button class="btn btn-primary btn-block btn-lg" id="f-save">${existing && existing.id ? 'Save changes' : 'Save session'}</button>`,
      onMount: (api) => wireSessionForm(api, form, existing)
    });
    return sheet;
  }

  function wireSessionForm(api, form, existing) {
    const q = (sel) => api.root.querySelector(sel);

    /* In balance mode the net is derived, never typed: you enter the one
       number the cashier already shows you and the difference does the rest. */
    function derive() {
      const invested = (Number(form.buyIn) || 0) + (Number(form.rebuyTotal) || 0);
      if (form.mode !== 'closing') {
        return { invested, net: (Number(form.cashOut) || 0) - invested, ref: null };
      }
      const ref = PT.stats.netFromClosing(
        form, PT.store.sortedSessions(), PT.store.state.bankroll,
        existing && existing.id ? existing.id : null
      );
      return { invested, net: ref.net, ref };
    }

    function paintClosingNote() {
      const node = q('#f-closing-note');
      if (form.mode !== 'closing') return;
      const { ref } = derive();

      if (!ref.hasReference) {
        node.className = 'field-note is-warning';
        node.innerHTML = `Nothing recorded in ${u.esc(form.room)} before this session, so there is no `
          + `balance to subtract from and the whole amount would count as profit. `
          + `Log your starting balance as a deposit first (Stats → Bankroll).`;
        return;
      }
      const from = ref.source === 'anchor'
        ? `the balance you closed your last session with (${u.esc(u.dateLabel(ref.anchor.date))})`
        : 'everything you have logged in this room so far';

      node.className = 'field-note';
      node.innerHTML = `Net is this minus <b>${u.money(ref.balance)}</b> — ${from}`
        + (ref.sinceAnchor ? `, plus the ${ref.sinceAnchor} session${ref.sinceAnchor === 1 ? '' : 's'} played since` : '')
        + '.'
        + (form.rebuys ? ` Rebuys don’t affect it — that money never left ${u.esc(form.room)}.` : '');
    }

    function recompute() {
      const { invested, net } = derive();
      const hours = (Number(form.minutes) || 0) / 60;
      const perHour = hours > 0 ? net / hours : 0;
      const roi = invested > 0 ? (net / invested) * 100 : 0;
      q('#live-result').innerHTML = `
        <div><div class="lr-label">Net</div><div class="lr-value ${u.tone(net)}">${u.signed(net)}</div></div>
        <div><div class="lr-label">Per hour</div><div class="lr-value ${u.tone(perHour)}">${hours > 0 ? u.signed(perHour, { decimals: 0 }) : '—'}</div></div>
        <div><div class="lr-label">ROI</div><div class="lr-value ${u.tone(roi)}">${invested > 0 ? u.pct(roi) : '—'}</div></div>`;
      paintRoomBalance();
      paintClosingNote();
    }

    function applyMode() {
      const closing = form.mode === 'closing';
      q('#f-closing-field').classList.toggle('hidden', !closing);
      q('#f-cashout-field').classList.toggle('hidden', closing);
      api.root.querySelectorAll('#f-mode [data-value]').forEach((b) =>
        b.classList.toggle('is-active', b.dataset.value === form.mode));
      recompute();
    }

    /* A buy-in doesn't leave the room, it just moves onto a table — but you
       still can't put more on the table than the room holds. Warn, never block:
       the balance is only as right as what you've logged. */
    function paintRoomBalance() {
      const node = q('#f-room-balance');
      // What the room held when you sat down — so editing an old session
      // compares against that day, not against today's balance.
      const ref = PT.stats.balanceBefore(
        form, PT.store.sortedSessions(), PT.store.state.bankroll,
        existing && existing.id ? existing.id : null
      );

      if (!ref.hasReference) {
        node.className = 'field-note';
        node.innerHTML = `Nothing tracked in ${u.esc(form.room)} yet — log a deposit in Stats → Bankroll.`;
        return;
      }

      const balance = ref.balance;
      const stake = (Number(form.buyIn) || 0) + (Number(form.rebuyTotal) || 0);
      const over = stake > balance + 0.005;

      node.className = `field-note${over ? ' is-warning' : ''}`;
      node.innerHTML = `Balance in ${u.esc(form.room)} when you sat down: <b>${u.money(balance)}</b>`
        + (over ? ` · this puts ${u.money(stake)} in play, more than the room holds` : '');
    }

    function syncDuration() {
      const mins = minutesBetween(form.start, form.end);
      if (mins !== null) {
        form.minutes = mins;
        q('#f-minutes').value = mins;
      }
      recompute();
    }

    function autoRebuyTotal() {
      if (!PT.store.settings.autoRebuyTotal) return;
      form.rebuyTotal = PT.store.round2(form.rebuys * (Number(form.buyIn) || 0));
      q('#f-rebuytotal').value = form.rebuyTotal || '';
    }

    q('#f-date').addEventListener('change', (e) => { form.date = e.target.value; });
    q('#f-start').addEventListener('change', (e) => { form.start = e.target.value; syncDuration(); });
    q('#f-end').addEventListener('change', (e) => { form.end = e.target.value; syncDuration(); });
    q('#f-minutes').addEventListener('input', (e) => { form.minutes = Number(e.target.value) || 0; recompute(); });
    q('#f-stakes').addEventListener('input', (e) => { form.stakes = e.target.value; });
    q('#f-table').addEventListener('change', (e) => { form.table = e.target.value; });
    q('#f-notes').addEventListener('input', (e) => { form.notes = e.target.value; });

    q('#f-buyin').addEventListener('input', (e) => { form.buyIn = Number(e.target.value) || 0; autoRebuyTotal(); recompute(); });
    q('#f-rebuytotal').addEventListener('input', (e) => { form.rebuyTotal = Number(e.target.value) || 0; recompute(); });
    q('#f-cashout').addEventListener('input', (e) => { form.cashOut = Number(e.target.value) || 0; recompute(); });
    q('#f-closing').addEventListener('input', (e) => {
      form.closing = e.target.value === '' ? null : Number(e.target.value);
      recompute();
    });
    q('#f-mode').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-value]');
      if (!btn) return;
      form.mode = btn.dataset.value;
      PT.store.saveSettings({ entryMode: form.mode });
      u.haptic();
      applyMode();
    });

    api.root.querySelectorAll('[data-quick-buyin]').forEach((btn) => {
      btn.addEventListener('click', () => {
        form.buyIn = Number(btn.dataset.quickBuyin);
        q('#f-buyin').value = form.buyIn;
        autoRebuyTotal();
        recompute();
        u.haptic();
      });
    });

    const setRebuys = (n) => {
      form.rebuys = Math.max(0, n);
      q('#f-rebuys').textContent = form.rebuys;
      autoRebuyTotal();
      recompute();
      u.haptic();
    };
    q('#f-rebuy-minus').addEventListener('click', () => setRebuys(form.rebuys - 1));
    q('#f-rebuy-plus').addEventListener('click', () => setRebuys(form.rebuys + 1));

    const singleChoice = (sel, key, after) => {
      q(sel).addEventListener('click', (e) => {
        const chip = e.target.closest('[data-value]');
        if (!chip) return;
        form[key] = chip.dataset.value;
        q(sel).querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c === chip));
        u.haptic();
        if (after) after();
      });
    };
    singleChoice('#f-room', 'room', recompute); // a different room means a different balance
    singleChoice('#f-game', 'game');

    q('#f-tags').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-value]');
      if (!chip) return;
      const value = chip.dataset.value;
      const i = form.tags.indexOf(value);
      if (i >= 0) form.tags.splice(i, 1); else form.tags.push(value);
      chip.classList.toggle('is-active', i < 0);
      u.haptic();
    });

    q('#f-rating').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-star]');
      if (!btn) return;
      const value = Number(btn.dataset.star);
      form.rating = form.rating === value ? 0 : value;
      api.root.querySelectorAll('[data-star]').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.star) <= form.rating));
      u.haptic();
    });

    const deleteBtn = q('#f-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        api.close();
        await deleteSessionFlow(existing);
      });
    }

    const saveBtn = api.foot.querySelector('#f-save');
    saveBtn.addEventListener('click', async () => {
      if (!form.date) { u.toast('Pick a date first', 'error'); return; }

      const { invested, net, ref } = derive();
      if (form.mode === 'closing') {
        if (form.closing === null || form.closing === undefined) {
          u.toast('Enter the balance you finished with', 'error');
          return;
        }
        if (!ref.hasReference) {
          const ok = await confirmSheet('No earlier balance to compare against',
            `Nothing is recorded in ${form.room} before this session, so the whole `
            + `${u.money(form.closing)} would be counted as profit. Log your starting balance `
            + `as a deposit first, or save anyway if that really is all profit.`,
            'Save anyway', true);
          if (!ok) return;
        }
        // Store a consistent cash-out so every existing stat and the Airtable
        // formulas keep working untouched.
        form.cashOut = PT.store.round2(invested + net);
      } else {
        form.closing = null;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        await PT.api.saveSession(form);
        u.toast('Session saved', 'success');
      } catch (err) {
        console.warn('[PoTracker] save failed, queued offline', err);
        u.toast('Saved locally — will sync when online', 'error');
      }
      api.close();
      render();
      updateSyncDot();
    });

    applyMode();
  }

  async function deleteSessionFlow(session) {
    if (PT.store.settings.confirmDelete) {
      const ok = await confirmSheet('Delete session?',
        `${u.dateLabel(session.date)} · ${session.room} · ${u.signed(session.net)}. This cannot be undone.`,
        'Delete', true);
      if (!ok) return;
    }
    try {
      await PT.api.deleteSession(session.id);
      u.toast('Session deleted');
    } catch (err) {
      u.toast('Deleted locally — will sync when online', 'error');
    }
    render();
    updateSyncDot();
  }

  /* ══════════════════ session detail ══════════════════ */
  function sessionDetailSheet(session) {
    const kv = (key, value, cls) => `<div class="kv"><span class="kv-key">${u.esc(key)}</span><span class="kv-val ${cls || ''}">${value}</span></div>`;
    const badge = session.net > 0 ? 'badge-win' : session.net < 0 ? 'badge-loss' : 'badge-even';
    const badgeText = session.net > 0 ? 'Win' : session.net < 0 ? 'Loss' : 'Break-even';

    const body = `
      <div class="hero" style="padding:6px 0 18px">
        <div class="hero-label">${u.esc(u.dateLabel(session.date))}${session.start ? ' · ' + u.esc(session.start) : ''}</div>
        <div class="hero-value ${u.tone(session.net)}">${u.signed(session.net)}</div>
        <div class="hero-sub">
          <span class="badge ${badge}">${badgeText}</span>
          <span class="hero-chip"><span class="chip-dot" style="background:${u.roomColor(session.room)}"></span>${u.esc(session.room)}</span>
          ${session.stakes ? `<span class="hero-chip">${u.esc(session.stakes)}</span>` : ''}
        </div>
      </div>

      <div class="card" style="box-shadow:none;background:var(--bg-elev);padding:4px 16px">
        ${kv('Game', u.esc(session.game) + (session.table ? ' · ' + u.esc(session.table) : ''))}
        ${kv('Time played', u.hoursLabel(session.minutes) + (session.end ? ` (${u.esc(session.start)}–${u.esc(session.end)})` : ''))}
        ${kv('Per hour', session.minutes ? u.signed(session.perHour, { decimals: 0 }) : '—', u.tone(session.perHour))}
        ${kv('Buy-in', u.money(session.buyIn))}
        ${kv('Rebuys', session.rebuys ? `${session.rebuys} · ${u.money(session.rebuyTotal)}` : 'none')}
        ${kv('Total invested', u.money(session.invested))}
        ${kv('Cashed out', u.money(session.cashOut))}
        ${kv('ROI', session.invested ? u.pct(session.roi, 1) : '—', u.tone(session.roi))}
        ${session.rating ? kv('Play rating', '★'.repeat(session.rating) + '<span class="muted">' + '★'.repeat(5 - session.rating) + '</span>') : ''}
      </div>

      ${session.tags && session.tags.length ? `<div style="margin-top:14px">${session.tags.map((t) => `<span class="tag-pill">${u.esc(t)}</span>`).join('')}</div>` : ''}
      ${session.notes ? `<div class="card" style="margin-top:14px"><div class="card-note" style="line-height:1.55;color:var(--label)">${u.esc(session.notes)}</div></div>` : ''}

      <div class="btn-row" style="margin-top:18px">
        <button class="btn" id="d-edit">${u.icon('pencil', 17)} Edit</button>
        <button class="btn" id="d-share">${u.icon('share', 17)} Share</button>
      </div>
      <button class="btn btn-ghost btn-block danger-text" id="d-delete" style="margin-top:8px">${u.icon('trash', 17)} Delete</button>`;

    const sheet = openSheet({
      title: 'Session',
      body,
      onMount: (api) => {
        api.root.querySelector('#d-edit').addEventListener('click', () => {
          api.close();
          setTimeout(() => sessionFormSheet(session), 260);
        });
        api.root.querySelector('#d-share').addEventListener('click', () => {
          api.close();
          setTimeout(() => shareSheet('session', session), 260);
        });
        api.root.querySelector('#d-delete').addEventListener('click', async () => {
          api.close();
          setTimeout(() => deleteSessionFlow(session), 260);
        });
      }
    });
    return sheet;
  }

  /* ══════════════════ share ══════════════════ */
  function shareSheet(kind, payload) {
    let canvas;
    let message;

    if (kind === 'session') {
      canvas = PT.share.render('session', payload);
      message = PT.share.sessionText(payload);
    } else {
      const range = PT.store.settings.range;
      const scoped = PT.stats.inRange(PT.store.sortedSessions(), range);
      const summary = PT.stats.summary(scoped);
      const title = PT.stats.rangeLabel(range);
      canvas = PT.share.render('summary', {
        title,
        subtitle: `${summary.count} sessions · ${u.num(summary.hours, 1)} hours`,
        summary,
        // The same shape as the chart on screen, so the card matches the app.
        curve: PT.stats.series(scoped, range).points
      });
      message = PT.share.summaryText(title, summary);
    }

    const dataUrl = canvas.toDataURL('image/png');
    const filename = kind === 'session'
      ? `potracker-${payload.date}-${String(payload.room).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`
      : `potracker-${PT.store.settings.range}.png`;

    openSheet({
      title: 'Share result',
      body: `<img class="share-preview" src="${dataUrl}" alt="Result card">
             <p class="muted small center" style="margin-top:12px;white-space:pre-line">${u.esc(message)}</p>`,
      footer: `<div class="btn-row">
                 <button class="btn btn-primary" id="s-share">${u.icon('share', 17)} Share</button>
                 <button class="btn" id="s-download">${u.icon('download', 17)} Save</button>
               </div>
               <button class="btn btn-ghost btn-block" id="s-copy" style="margin-top:6px">Copy as text</button>`,
      onMount: (api) => {
        api.foot.querySelector('#s-share').addEventListener('click', async () => {
          try {
            const outcome = await PT.share.shareCanvas(canvas, filename, message);
            if (outcome === 'downloaded') u.toast('Image saved and text copied');
            if (outcome === 'shared') api.close();
          } catch (err) {
            u.toast('Could not share the card', 'error');
          }
        });
        api.foot.querySelector('#s-download').addEventListener('click', async () => {
          const blob = await PT.share.toBlob(canvas);
          u.download(filename, blob);
          u.toast('Saved');
        });
        api.foot.querySelector('#s-copy').addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(message);
            u.toast('Copied', 'success');
          } catch (_) {
            u.toast('Clipboard is blocked here', 'error');
          }
        });
      }
    });
  }

  /* ══════════════════ pairing another device ══════════════════
     The credentials travel from screen to camera and nowhere else: the payload
     rides in the URL fragment, which browsers never send to the server. */
  function pairingUrl() {
    const { token, baseId } = PT.store.settings.airtable;
    const payload = btoa(`${token}|${baseId}`)
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${location.origin}${location.pathname}#pt=${payload}`;
  }

  function consumePairingHash() {
    const match = location.hash.match(/^#pt=([A-Za-z0-9\-_]+)$/);
    if (!match) return null;
    // Drop it from the address bar (and from history) before anything else.
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const padded = match[1].replace(/-/g, '+').replace(/_/g, '/');
      const [token, baseId] = atob(padded).split('|');
      if (token && baseId) return { token, baseId };
    } catch (_) { /* malformed code */ }
    return null;
  }

  function pairSheet() {
    if (!PT.store.isConfigured()) { u.toast('Connect this device first', 'error'); return; }
    let countdown = null;

    openSheet({
      title: 'Add another device',
      body: `
        <p class="muted" style="line-height:1.5;margin-bottom:16px">
          Point your phone's camera at the code and open the link. It signs that device in
          without typing anything, and works on the phone's normal camera app.
        </p>
        <div id="pair-slot" class="pair-slot">
          <button class="btn btn-primary" id="pair-reveal">Show the code</button>
          <p class="muted small center" style="margin-top:12px;max-width:280px">
            The code contains your Airtable token. Only show it when nobody else can see
            the screen or photograph it.
          </p>
        </div>`,
      footer: `<button class="btn btn-block" id="pair-copy">Copy the link instead</button>`,
      onMount: (api) => {
        const slot = api.root.querySelector('#pair-slot');

        api.root.querySelector('#pair-reveal').addEventListener('click', () => {
          let left = 90;
          const paint = () => {
            slot.innerHTML = `${PT.qr.svg(pairingUrl(), { scale: 6 })}
              <p class="muted small center" style="margin-top:12px">Hides itself in ${left}s</p>`;
            const svg = slot.querySelector('svg');
            svg.removeAttribute('width');
            svg.removeAttribute('height');
            svg.classList.add('pair-qr');
          };
          paint();
          countdown = setInterval(() => {
            left -= 1;
            if (left <= 0) {
              clearInterval(countdown);
              slot.innerHTML = '<p class="muted center small">Code hidden. Reopen this screen to show it again.</p>';
              return;
            }
            const note = slot.querySelector('p');
            if (note) note.textContent = `Hides itself in ${left}s`;
          }, 1000);
        });

        api.foot.querySelector('#pair-copy').addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(pairingUrl());
            u.toast('Link copied — treat it like a password', 'success');
          } catch (_) {
            u.toast('Clipboard is blocked here', 'error');
          }
        });
      },
      onClose: () => { if (countdown) clearInterval(countdown); }
    });
  }

  /* ══════════════════ bankroll ══════════════════ */
  function bankrollSheet(existing) {
    const symbol = PT.store.settings.currency;
    const entry = Object.assign({
      id: null, date: u.isoDate(), type: 'Deposit',
      room: PT.store.settings.defaults.room, amount: 0, notes: ''
    }, existing || {});

    openSheet({
      title: existing ? 'Edit movement' : 'Bankroll movement',
      body: `
        <div class="field">
          <span class="field-label">Type</span>
          <div class="chips" id="b-type">${PT.views.BANKROLL_TYPES.map((t) => `
            <button type="button" class="chip ${t === entry.type ? 'is-active' : ''}" data-value="${u.esc(t)}">${u.esc(t)}</button>`).join('')}</div>
        </div>
        <div class="field-inline">
          <label class="field">
            <span class="field-label">Date</span>
            <input id="b-date" type="date" value="${u.esc(entry.date)}">
          </label>
          <label class="field">
            <span class="field-label">Amount</span>
            <div class="input-money" data-symbol="${u.esc(symbol)}">
              <input id="b-amount" type="number" inputmode="decimal" step="0.01" value="${entry.amount || ''}">
            </div>
          </label>
        </div>
        <div class="field">
          <span class="field-label">Room</span>
          <select id="b-room">${PT.views.ROOMS.map((r) => `<option ${r === entry.room ? 'selected' : ''}>${u.esc(r)}</option>`).join('')}</select>
        </div>
        <label class="field">
          <span class="field-label">Notes</span>
          <textarea id="b-notes" placeholder="Optional">${u.esc(entry.notes)}</textarea>
        </label>
        <p class="muted small">Withdrawals are stored as a positive amount and subtracted automatically.</p>
        ${existing ? '<button class="btn btn-ghost btn-block danger-text" id="b-delete" style="margin-top:6px">Delete movement</button>' : ''}`,
      footer: '<button class="btn btn-primary btn-block btn-lg" id="b-save">Save</button>',
      onMount: (api) => {
        const q = (sel) => api.root.querySelector(sel);
        q('#b-type').addEventListener('click', (e) => {
          const chip = e.target.closest('[data-value]');
          if (!chip) return;
          entry.type = chip.dataset.value;
          q('#b-type').querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c === chip));
        });
        q('#b-date').addEventListener('change', (e) => { entry.date = e.target.value; });
        q('#b-amount').addEventListener('input', (e) => { entry.amount = Number(e.target.value) || 0; });
        q('#b-room').addEventListener('change', (e) => { entry.room = e.target.value; });
        q('#b-notes').addEventListener('input', (e) => { entry.notes = e.target.value; });

        const del = q('#b-delete');
        if (del) {
          del.addEventListener('click', async () => {
            api.close();
            try { await PT.api.deleteBankroll(existing.id); u.toast('Movement deleted'); }
            catch (_) { u.toast('Deleted locally — will sync later', 'error'); }
            render();
          });
        }

        api.foot.querySelector('#b-save').addEventListener('click', async () => {
          if (!entry.amount) { u.toast('Enter an amount', 'error'); return; }
          entry.amount = Math.abs(entry.amount);
          try { await PT.api.saveBankroll(entry); u.toast('Saved', 'success'); }
          catch (_) { u.toast('Saved locally — will sync when online', 'error'); }
          api.close();
          render();
          updateSyncDot();
        });
      }
    });
  }

  function bankrollHistorySheet() {
    const entries = PT.store.state.bankroll.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const rows = entries.length ? `<div class="rows">${entries.map((e) => {
      const outflow = e.type === 'Withdrawal';
      return `<button class="row" data-bankroll="${e.id}">
        <div class="row-avatar" style="background:${u.roomColor(e.room)}">${u.esc(u.initials(e.room))}</div>
        <div class="row-body">
          <div class="row-title">${u.esc(e.type)}</div>
          <div class="row-sub">${u.esc(u.dateLabel(e.date))} · ${u.esc(e.room)}</div>
        </div>
        <div class="row-value ${outflow ? 'neg' : 'pos'}">${outflow ? '−' : '+'}${u.money(Math.abs(e.amount))}</div>
      </button>`;
    }).join('')}</div>` : PT.views.emptyState('No movements', 'Deposits and withdrawals will show up here.');

    openSheet({
      title: 'Bankroll history',
      body: rows,
      footer: '<button class="btn btn-primary btn-block btn-lg" id="bh-add">Add movement</button>',
      onMount: (api) => {
        api.foot.querySelector('#bh-add').addEventListener('click', () => { api.close(); setTimeout(() => bankrollSheet(null), 260); });
        api.body.addEventListener('click', (e) => {
          const row = e.target.closest('[data-bankroll]');
          if (!row) return;
          const found = PT.store.state.bankroll.find((b) => b.id === row.dataset.bankroll);
          if (!found) return;
          api.close();
          setTimeout(() => bankrollSheet(found), 260);
        });
      }
    });
  }

  /* ══════════════════ goals ══════════════════ */
  function goalSheet() {
    const month = u.monthKey(u.isoDate());
    const existing = PT.store.state.goals.find((g) => g.month === month);
    const goal = Object.assign({ month, profit: 0, hours: 0, sessions: 0, notes: '' }, existing || {});
    const symbol = PT.store.settings.currency;

    openSheet({
      title: `Goal · ${u.monthLabel(month)}`,
      body: `
        <p class="muted small" style="margin-bottom:16px">Leave a target at zero to hide its ring.</p>
        <label class="field">
          <span class="field-label">Profit target</span>
          <div class="input-money" data-symbol="${u.esc(symbol)}">
            <input id="g-profit" type="number" inputmode="decimal" step="10" value="${goal.profit || ''}">
          </div>
        </label>
        <div class="field-inline">
          <label class="field">
            <span class="field-label">Hours target</span>
            <input id="g-hours" type="number" inputmode="decimal" step="1" value="${goal.hours || ''}">
          </label>
          <label class="field">
            <span class="field-label">Sessions target</span>
            <input id="g-sessions" type="number" inputmode="numeric" step="1" value="${goal.sessions || ''}">
          </label>
        </div>`,
      footer: '<button class="btn btn-primary btn-block btn-lg" id="g-save">Save goal</button>',
      onMount: (api) => {
        api.foot.querySelector('#g-save').addEventListener('click', async () => {
          goal.profit   = Number(api.root.querySelector('#g-profit').value) || 0;
          goal.hours    = Number(api.root.querySelector('#g-hours').value) || 0;
          goal.sessions = Number(api.root.querySelector('#g-sessions').value) || 0;
          goal.goal = u.monthLabel(month);
          try {
            await PT.api.saveGoal(goal);
            u.toast('Goal saved', 'success');
          } catch (err) {
            u.toast('Could not save the goal — check your connection', 'error');
          }
          api.close();
          render();
        });
      }
    });
  }

  /* ══════════════════ timer ══════════════════ */
  function startTimerSheet() {
    const d = PT.store.settings.defaults;
    const draft = { room: d.room, game: d.game, stakes: d.stakes, buyIn: d.buyIn };
    const symbol = PT.store.settings.currency;

    openSheet({
      title: 'Start a session',
      body: `
        <div class="field">
          <span class="field-label">Room</span>
          <div class="chips" id="t-room">${PT.views.ROOMS.map((r) => `
            <button type="button" class="chip ${r === draft.room ? 'is-active' : ''}" data-value="${u.esc(r)}">
              <span class="chip-dot" style="background:${u.roomColor(r)}"></span>${u.esc(r)}
            </button>`).join('')}</div>
          <div class="field-note" id="t-room-balance"></div>
        </div>
        <div class="field">
          <span class="field-label">Game</span>
          <div class="chips" id="t-game">${PT.views.GAMES.map((g) => `
            <button type="button" class="chip ${g === draft.game ? 'is-active' : ''}" data-value="${u.esc(g)}">${u.esc(g)}</button>`).join('')}</div>
        </div>
        <div class="field-inline">
          <label class="field">
            <span class="field-label">Stakes</span>
            <input id="t-stakes" type="text" value="${u.esc(draft.stakes)}" placeholder="NL10">
          </label>
          <label class="field">
            <span class="field-label">Buy-in</span>
            <div class="input-money" data-symbol="${u.esc(symbol)}">
              <input id="t-buyin" type="number" inputmode="decimal" step="0.01" value="${draft.buyIn || ''}">
            </div>
          </label>
        </div>
        <p class="muted small">The clock keeps running if you close the app. Rebuys can be added while you play.</p>`,
      footer: `<button class="btn btn-primary btn-block btn-lg" id="t-start">${u.icon('play', 17)} Start playing</button>`,
      onMount: (api) => {
        const paintBalance = () => {
          const node = api.root.querySelector('#t-room-balance');
          const room = PT.stats.roomLedger(PT.store.sortedSessions(), PT.store.state.bankroll)
            .find((r) => r.key === draft.room);
          if (!room || !(room.deposited || room.withdrawn || room.sessions)) {
            node.className = 'field-note';
            node.innerHTML = `Nothing tracked in ${u.esc(draft.room)} yet — log a deposit in Stats → Bankroll.`;
            return;
          }
          const over = (Number(draft.buyIn) || 0) > room.balance + 0.005;
          node.className = `field-note${over ? ' is-warning' : ''}`;
          node.innerHTML = `Balance in ${u.esc(draft.room)}: <b>${u.money(room.balance)}</b>`
            + (over ? ` · that buy-in is more than the room holds` : '');
        };

        const pick = (sel, key, after) => api.root.querySelector(sel).addEventListener('click', (e) => {
          const chip = e.target.closest('[data-value]');
          if (!chip) return;
          draft[key] = chip.dataset.value;
          api.root.querySelector(sel).querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c === chip));
          u.haptic();
          if (after) after();
        });
        pick('#t-room', 'room', paintBalance);
        pick('#t-game', 'game');
        api.root.querySelector('#t-stakes').addEventListener('input', (e) => { draft.stakes = e.target.value; });
        api.root.querySelector('#t-buyin').addEventListener('input', (e) => { draft.buyIn = Number(e.target.value) || 0; paintBalance(); });
        paintBalance();

        api.foot.querySelector('#t-start').addEventListener('click', () => {
          PT.store.startTimer(draft);
          api.close();
          u.toast('Good luck', 'success');
          refreshTimerBar();
          render();
        });
      }
    });
  }

  /** Live controls while a session is running. */
  function runningTimerSheet() {
    const timer = PT.store.state.timer;
    if (!timer) return;
    const symbol = PT.store.settings.currency;

    const api = openSheet({
      title: 'Session in progress',
      body: `
        <div class="timer-hero">
          <div class="timer-hero-clock" id="rt-clock">${u.clock(PT.store.timerSeconds())}</div>
          <div class="timer-hero-meta">${u.esc(timer.room)}${timer.stakes ? ' · ' + u.esc(timer.stakes) : ''} · started ${u.esc(u.hhmm(new Date(timer.startedAt)))}</div>
        </div>
        <div class="field" style="margin-top:22px">
          <span class="field-label">Rebuys so far</span>
          <div class="stepper">
            <button type="button" id="rt-minus">${u.icon('minus', 18)}</button>
            <span class="stepper-value" id="rt-rebuys">${timer.rebuys || 0}</span>
            <button type="button" id="rt-plus">${u.icon('plus', 18)}</button>
          </div>
          <div class="tile-note" id="rt-invested" style="margin-top:8px"></div>
        </div>`,
      footer: `<button class="btn btn-primary btn-block btn-lg" id="rt-finish">${u.icon('stop', 16)} Finish and log</button>
               <button class="btn btn-ghost btn-block danger-text" id="rt-cancel" style="margin-top:6px">Discard session</button>`,
      onMount: (sheet) => {
        const clockNode = sheet.root.querySelector('#rt-clock');
        const tick = setInterval(() => {
          if (!PT.store.state.timer) { clearInterval(tick); return; }
          clockNode.textContent = u.clock(PT.store.timerSeconds());
        }, 1000);

        const investedNode = sheet.root.querySelector('#rt-invested');
        const paint = () => {
          const t = PT.store.state.timer;
          if (!t) return;
          sheet.root.querySelector('#rt-rebuys').textContent = t.rebuys || 0;
          const invested = (Number(t.buyIn) || 0) + (Number(t.rebuyTotal) || 0);
          investedNode.textContent = `${u.money(invested)} on the table`;
        };
        const bump = (delta) => {
          const t = PT.store.state.timer;
          if (!t) return;
          const rebuys = Math.max(0, (t.rebuys || 0) + delta);
          PT.store.updateTimer({ rebuys, rebuyTotal: PT.store.round2(rebuys * (Number(t.buyIn) || 0)) });
          paint();
          u.haptic();
        };
        sheet.root.querySelector('#rt-minus').addEventListener('click', () => bump(-1));
        sheet.root.querySelector('#rt-plus').addEventListener('click', () => bump(1));
        paint();

        sheet.foot.querySelector('#rt-finish').addEventListener('click', () => {
          clearInterval(tick);
          sheet.close();
          setTimeout(finishTimer, 260);
        });
        sheet.foot.querySelector('#rt-cancel').addEventListener('click', async () => {
          clearInterval(tick);
          sheet.close();
          const ok = await confirmSheet('Discard session?', 'The running clock will be thrown away and nothing is logged.', 'Discard', true);
          if (ok) { PT.store.stopTimer(); refreshTimerBar(); render(); u.toast('Timer discarded'); }
        });
      }
    });
    return api;
  }

  function finishTimer() {
    const timer = PT.store.state.timer;
    if (!timer) return;
    const start = new Date(timer.startedAt);
    const end = new Date();
    const minutes = Math.max(1, Math.round((end - start) / 60000));
    PT.store.stopTimer();
    refreshTimerBar();
    render();

    sessionFormSheet(null, {
      date: u.isoDate(start),
      start: u.hhmm(start),
      end: u.hhmm(end),
      minutes,
      room: timer.room,
      game: timer.game,
      stakes: timer.stakes,
      buyIn: timer.buyIn,
      rebuys: timer.rebuys || 0,
      rebuyTotal: timer.rebuyTotal || 0
    });
  }

  function refreshTimerBar() {
    const bar = u.$('#timer-bar');
    const button = u.$('#btn-timer');
    const timer = PT.store.state.timer;
    if (!timer) {
      bar.classList.add('hidden');
      button.classList.remove('is-running');
      button.title = 'Start a session';
      if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
      return;
    }
    bar.classList.remove('hidden');
    button.classList.add('is-running');
    button.title = 'Session running';
    u.$('#timer-bar-meta').textContent = [timer.room, timer.stakes].filter(Boolean).join(' · ');
    const paint = () => { u.$('#timer-bar-clock').textContent = u.clock(PT.store.timerSeconds()); };
    paint();
    if (!timerHandle) timerHandle = setInterval(paint, 1000);
  }

  /* ══════════════════ sync ══════════════════ */
  function updateSyncDot() {
    const dot = u.$('#sync-dot');
    const pending = PT.store.state.outbox.length;
    refreshOutboxBar();
    dot.className = 'sync-dot';
    if (!navigator.onLine) { dot.classList.add('is-visible', 'is-offline'); dot.title = 'Offline'; return; }
    if (pending) { dot.classList.add('is-visible', 'is-offline'); dot.title = `${pending} change(s) waiting to sync`; return; }
    dot.title = 'Synced';
  }

  /* A grey pill inside one row was too quiet: a change that only exists on this
     phone is worth a bar you cannot miss, with the way out on it. */
  function refreshOutboxBar() {
    const bar = u.$('#outbox-bar');
    if (!bar) return;
    const pending = PT.store.state.outbox.length;
    if (!pending) { bar.classList.add('hidden'); return; }

    bar.classList.remove('hidden');
    u.$('#outbox-bar-meta').textContent = navigator.onLine
      ? `${pending} change${pending === 1 ? '' : 's'} still on this device`
      : `${pending} change${pending === 1 ? '' : 's'} waiting — you are offline`;
    u.$('#outbox-bar-retry').textContent = navigator.onLine ? 'Retry' : 'Offline';
    u.$('#outbox-bar-retry').disabled = !navigator.onLine;
  }

  async function sync(options) {
    const opts = options || {};
    const btn = u.$('#btn-refresh');
    btn.classList.add('is-spinning');
    try {
      const flushed = await PT.api.flush();
      await PT.api.pull();
      if (!opts.silent) u.toast(flushed ? `Synced · ${flushed} pending change${flushed === 1 ? '' : 's'} sent` : 'Up to date', 'success');
      render();
    } catch (err) {
      console.warn('[PoTracker] sync failed', err);
      const dot = u.$('#sync-dot');
      dot.classList.add('is-visible', 'is-error');
      dot.title = err.message || 'Sync failed';
      if (!opts.silent) {
        u.toast(err.status === 401 || err.status === 403
          ? 'Airtable rejected the token — check Settings'
          : `Sync failed: ${err.message}`, 'error');
      }
    } finally {
      btn.classList.remove('is-spinning');
      updateSyncDot();
    }
  }

  /* ══════════════════ export ══════════════════ */
  function exportCsv() {
    const rows = PT.store.sortedSessions();
    const header = ['Date', 'Start', 'End', 'Minutes', 'Hours', 'Room', 'Game', 'Stakes', 'Table',
      'Buy-in', 'Rebuys', 'Rebuy total', 'Invested', 'Cash out', 'Net', 'Per hour', 'ROI %', 'Rating', 'Tags', 'Notes'];
    const cell = (v) => {
      const s = String(v === null || v === undefined ? '' : v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const body = rows.map((s) => [
      s.date, s.start, s.end, s.minutes, s.hours.toFixed(2), s.room, s.game, s.stakes, s.table,
      s.buyIn, s.rebuys, s.rebuyTotal, s.invested, s.cashOut, s.net,
      s.minutes ? s.perHour.toFixed(2) : '', s.invested ? s.roi.toFixed(1) : '',
      s.rating, (s.tags || []).join(' | '), s.notes
    ].map(cell).join(','));
    u.download(`potracker-sessions-${u.isoDate()}.csv`, [header.join(','), ...body].join('\r\n'), 'text/csv;charset=utf-8');
    u.toast('CSV exported');
  }

  function exportJson() {
    const payload = {
      exportedAt: new Date().toISOString(),
      sessions: PT.store.sortedSessions(),
      bankroll: PT.store.state.bankroll,
      goals: PT.store.state.goals
    };
    u.download(`potracker-backup-${u.isoDate()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    u.toast('JSON exported');
  }

  /* ══════════════════ onboarding ══════════════════ */
  function showOnboarding(prefill) {
    u.$('#app').classList.add('hidden');
    const ob = u.$('#onboarding');
    ob.classList.remove('hidden');

    const tokenInput = u.$('#ob-token');
    const baseInput = u.$('#ob-base');
    const status = u.$('#ob-status');
    const button = u.$('#ob-connect');

    if (prefill) {
      tokenInput.value = PT.store.settings.airtable.token || '';
      baseInput.value = PT.store.settings.airtable.baseId || '';
    }

    button.onclick = async () => {
      const token = tokenInput.value.trim();
      const baseId = baseInput.value.trim();
      if (!token || !baseId) { status.textContent = 'Both fields are required.'; status.className = 'ob-status danger-text'; return; }

      button.disabled = true;
      status.textContent = 'Checking…';
      status.className = 'ob-status muted';
      try {
        await PT.api.test(token, baseId);
        PT.store.saveSettings({ airtable: { token, baseId } });
        status.textContent = 'Connected.';
        status.className = 'ob-status pos';
        setTimeout(async () => {
          ob.classList.add('hidden');
          u.$('#app').classList.remove('hidden');
          await sync({ silent: true });
          render('home');
        }, 400);
      } catch (err) {
        status.textContent = err.status === 401 || err.status === 403
          ? 'Airtable rejected those credentials. Check the token scopes and that the base is shared with it.'
          : err.status === 404
            ? 'Base or “Sessions” table not found. Check the base ID.'
            : `Could not connect: ${err.message}`;
        status.className = 'ob-status danger-text';
      } finally {
        button.disabled = false;
      }
    };
  }

  /* ══════════════════ global events ══════════════════ */
  const ACTIONS = {
    'new-session':  () => sessionFormSheet(null),
    'start-timer':  () => (PT.store.state.timer ? runningTimerSheet() : startTimerSheet()),
    'go-sessions':  () => go('sessions'),
    'share-summary':() => shareSheet('summary'),
    'edit-goal':    () => goalSheet(),
    'new-bankroll': () => bankrollSheet(null),
    'view-bankroll':() => bankrollHistorySheet(),
    'sync':         () => sync(),
    'pair':         () => pairSheet(),
    'reconnect':    () => showOnboarding(true),
    'export-csv':   () => exportCsv(),
    'export-json':  () => exportJson(),
    'clear-cache':  async () => {
      const ok = await confirmSheet('Clear local cache?', 'Nothing is deleted in Airtable — the app just re-downloads everything.', 'Clear and reload');
      if (!ok) return;
      PT.store.clearCache();
      await sync();
    },
    'disconnect':   async () => {
      const ok = await confirmSheet('Disconnect this device?', 'The token and the local copy of your sessions are removed from this browser. Your Airtable base is untouched.', 'Disconnect', true);
      if (!ok) return;
      PT.store.clearCache();
      PT.store.saveSettings({ airtable: { token: '', baseId: '' } });
      location.reload();
    }
  };

  function bindGlobalEvents() {
    document.addEventListener('click', (e) => {
      const actionNode = e.target.closest('[data-action]');
      if (actionNode && ACTIONS[actionNode.dataset.action]) {
        e.preventDefault();
        ACTIONS[actionNode.dataset.action]();
        return;
      }
      const sessionNode = e.target.closest('[data-session]');
      if (sessionNode && !e.target.closest('.sheet')) {
        const found = PT.store.state.sessions.find((s) => s.id === sessionNode.dataset.session);
        if (found) sessionDetailSheet(found);
      }
    });

    u.$$('.tab').forEach((tab) => tab.addEventListener('click', () => { u.haptic(); go(tab.dataset.view); }));
    u.$('#fab').addEventListener('click', () => { u.haptic(); sessionFormSheet(null); });
    u.$('#btn-refresh').addEventListener('click', () => sync());
    u.$('#btn-timer').addEventListener('click', () => { u.haptic(); ACTIONS['start-timer'](); });
    u.$('#timer-bar').addEventListener('click', (e) => {
      if (e.target.closest('#timer-bar-stop')) { finishTimer(); return; }
      runningTimerSheet();
    });

    u.$('#outbox-bar-retry').addEventListener('click', () => sync());

    // Segmented controls are re-created on every render, so delegate.
    const SEGMENTS = { '#range-seg': 'range', '#weekday-seg': 'weekdayMetric' };
    document.addEventListener('click', (e) => {
      for (const [selector, setting] of Object.entries(SEGMENTS)) {
        const btn = e.target.closest(`${selector} [data-value]`);
        if (!btn) continue;
        PT.store.saveSettings({ [setting]: btn.dataset.value });
        u.haptic();
        render();
        return;
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (typing) return;
      if (e.key === 'n') { e.preventDefault(); sessionFormSheet(null); }
      if (e.key === 'r') { e.preventDefault(); sync(); }
      if (e.key === 't') { e.preventDefault(); ACTIONS['start-timer'](); }
    });

    // The curve is drawn at a measured pixel width, so it has to be redrawn
    // when that width changes: rotating the phone, mostly.
    window.addEventListener('resize', u.debounce(() => render(), 220));

    window.addEventListener('online', () => { updateSyncDot(); sync({ silent: true }); });
    window.addEventListener('offline', updateSyncDot);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshTimerBar();
        if (navigator.onLine && PT.store.state.outbox.length) sync({ silent: true });
      }
    });
    PT.store.on('outbox', updateSyncDot);
  }

  /* ══════════════════ boot ══════════════════ */
  async function init() {
    PT.store.applyTheme();
    bindGlobalEvents();

    // Arriving from a pairing QR: verify the credentials before trusting them.
    const paired = consumePairingHash();
    if (paired) {
      try {
        await PT.api.test(paired.token, paired.baseId);
        PT.store.saveSettings({ airtable: paired });
        u.toast('Device paired', 'success');
      } catch (err) {
        u.toast('That code did not work — generate a fresh one', 'error');
      }
    }

    if (!PT.store.isConfigured()) {
      showOnboarding(false);
      return;
    }

    u.$('#app').classList.remove('hidden');
    render('home');
    refreshTimerBar();
    updateSyncDot();

    // Home-screen shortcuts arrive as ?action=…
    const requested = new URLSearchParams(location.search).get('action');
    if (requested && ACTIONS[requested]) {
      history.replaceState(null, '', location.pathname);
      setTimeout(() => ACTIONS[requested](), 320);
    }

    await sync({ silent: true });

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      /* When a deploy lands, the new worker takes over straight away — but the
         page you are looking at is still running the old code until it
         reloads. Doing it here beats telling anyone to force-quit the app. */
      let controlled = Boolean(navigator.serviceWorker.controller);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // The very first worker claiming this page is not an update: the code
        // running here was downloaded a moment ago. Any change after that is.
        if (!controlled) { controlled = true; return; }
        // Never yank the page out from under someone mid-sentence — the next
        // time they open the app it comes up on the new code anyway.
        if (u.$('#sheet-root').children.length) return;
        location.reload();
      });
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
    }
  }

  return {
    init, render, go, sync,
    openSheet, confirmSheet, pairSheet, pairingUrl,
    sessionFormSheet, sessionDetailSheet, shareSheet,
    bankrollSheet, goalSheet, startTimerSheet, runningTimerSheet,
    exportCsv, exportJson, updateSyncDot, refreshTimerBar
  };
})();

document.addEventListener('DOMContentLoaded', PT.app.init);
