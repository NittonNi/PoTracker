/* PoTracker — checks on the only maths that can lie to you.
   No dependencies and no build: `node test/money.js`.

   Everything here is about one number, the result of a session. It is derived
   rather than typed, so a wrong reference balance quietly inflates a win. That
   has already happened twice, hence this file. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** Load the browser modules into a sandbox that looks enough like a page. */
function loadApp() {
  const sandbox = {
    console,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  };
  sandbox.window = sandbox; // in a browser, window *is* the global object
  const context = vm.createContext(sandbox);
  for (const file of ['util.js', 'store.js', 'stats.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context, { filename: file });
  }
  return sandbox.PT;
}

const PT = loadApp();

/* ── tiny test harness ── */
let passed = 0;
const failures = [];

function check(label, got, want) {
  const round = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n);
  if (round(got) === round(want)) { passed += 1; return; }
  failures.push(`${label}\n      expected ${JSON.stringify(want)}, got ${JSON.stringify(round(got))}`);
}

function group(name, fn) {
  const before = failures.length;
  fn();
  const mark = failures.length === before ? '✓' : '✗';
  console.log(`  ${mark} ${name}`);
}

/* ── fixtures ── */
const session = (over) => PT.store.normaliseSession({
  id: over.id,
  created: over.created,
  fields: Object.assign({
    Date: over.date,
    'Start Time': over.start || '',
    Room: over.room || 'PokerStars',
    'Buy-in': over.buyIn === undefined ? 10 : over.buyIn,
    'Rebuy Total': over.rebuyTotal || 0,
    'Cash Out': over.cashOut === undefined ? 0 : over.cashOut,
    Minutes: over.minutes || 60
  }, over.closing === undefined ? {} : { 'Closing Balance': over.closing })
});

const movement = (over) => PT.store.normaliseBankroll({
  id: over.id,
  created: over.created,
  fields: {
    Date: over.date,
    Type: over.type || 'Deposit',
    Room: over.room || 'PokerStars',
    Amount: over.amount
  }
});

const deposit50 = movement({ id: 'm1', created: 100, date: '2026-03-01', amount: 50 });
/* Closed at 65: put 50 in, sat down, stood up with 65. */
const won15 = session({ id: 's1', created: 200, date: '2026-03-01', cashOut: 25, closing: 65 });

console.log('\nPoTracker — money maths\n');

group('a first session with nothing before it has no reference', () => {
  const ref = PT.stats.balanceBefore(
    { room: 'PokerStars', date: '2026-03-01', created: 150 }, [], [], null);
  check('hasReference', ref.hasReference, false);
  check('source', ref.source, 'none');
  check('balance', ref.balance, 0);
});

group('the first session is measured against the deposit', () => {
  const ref = PT.stats.netFromClosing(
    { room: 'PokerStars', date: '2026-03-01', closing: 65, created: 200 }, [], [deposit50], null);
  check('source', ref.source, 'running');
  check('balance', ref.balance, 50);
  check('net', ref.net, 15);
});

group('a later session is measured against the previous closing balance', () => {
  const next = { room: 'PokerStars', date: '2026-03-02', closing: 80, created: 300 };
  const ref = PT.stats.netFromClosing(next, [won15], [deposit50], null);
  check('source', ref.source, 'anchor');
  check('balance', ref.balance, 65);
  check('net', ref.net, 15);
});

group('breaking even after a win reports zero, not the win again', () => {
  // The regression that started all this: same day, no start times.
  const flat = { room: 'PokerStars', date: '2026-03-01', start: '', closing: 65, created: 400 };
  const ref = PT.stats.netFromClosing(flat, [won15], [deposit50], null);
  check('balance', ref.balance, 65);
  check('net', ref.net, 0);
});

group('two sessions the same day are ordered by when they were logged', () => {
  const second = session({ id: 's2', created: 300, date: '2026-03-01', cashOut: 0, closing: 55 });
  const third = { room: 'PokerStars', date: '2026-03-01', closing: 60, created: 400 };
  const ref = PT.stats.netFromClosing(third, [won15, second], [deposit50], null);
  check('anchors on the newer of the two', ref.balance, 55);
  check('net', ref.net, 5);
});

