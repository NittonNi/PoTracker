/* PoTracker — screen rendering. Each view returns HTML and then wires up its
   own interactions in a `mount` step. */
window.PT = window.PT || {};

PT.views = (function () {
  const u = () => PT.util;
  const ROOMS = ['PokerStars', 'Winamax', 'GGPoker', '888poker', 'PartyPoker', 'bet365', 'Casino (live)', 'Home game', 'Other'];
  const GAMES = ['Cash NLHE', 'Cash PLO', 'MTT', 'Sit & Go', 'Spin & Go', 'Fast-fold', 'Other'];
  const TABLES = ['Heads-up', '6-max', '9-max', 'Other'];
  const TAGS = ['Focused', 'Tilt', 'Tired', 'Drinking', 'Bad beat', 'Heater', 'Bonus'];
  const BANKROLL_TYPES = ['Deposit', 'Withdrawal', 'Bonus', 'Rakeback', 'Transfer', 'Adjustment'];

  /* ── shared fragments ── */
  function segmented(id, options, active) {
    return `<div class="segmented" id="${id}">${options.map((o) =>
      `<button data-value="${u().esc(o.id)}" class="${o.id === active ? 'is-active' : ''}">${u().esc(o.label)}</button>`
    ).join('')}</div>`;
  }

  function tile(label, value, note, toneClass) {
    return `<div class="tile">
      <div class="tile-label">${u().esc(label)}</div>
      <div class="tile-value ${toneClass || ''}">${value}</div>
      ${note ? `<div class="tile-note">${u().esc(note)}</div>` : ''}
    </div>`;
  }

  function sessionRow(s) {
    const color = u().roomColor(s.room);
    const sub = [u().dateLabel(s.date), s.minutes ? u().hoursLabel(s.minutes) : null, s.stakes || s.game]
      .filter(Boolean).join(' · ');
    return `<button class="row" data-session="${s.id}">
      <div class="row-avatar" style="background:${color}">${u().esc(u().initials(s.room))}</div>
      <div class="row-body">
        <div class="row-title">${u().esc(s.room)}${s.pending ? ' <span class="tag-pill">syncing</span>' : ''}</div>
        <div class="row-sub">${u().esc(sub)}</div>
      </div>
      <div>
        <div class="row-value ${u().tone(s.net)}">${u().signed(s.net)}</div>
        ${s.minutes ? `<div class="row-value-sub">${u().signed(s.perHour, { decimals: 0 })}/h</div>` : ''}
      </div>
      <span class="row-chevron">${u().icon('chevron', 16)}</span>
    </button>`;
  }

  function emptyState(title, sub, iconName) {
    return `<div class="empty">
      <div class="empty-icon">${u().icon(iconName || 'cards', 52)}</div>
      <div class="empty-title">${u().esc(title)}</div>
      <div class="empty-sub">${u().esc(sub)}</div>
    </div>`;
  }

  /* ══════════════════════════ OVERVIEW ══════════════════════════ */
  function home() {
    const all = PT.store.sortedSessions();
    if (!all.length) {
      return `<div class="card">
        ${emptyState('No sessions yet', 'Tap + to log your first session, or start the timer when you sit down at a table.')}
        <div class="btn-row" style="margin-top:4px">
          <button class="btn btn-primary" data-action="new-session">Log a session</button>
          <button class="btn" data-action="start-timer">Start timer</button>
        </div>
      </div>`;
    }

    const range = PT.store.settings.range;
    const scoped = PT.stats.inRange(all, range);
    const s = PT.stats.summary(scoped);
    const curve = PT.stats.cumulative(scoped);
    const progress = PT.stats.monthProgress(all, PT.store.state.goals);
    const recent = all.slice(0, 5);

    return `
    ${segmented('range-seg', PT.stats.RANGES, range)}

    <div class="card" style="margin-top:14px">
      <div class="hero">
        <div class="hero-label" id="hero-label">${u().esc(PT.stats.rangeLabel(range))}</div>
        <div class="hero-value ${u().tone(s.net)}" id="hero-value">${u().signed(s.net)}</div>
        <div class="hero-sub" id="hero-sub">
          <span class="hero-chip">${s.count} session${s.count === 1 ? '' : 's'}</span>
          <span class="hero-chip">${u().num(s.hours, 1)}h played</span>
          <span class="hero-chip ${u().tone(s.perHour)}">${u().signed(s.perHour, { decimals: 0 })}/h</span>
        </div>
      </div>
      <div class="chart-wrap" id="curve-wrap">${PT.charts.area(curve)}</div>
      <button class="btn btn-ghost btn-block" data-action="share-summary" style="margin-top:6px">
        ${u().icon('share', 17)} Share this period
      </button>
    </div>

    <div class="grid grid-tiles" style="margin-top:14px">
      ${tile('Win rate', u().pct(s.winRate), `${s.wins}W · ${s.losses}L`)}
      ${tile('ROI', s.invested ? u().pct(s.roi, 1) : '—', s.invested ? `on ${u().money(s.invested)} invested` : 'no buy-ins yet', u().tone(s.roi))}
      ${tile('Avg session', u().hoursLabel(s.avgMinutes), s.rebuys ? `${s.rebuys} rebuys total` : 'no rebuys')}
      ${tile('Avg result', u().signed(s.avgNet), 'per session', u().tone(s.avgNet))}
    </div>

    ${ringsCard(progress)}

    <div class="section-head">
      <span class="section-title">Recent</span>
      <button class="section-action" data-action="go-sessions">See all</button>
    </div>
    <div class="rows">${recent.map(sessionRow).join('')}</div>`;
  }

  function ringsCard(progress) {
    if (!progress.hasGoal) {
      return `<div class="card" style="margin-top:14px">
        <div class="card-head"><span class="card-title">Monthly goal</span></div>
        <p class="muted small" style="margin-bottom:12px">Set a target for ${u().esc(u().monthLabel(progress.key))} and track it with activity rings.</p>
        <button class="btn btn-block" data-action="edit-goal">Set a goal</button>
      </div>`;
    }
    const p = progress;
    const line = (color, label, done, target, fmt) => `
      <div class="ring-legend-item">
        <span class="ring-legend-dot" style="background:${color}"></span>
        <span class="ring-legend-label">${label}</span>
        <span class="ring-legend-value">${fmt(done)} <span class="muted small">/ ${fmt(target)}</span></span>
      </div>`;

    return `<div class="card rings-card" style="margin-top:14px">
      ${PT.charts.rings(p.ratios)}
      <div class="rings-legend">
        <div class="card-title" style="margin-bottom:2px">${u().esc(u().monthLabel(p.key))}</div>
        ${line('var(--green)', 'Profit', p.done.profit, p.target.profit, (v) => u().signed(v, { decimals: 0 }))}
        ${line('var(--blue)', 'Hours', p.done.hours, p.target.hours, (v) => u().num(v, 1) + 'h')}
        ${line('var(--orange)', 'Sessions', p.done.sessions, p.target.sessions, (v) => String(Math.round(v)))}
        <button class="btn btn-ghost small" data-action="edit-goal" style="align-self:flex-start;padding:4px 0">Edit goal</button>
      </div>
    </div>`;
  }

  function mountHome(root) {
    const all = PT.store.sortedSessions();
    if (!all.length) return;

    const range = PT.store.settings.range;
    const curve = PT.stats.cumulative(PT.stats.inRange(all, range));
    const wrap = root.querySelector('#curve-wrap');
    const labelNode = root.querySelector('#hero-label');
    const valueNode = root.querySelector('#hero-value');
    const baseLabel = PT.stats.rangeLabel(range);
    const baseValue = valueNode ? valueNode.textContent : '';
    const baseTone = valueNode ? valueNode.className : '';

    if (wrap && curve.length) {
      PT.charts.trackArea(wrap, curve, (point) => {
        if (!point) {
          labelNode.textContent = baseLabel;
          valueNode.textContent = baseValue;
          valueNode.className = baseTone;
          return;
        }
        labelNode.textContent = `${u().dateLabel(point.date)} · ${u().signed(point.net)} this session`;
        valueNode.textContent = u().signed(point.value);
        valueNode.className = `hero-value ${u().tone(point.value)}`;
      });
    }
  }

  /* ══════════════════════════ SESSIONS ══════════════════════════ */
  const sessionFilter = { query: '', room: 'all' };

  function sessions() {
    const all = PT.store.sortedSessions();
    if (!all.length) {
      return `<div class="card">${emptyState('Nothing logged yet', 'Your sessions will appear here, grouped by month.')}</div>`;
    }

    const rooms = Array.from(new Set(all.map((s) => s.room)));
    const q = sessionFilter.query.toLowerCase();
    const filtered = all.filter((s) => {
      if (sessionFilter.room !== 'all' && s.room !== sessionFilter.room) return false;
      if (!q) return true;
      return [s.room, s.game, s.stakes, s.notes, s.date, (s.tags || []).join(' ')]
        .join(' ').toLowerCase().includes(q);
    });

    const groups = new Map();
    for (const s of filtered) {
      const key = u().monthKey(s.date);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }

    const body = groups.size === 0
      ? `<div class="card">${emptyState('No matches', 'Try a different search or filter.', 'search')}</div>`
      : Array.from(groups.entries()).map(([key, list]) => {
          const net = u().sum(list, (s) => s.net);
          const minutes = u().sum(list, (s) => s.minutes);
          return `<div class="group-head">
              <span>${u().esc(u().monthLabel(key))} · ${list.length} session${list.length === 1 ? '' : 's'} · ${u().hoursLabel(minutes)}</span>
              <b class="${u().tone(net)}">${u().signed(net)}</b>
            </div>
            <div class="rows">${list.map(sessionRow).join('')}</div>`;
        }).join('');

    return `
    <div class="search-wrap">
      ${u().icon('search', 18)}
      <input id="session-search" type="search" placeholder="Search room, stakes, notes…" value="${u().esc(sessionFilter.query)}">
    </div>
    <div class="chips" id="room-filter" style="margin-bottom:4px">
      <button class="chip ${sessionFilter.room === 'all' ? 'is-active' : ''}" data-room="all">All</button>
      ${rooms.map((r) => `<button class="chip ${sessionFilter.room === r ? 'is-active' : ''}" data-room="${u().esc(r)}">
          <span class="chip-dot" style="background:${u().roomColor(r)}"></span>${u().esc(r)}</button>`).join('')}
    </div>
    ${body}`;
  }

  function mountSessions(root) {
    const search = root.querySelector('#session-search');
    if (search) {
      search.addEventListener('input', u().debounce((e) => {
        sessionFilter.query = e.target.value;
        PT.app.render('sessions', { keepFocus: '#session-search' });
      }, 220));
    }
    const filter = root.querySelector('#room-filter');
    if (filter) {
      filter.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-room]');
        if (!chip) return;
        sessionFilter.room = chip.dataset.room;
        u().haptic();
        PT.app.render('sessions');
      });
    }
  }

  /* ══════════════════════════ STATS ══════════════════════════ */
  function stats() {
    const all = PT.store.sortedSessions();
    if (!all.length) {
      return `<div class="card">${emptyState('No data yet', 'Log a couple of sessions and this page fills up with breakdowns.', 'stats')}</div>`;
    }

    const range = PT.store.settings.range;
    const scoped = PT.stats.inRange(all, range);
    const s = PT.stats.summary(scoped);
    const curve = PT.stats.cumulative(scoped);
    const drawdown = PT.stats.maxDrawdown(curve);
    const streak = PT.stats.streaks(scoped);
    const bankroll = PT.stats.bankrollSummary(all, PT.store.state.bankroll);

    const streakLabel = streak.current > 0 ? `${streak.current}W`
      : streak.current < 0 ? `${-streak.current}L` : '—';
    const streakNote = streak.current > 0 ? 'wins in a row'
      : streak.current < 0 ? 'losses in a row' : 'no streak';

    return `
    ${segmented('range-seg', PT.stats.RANGES, range)}

    <div class="grid grid-tiles" style="margin-top:14px">
      ${tile('Net result', u().signed(s.net), PT.stats.rangeLabel(range), u().tone(s.net))}
      ${tile('Per hour', u().signed(s.perHour, { decimals: 0 }), `over ${u().num(s.hours, 1)}h`, u().tone(s.perHour))}
      ${tile('Biggest win', s.best ? u().signed(s.best.net) : '—', s.best ? u().dateLabel(s.best.date) : 'none yet', 'pos')}
      ${tile('Biggest loss', s.worst ? u().signed(s.worst.net) : '—', s.worst ? u().dateLabel(s.worst.date) : 'none yet', 'neg')}
      ${tile('Max drawdown', u().money(drawdown), 'worst peak-to-trough', drawdown < 0 ? 'neg' : '')}
      ${tile('Current streak', streakLabel, `${streakNote} · best ${streak.bestWin}W / ${streak.bestLoss}L`, streak.current > 0 ? 'pos' : streak.current < 0 ? 'neg' : '')}
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-head"><span class="card-title">By room</span><span class="card-note">net result</span></div>
      ${PT.charts.bars(PT.stats.byRoom(scoped), { color: (d) => u().roomColor(d.key) })}
    </div>

    <div class="card">
      <div class="card-head"><span class="card-title">Per hour by room</span><span class="card-note">win rate</span></div>
      ${PT.charts.bars(PT.stats.byRoom(scoped).slice().sort((a, b) => b.perHour - a.perHour),
        { value: (d) => d.perHour, format: (d) => `${u().signed(d.perHour, { decimals: 0 })}/h` })}
    </div>

    <div class="card">
      <div class="card-head"><span class="card-title">By game</span></div>
      ${PT.charts.bars(PT.stats.byGame(scoped), { color: (d) => u().gameColor(d.key) })}
    </div>

    ${PT.stats.byStakes(scoped).length > 1 ? `<div class="card">
      <div class="card-head"><span class="card-title">By stakes</span></div>
      ${PT.charts.bars(PT.stats.byStakes(scoped))}
    </div>` : ''}

    <div class="card">
      <div class="card-head"><span class="card-title">By day of week</span></div>
      ${PT.charts.columns(PT.stats.byWeekday(scoped))}
    </div>

    ${PT.stats.byStartHour(scoped).length ? `<div class="card">
      <div class="card-head"><span class="card-title">By time of day</span><span class="card-note">when you sat down</span></div>
      ${PT.charts.bars(PT.stats.byStartHour(scoped), { format: (d) => `${u().signed(d.net)} · ${d.count}` })}
    </div>` : ''}

    ${PT.stats.bySessionLength(scoped).length > 1 ? `<div class="card">
      <div class="card-head"><span class="card-title">By session length</span><span class="card-note">do you play too long?</span></div>
      ${PT.charts.bars(PT.stats.bySessionLength(scoped), { format: (d) => `${u().signed(d.net)} · ${d.count}` })}
    </div>` : ''}

    <div class="card">
      <div class="card-head"><span class="card-title">Month by month</span><span class="card-note">all time</span></div>
      ${PT.charts.columns(PT.stats.byMonth(all).slice(-12), { label: (d) => u().MONTHS_SHORT[Number(d.key.slice(5, 7)) - 1] })}
    </div>

    <div class="section-head"><span class="section-title">Bankroll</span></div>
    <div class="card">
      <div class="hero" style="padding:8px 0 16px">
        <div class="hero-label">Estimated balance across all rooms</div>
        <div class="hero-value" style="font-size:40px">${u().money(bankroll.current)}</div>
      </div>
      <div class="kv"><span class="kv-key">Deposits</span><span class="kv-val">${u().money(bankroll.deposits)}</span></div>
      <div class="kv"><span class="kv-key">Withdrawals</span><span class="kv-val">${u().money(bankroll.withdrawals)}</span></div>
      <div class="kv"><span class="kv-key">Bonuses &amp; rakeback</span><span class="kv-val">${u().money(bankroll.extras)}</span></div>
      <div class="kv"><span class="kv-key">Table profit</span><span class="kv-val ${u().tone(bankroll.netProfit)}">${u().signed(bankroll.netProfit)}</span></div>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn btn-primary" data-action="new-bankroll">Add movement</button>
        ${PT.store.state.bankroll.length ? '<button class="btn" data-action="view-bankroll">History</button>' : ''}
      </div>
    </div>

    ${PT.stats.bankrollByRoom(all, PT.store.state.bankroll).length > 1 ? `<div class="card">
      <div class="card-head"><span class="card-title">Balance by room</span></div>
      ${PT.charts.bars(PT.stats.bankrollByRoom(all, PT.store.state.bankroll), {
        color: (d) => u().roomColor(d.key), format: (d) => u().money(d.net)
      })}
    </div>` : ''}`;
  }

  /* ══════════════════════════ SETTINGS ══════════════════════════ */
  function settings() {
    const st = PT.store.settings;
    const outbox = PT.store.state.outbox.length;
    const synced = PT.store.state.syncedAt ? new Date(PT.store.state.syncedAt).toLocaleString('en-GB') : 'never';

    return `
    <div class="section-head"><span class="section-title">Connection</span></div>
    <div class="card">
      <div class="kv"><span class="kv-key">Base</span><span class="kv-val mono">${u().esc(st.airtable.baseId || '—')}</span></div>
      <div class="kv"><span class="kv-key">Token</span><span class="kv-val mono">${st.airtable.token ? '••••••' + u().esc(st.airtable.token.slice(-4)) : '—'}</span></div>
      <div class="kv"><span class="kv-key">Last sync</span><span class="kv-val" style="font-weight:450">${u().esc(synced)}</span></div>
      ${outbox ? `<div class="kv"><span class="kv-key">Waiting to sync</span><span class="kv-val" style="color:var(--orange)">${outbox} change${outbox === 1 ? '' : 's'}</span></div>` : ''}
      <div class="btn-row" style="margin-top:14px">
        <button class="btn" data-action="sync">Sync now</button>
        <a class="btn" href="https://airtable.com/${u().esc(st.airtable.baseId)}" target="_blank" rel="noopener">Open in Airtable</a>
      </div>
      <button class="btn btn-block" data-action="pair" style="margin-top:8px">Add another device</button>
      <button class="btn btn-ghost btn-block" data-action="reconnect" style="margin-top:2px">Change credentials</button>
    </div>

    <div class="section-head"><span class="section-title">Appearance</span></div>
    <div class="card">
      <div class="field">
        <span class="field-label">Theme</span>
        ${segmented('theme-seg', [{ id: 'system', label: 'System' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }], st.theme)}
      </div>
      <label class="field">
        <span class="field-label">Currency symbol</span>
        <input id="set-currency" type="text" maxlength="3" value="${u().esc(st.currency)}">
      </label>
    </div>

    <div class="section-head"><span class="section-title">Defaults for a new session</span></div>
    <div class="card">
      <div class="field">
        <span class="field-label">Room</span>
        <select id="set-room">${ROOMS.map((r) => `<option ${r === st.defaults.room ? 'selected' : ''}>${u().esc(r)}</option>`).join('')}</select>
      </div>
      <div class="field">
        <span class="field-label">Game</span>
        <select id="set-game">${GAMES.map((g) => `<option ${g === st.defaults.game ? 'selected' : ''}>${u().esc(g)}</option>`).join('')}</select>
      </div>
      <div class="field-inline">
        <label class="field">
          <span class="field-label">Stakes</span>
          <input id="set-stakes" type="text" placeholder="NL10" value="${u().esc(st.defaults.stakes)}">
        </label>
        <label class="field">
          <span class="field-label">Buy-in</span>
          <input id="set-buyin" type="number" inputmode="decimal" step="0.01" value="${u().esc(st.defaults.buyIn)}">
        </label>
      </div>
    </div>

    <div class="section-head"><span class="section-title">Behaviour</span></div>
    <div class="card">
      <div class="switch-row">
        <div>
          <div class="switch-label">Auto-calculate rebuy total</div>
          <div class="switch-sub">Rebuys × buy-in, still editable by hand</div>
        </div>
        <button class="switch ${st.autoRebuyTotal ? 'is-on' : ''}" data-toggle="autoRebuyTotal" aria-label="Auto-calculate rebuy total"></button>
      </div>
      <div class="switch-row">
        <div>
          <div class="switch-label">Confirm before deleting</div>
          <div class="switch-sub">Ask before removing a session</div>
        </div>
        <button class="switch ${st.confirmDelete ? 'is-on' : ''}" data-toggle="confirmDelete" aria-label="Confirm before deleting"></button>
      </div>
    </div>

    <div class="section-head"><span class="section-title">Goals</span></div>
    <div class="card">
      <p class="muted small" style="margin-bottom:12px">Monthly targets drive the activity rings on the overview.</p>
      <button class="btn btn-block" data-action="edit-goal">Edit this month’s goal</button>
    </div>

    <div class="section-head"><span class="section-title">Data</span></div>
    <div class="card">
      <div class="btn-row">
        <button class="btn" data-action="export-csv">${u().icon('download', 17)} CSV</button>
        <button class="btn" data-action="export-json">${u().icon('download', 17)} JSON</button>
      </div>
      <button class="btn btn-ghost btn-block" data-action="clear-cache" style="margin-top:10px">Clear local cache and re-download</button>
      <button class="btn btn-ghost btn-block danger-text" data-action="disconnect" style="margin-top:2px">Disconnect this device</button>
    </div>

    <p class="center muted small" style="margin:22px 0 0">PoTracker · data stored in your own Airtable base</p>`;
  }

  function mountSettings(root) {
    const bind = (sel, event, handler) => {
      const node = root.querySelector(sel);
      if (node) node.addEventListener(event, handler);
    };

    bind('#set-currency', 'change', (e) => {
      PT.store.saveSettings({ currency: e.target.value.trim() || '€' });
      PT.app.render();
    });
    bind('#set-room', 'change', (e) => saveDefault('room', e.target.value));
    bind('#set-game', 'change', (e) => saveDefault('game', e.target.value));
    bind('#set-stakes', 'change', (e) => saveDefault('stakes', e.target.value));
    bind('#set-buyin', 'change', (e) => saveDefault('buyIn', Number(e.target.value) || 0));

    const themeSeg = root.querySelector('#theme-seg');
    if (themeSeg) {
      themeSeg.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-value]');
        if (!btn) return;
        PT.store.saveSettings({ theme: btn.dataset.value });
        PT.store.applyTheme();
        PT.app.render('settings');
      });
    }

    root.querySelectorAll('[data-toggle]').forEach((node) => {
      node.addEventListener('click', () => {
        const key = node.dataset.toggle;
        const next = !PT.store.settings[key];
        PT.store.saveSettings({ [key]: next });
        node.classList.toggle('is-on', next);
        u().haptic();
      });
    });

    function saveDefault(key, value) {
      PT.store.saveSettings({ defaults: Object.assign({}, PT.store.settings.defaults, { [key]: value }) });
      u().toast('Default saved');
    }
  }

  return {
    ROOMS, GAMES, TABLES, TAGS, BANKROLL_TYPES,
    segmented, tile, sessionRow, emptyState,
    home, mountHome,
    sessions, mountSessions, sessionFilter,
    stats,
    settings, mountSettings
  };
})();
