# PoTracker

A personal poker session tracker. Log every session you play — winnings, rebuys, time at the
table — and it works out your hourly rate, ROI, win rate and bankroll for you.

Airtable is the backend, a static page is the frontend, and there is no server in between.

![PoTracker](assets/icon.svg)

---

## What it does

**Logging**
- One record per session: date, start/end time, room, game, stakes, buy-in, rebuys, cash-out
- A **live timer** — start it when you sit down, finish it when you get up, and the session form
  arrives pre-filled. The clock survives closing the app.
- Rebuy stepper that keeps the rebuy total in sync with your buy-in
- Play rating (1–5 stars), tags (tilt, tired, focused, heater…) and free-text notes
- Net, per-hour and ROI update live as you type

**Rooms**
PokerStars, Winamax, GGPoker, 888poker, PartyPoker, bet365, live casino, home game, other —
each with its own colour, and each broken out separately in the stats.

**Analysis**
- Cumulative profit curve you can scrub with your finger to see any point in time
- Per-hour win rate, ROI, win rate, average session, average result
- Breakdowns by room, game, stakes, day of week, time of day and session length
- Biggest win, biggest loss, max drawdown, current and best streaks
- Month-by-month columns
- Monthly goals as Apple-style **activity rings** (profit / hours / sessions)

**Bankroll**
Deposits, withdrawals, bonuses and rakeback tracked separately from table results, so the
"what should actually be in my accounts" number is real.

**Sharing**
Renders a proper image card — session result or a whole period — and hands it to the native
share sheet on mobile, or downloads it plus copies a text summary on desktop.

**Everything else**
- Installable as a PWA (Add to Home Screen) with app icon and home-screen shortcuts
- Works offline: writes queue up locally and sync themselves when you're back
- Light / dark / system theme
- CSV and JSON export
- Keyboard shortcuts on desktop: `n` new session, `t` timer, `r` refresh

---

## Setup

### 1. Create the Airtable base

The base needs three tables. Field names must match exactly.

**Sessions**

| Field | Type |
| --- | --- |
| Session | Single line text (primary) |
| Date | Date |
| Start Time / End Time | Single line text (`HH:MM`) |
| Minutes | Number, 0 decimals |
| Room | Single select |
| Game | Single select |
| Stakes | Single line text |
| Table | Single select |
| Buy-in / Rebuy Total / Cash Out | Currency |
| Rebuys | Number, 0 decimals |
| Rating | Rating, max 5 |
| Tags | Multiple select |
| Notes | Long text |

Optional formula fields for viewing inside Airtable (the app computes these itself):
`Invested`, `Net`, `Hours`, `Per Hour`, `ROI %`, `Result`.

**Bankroll** — `Entry`, `Date`, `Type` (Deposit / Withdrawal / Bonus / Rakeback / Transfer /
Adjustment), `Room`, `Amount` (currency), `Notes`.

**Goals** — `Goal`, `Month` (date), `Target Profit` (currency), `Target Hours`,
`Target Sessions`, `Notes`.

### 2. Create a token

At [airtable.com/create/tokens](https://airtable.com/create/tokens), create a personal access
token with:

- Scopes: `data.records:read`, `data.records:write`
- Access: **only** your PoTracker base

### 3. Open the app

Open the page, paste the token and the base ID (the `app…` part of the base URL), and connect.

---

## Privacy

- The token and the cached copy of your sessions live in your browser's `localStorage` and
  nowhere else. Nothing is committed to this repository.
- The page talks to `api.airtable.com` directly. There is no backend, no analytics, no third
  party, and no external asset — no fonts, no CDNs, no trackers.
- This is a single-user app. Anyone opening the URL sees only the setup screen; without your
  token there is nothing to read.
- "Disconnect this device" in Settings wipes the token and the local cache.

> **One caveat when hosting on `*.github.io`:** every GitHub Pages project under the same
> account shares one browser origin, and therefore shares `localStorage`. Any script running on
> any of your other Pages sites could read the stored token. That is fine while you control all
> of them, but it is the reason the token should be restricted to the PoTracker base and to
> `data.records:read` / `data.records:write` only — then the worst case is limited to poker
> data. A custom domain, or hosting it somewhere else, removes the shared origin entirely.

## Running locally

Any static file server will do:

```bash
npx serve .
# or
python -m http.server 8123
```

Service workers and the share sheet need `http://localhost` or HTTPS — opening `index.html`
straight off the filesystem will mostly work but not entirely.

## Deploying

Push to `main` and GitHub Pages serves it. Bump `PT.BUILD` in `js/app.js` and `VERSION` in
`sw.js` together — the first is what Settings shows you, the second is what retires the old
offline cache. The service worker fetches with `cache: 'reload'`, so a deploy is not held back
by the `max-age=600` Pages puts on every file, and the page reloads itself when the new worker
takes over.

## Tests

```bash
node test/money.js
```

No dependencies, no runner. It covers the one thing the app can get wrong without anyone
noticing: the result of a session, which is derived from the balance you close with rather
than typed. Run it after touching `js/stats.js`, `js/store.js` or the ordering in
`js/util.js`.

## Project layout

```
index.html            app shell, icon sprite, onboarding
css/app.css           design system (iOS-flavoured tokens, light + dark)
js/util.js            formatting, DOM helpers, toasts
js/store.js           settings, cached records, running timer, offline queue
js/airtable.js        REST client + outbox replay
js/stats.js           every derived number
js/charts.js          hand-rolled SVG charts, no chart library
js/share.js           canvas result cards
js/views.js           screen rendering
js/app.js             routing, sheets, timer, sync
test/money.js         checks on the balance maths
sw.js                 offline shell cache
```

## License

MIT