group('a start time beats the logging order when both have one', () => {
  const morning = session({ id: 's3', created: 900, date: '2026-03-01', start: '09:00', cashOut: 0, closing: 40 });
  const evening = { room: 'PokerStars', date: '2026-03-01', start: '21:00', closing: 45, created: 500 };
  const ref = PT.stats.netFromClosing(evening, [morning], [deposit50], null);
  check('balance', ref.balance, 40);
  check('net', ref.net, 5);
});

group('money added after the last session counts, money added before does not', () => {
  const topUpAfter = movement({ id: 'm2', created: 250, date: '2026-03-01', amount: 20 });
  const next = { room: 'PokerStars', date: '2026-03-02', closing: 100, created: 300 };
  check('top-up lands in the reference',
    PT.stats.balanceBefore(next, [won15], [deposit50, topUpAfter], null).balance, 85);

  // Same day as the anchor but logged before it: already inside that balance.
  const topUpBefore = movement({ id: 'm3', created: 150, date: '2026-03-01', amount: 20 });
  check('earlier top-up is not counted twice',
    PT.stats.balanceBefore(next, [won15], [deposit50, topUpBefore], null).balance, 65);
});

group('a withdrawal lowers the reference', () => {
  const out = movement({ id: 'm4', created: 250, date: '2026-03-02', type: 'Withdrawal', amount: 30 });
  const next = { room: 'PokerStars', date: '2026-03-03', closing: 40, created: 300 };
  const ref = PT.stats.netFromClosing(next, [won15], [deposit50, out], null);
  check('balance', ref.balance, 35);
  check('net', ref.net, 5);
});

group('rooms do not borrow each others balances', () => {
  const elsewhere = { room: 'GGPoker', date: '2026-03-02', closing: 30, created: 300 };
  check('no reference in an untouched room',
    PT.stats.balanceBefore(elsewhere, [won15], [deposit50], null).hasReference, false);
});

group('editing a session leaves itself out of its own reference', () => {
  const later = session({ id: 's4', created: 300, date: '2026-03-02', cashOut: 0, closing: 80 });
  const edited = Object.assign({}, later, { closing: 90 });
  const ref = PT.stats.netFromClosing(edited, [won15, later], [deposit50], 's4');
  check('balance', ref.balance, 65);
  check('net', ref.net, 25);
});

group('the room balance follows the cashier, and names the gap', () => {
  // Session says +15 but the balance typed says +20: five euros the log
  // cannot explain. They belong on their own line, not inside a result.
  const odd = session({ id: 's5', created: 200, date: '2026-03-01', cashOut: 25, closing: 70 });
  const ledger = PT.stats.roomLedger([odd], [deposit50])[0];
  check('table profit stays what the sessions say', ledger.played, 15);
  check('unexplained', ledger.unexplained, 5);
  check('balance matches the cashier', ledger.balance, 70);

  const clean = PT.stats.roomLedger([won15], [deposit50])[0];
  check('a consistent log has nothing unexplained', clean.unexplained, 0);
  check('and still balances', clean.balance, 65);
});

group('a session switched back to cashed out drops its stored balance', () => {
  const fields = PT.store.toSessionFields({ date: '2026-03-01', room: 'PokerStars', buyIn: 10, cashOut: 25, closing: null });
  check('Closing Balance', fields['Closing Balance'], null);
});

group('every write carries a key so a retry cannot duplicate it', () => {
  const key = PT.util.clientId();
  check('sessions', PT.store.toSessionFields({ date: '2026-03-01', clientId: key })['Client ID'], key);
  check('bankroll', PT.store.toBankrollFields({ date: '2026-03-01', type: 'Deposit', clientId: key })['Client ID'], key);
  check('keys are not reused', PT.util.clientId() === PT.util.clientId(), false);
});

group('totals add up', () => {
  const all = [won15, session({ id: 's6', created: 300, date: '2026-03-02', cashOut: 0, closing: 55 })];
  const summary = PT.stats.summary(all);
  check('net', summary.net, 5);
  check('wins', summary.wins, 1);
  check('losses', summary.losses, 1);
  const curve = PT.stats.cumulative(all);
  check('curve ends on the total', curve[curve.length - 1].value, 5);
});

/* ── report ── */
if (failures.length) {
  console.log(`\n${failures.length} failed, ${passed} checks passed\n`);
  failures.forEach((f) => console.log(`  ✗ ${f}\n`));
  process.exit(1);
}
console.log(`\nAll good — ${passed} checks passed\n`);
