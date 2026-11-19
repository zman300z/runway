# Runway: rules for working on this project

Runway is a personal spending tracker that installs to an iPhone home screen. It is plain HTML, CSS and vanilla JavaScript (ES modules), served as-is by GitHub Pages at `https://<username>.github.io/runway/`. The owner is not a developer: explain changes in plain English.

## Hard rules

1. **No build step, no framework, no dependencies, no CDN links.** Everything ships from this repo and works offline. Charts are hand-built SVG.
2. **Money is integer cents.** Parse text straight to cents with `parseMoney`, add and subtract cents, display with `formatMoney` (all in `js/money.js`). Never do math on float dollars.
3. **Dates are local `YYYY-MM-DD` strings.** Get today with `todayISO()` and do date math with `js/dates.js`. Never use `toISOString()` or `new Date("YYYY-MM-DD")` for calendar dates (both are UTC and can shift the day).
4. **Paths are relative (`./`)** everywhere: HTML, CSS, manifest (`start_url`, `scope`, icons) and service worker registration. GitHub Pages serves the app under `/runway/`.
5. **Logic stays out of the DOM.** `js/money, dates, budget, recurring, pay, categories, cards, actions, explain, csv, search, store, demo, charts, ids, version` must not touch `document`, `window`, `navigator` or `localStorage`. UI code lives in `js/ui/` and `js/app.js`. A test enforces this.
6. **Data stays on the phone.** localStorage through `js/store.js` only. No network calls after load, no analytics, no accounts.
7. **Never lose user data.** Changing the data shape means: bump `SCHEMA_VERSION` in `js/store.js`, add a migration step, add a test in `tests/store.test.js`. Data that can't be read is kept, never overwritten.
8. **Every release bumps the version.** Run `node tools/release.js` (updates `sw.js` and `js/version.js` together). That renames the service worker cache, which is how phones see "Update available". Any new file the app loads must be added to the `ASSETS` list in `sw.js` (a test checks).
9. **Run `node --test` before every commit.** All tests must pass.
10. **No em dashes or en dashes** in app text, docs or code (a test checks). Use commas, periods, colons or "to". Build any invisible character (like the CSV byte-order mark) with `String.fromCharCode` instead of typing it.
11. **Never commit real financial data.** No backup files or CSV exports (`.gitignore` blocks the usual names). Demo data is generated and fake.
12. **iPhone details:** inputs at least 16px (no zoom on focus), `inputmode="decimal"` for amounts, tap targets at least 44x44, `100dvh`, safe-area padding, light and dark mode, `prefers-reduced-motion`.

## Commands

- Run tests: `node --test`
- Preview locally: `node tools/serve.js`, then open http://localhost:8080/runway/
- Regenerate icons: `node tools/make-icons.js`
- Release: `node tools/release.js`, run the tests, commit, push. GitHub Pages redeploys in about a minute.

## Where things live

- `js/budget.js`: all the safe-to-spend math. `js/explain.js` turns it into the plain-English "?" text.
- `js/recurring.js`: bill schedules and idempotent auto-posting (`postDueCharges`).
- `js/cards.js`: credit card math (what is owed, statements and due dates, the cap per statement cycle, utilization, the cash back estimate). Every transaction has an `account`: `"bank"` or a card id. A card purchase is spending on its date; a `cardPayment` moves money from the bank to the card and is never spending.
- `js/actions.js`: every data change as a pure function.
- `js/store.js`: storage, migrations, validation, backup import and export.
- `js/ui/`: screens (`home`, `activity`, `bills`, `insights`, `settings`, `card`, `onboarding`) and components. `card-sheets.js` holds the card sheets (add or edit a card, pay it, check a statement, Card Reconcile, cash back).
- `PLAN.md`: the plan, data model, formulas and decision log. Add new decisions there.
