/* PoTracker — small helpers shared by every module. */
window.PT = window.PT || {};

PT.util = (function () {
  const ROOM_COLORS = {
    'PokerStars':   '#e4362f',
    'Winamax':      '#ff6b00',
    'GGPoker':      '#1f9e55',
    '888poker':     '#0a7cd6',
    'PartyPoker':   '#f2a33c',
    'bet365':       '#14805e',
    'Casino (live)':'#8b5cf6',
    'Home game':    '#f0b429',
    'Other':        '#8e8e93'
  };

  const GAME_COLORS = {
    'Cash NLHE': '#0a84ff',
    'Cash PLO':  '#30b0c7',
    'MTT':       '#af52de',
    'Sit & Go':  '#ff2d55',
    'Spin & Go': '#40cbe0',
    'Fast-fold': '#ffcc00',
    'Other':     '#8e8e93'
  };

  /* ── DOM ── */
  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else node.setAttribute(k, v);
      }
    }
    for (const child of [].concat(children || [])) {
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  /** Escape a string for safe interpolation into an innerHTML template. */
  function esc(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function icon(name, size) {
    const s = size || 20;
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><use href="#i-${name}"/></svg>`;
  }

  /* ── numbers & money ── */
  function money(value, opts) {
    const o = opts || {};
    const n = Number(value) || 0;
    const symbol = PT.store ? PT.store.settings.currency : '€';
    const decimals = o.decimals !== undefined ? o.decimals
      : (Math.abs(n) >= 1000 || Number.isInteger(n) ? 0 : 2);
    const body = Math.abs(n).toLocaleString('en-GB', {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals
    });
    const sign = n < 0 ? '−' : (o.signed && n > 0 ? '+' : '');
    return `${sign}${symbol}${body}`;
  }

  const signed = (value, opts) => money(value, Object.assign({ signed: true }, opts));

  function num(value, decimals) {
    const d = decimals === undefined ? 1 : decimals;
    return (Number(value) || 0).toLocaleString('en-GB', {
      minimumFractionDigits: d, maximumFractionDigits: d
    });
  }

  const pct = (value, decimals) => `${num(value, decimals === undefined ? 0 : decimals)}%`;

  /** '+', '−' or '' — used to pick a CSS class. */
  const tone = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'neutral');

  /* ── time ── */
  function hoursLabel(minutes) {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    const h = Math.floor(m / 60);
    const rest = m % 60;
    if (h === 0) return `${rest}m`;
    if (rest === 0) return `${h}h`;
    return `${h}h ${rest}m`;
  }

  function clock(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  /** Local YYYY-MM-DD — never use toISOString(), it shifts the day in CET. */
  function isoDate(date) {
    const d = date || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const hhmm = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  /** Parse 'YYYY-MM-DD' as a *local* date so day-of-week maths is right. */
  function parseDate(iso) {
    if (!iso) return null;
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function dateLabel(iso) {
    const d = parseDate(iso);
    if (!d) return '—';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff > 1 && diff < 7) return DAYS[d.getDay()];
    const sameYear = d.getFullYear() === today.getFullYear();
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}`;
  }

  const monthKey = (iso) => String(iso || '').slice(0, 7);

  /* Play order for two sessions: by day, then by the clock when both have one,
     falling back to the order they were logged. Two sessions on the same day
     with no start times used to compare equal, which hid the earlier one from
     the balance maths — so the second one got measured against the day before. */
  function chrono(a, b) {
    const da = a.date || '';
    const db = b.date || '';
    if (da !== db) return da < db ? -1 : 1;
    if (a.start && b.start && a.start !== b.start) return a.start < b.start ? -1 : 1;
    // Records cached before this stamp existed count as the older ones; a
    // session being typed right now carries Date.now(), so it lands last.
    const ca = Number(a.created) || 0;
    const cb = Number(b.created) || 0;
    if (ca !== cb) return ca < cb ? -1 : 1;
    return 0;
  }

  function monthLabel(key) {
    const [y, m] = String(key).split('-').map(Number);
    if (!y || !m) return key;
    const now = new Date();
    const sameYear = y === now.getFullYear();
    return `${MONTHS[m - 1]}${sameYear ? '' : ' ' + y}`;
  }

  /** Initials for the little coloured square in a session row. */
  function initials(name) {
    const s = String(name || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim();
    if (!s) return '?';
    const words = s.split(/\s+/);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  const roomColor = (room) => ROOM_COLORS[room] || '#8e8e93';
  const gameColor = (game) => GAME_COLORS[game] || '#8e8e93';

  /* ── misc ── */
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const sum = (arr, fn) => arr.reduce((acc, item) => acc + (fn ? fn(item) : item), 0);
  const uid = () => `tmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /** Count a number up to its final value — the little bit of delight on load. */
  function animateNumber(node, to, render) {
    const from = Number(node.dataset.value || 0);
    if (from === to || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.dataset.value = to;
      node.textContent = render(to);
      return;
    }
    node.dataset.value = to;
    const start = performance.now();
    const dur = 620;
    (function step(now) {
      const t = clamp((now - start) / dur, 0, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      node.textContent = render(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(step);
    })(start);
  }

  function haptic(ms) {
    if (navigator.vibrate) { try { navigator.vibrate(ms || 8); } catch (_) { /* ignore */ } }
  }

  function toast(message, kind) {
    const root = $('#toast-root');
    if (!root) return;
    const node = el('div', { class: `toast${kind ? ' is-' + kind : ''}` }, [message]);
    root.appendChild(node);
    setTimeout(() => {
      node.classList.add('is-out');
      setTimeout(() => node.remove(), 320);
    }, kind === 'error' ? 4200 : 2400);
  }

  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  return {
    $, $$, el, esc, icon,
    money, signed, num, pct, tone,
    hoursLabel, clock, isoDate, hhmm, parseDate, dateLabel, monthKey, monthLabel, chrono,
    MONTHS, MONTHS_SHORT, DAYS, DAYS_SHORT,
    initials, roomColor, gameColor, ROOM_COLORS, GAME_COLORS,
    clamp, sum, uid, debounce, animateNumber, haptic, toast, download
  };
})();
