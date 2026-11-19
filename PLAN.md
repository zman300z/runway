# Runway: build plan

## Goal

A personal expense tracker that installs to an iPhone home screen. Open it and see instantly how much you can safely spend today and this month, and log a purchase in under 5 seconds. Plain HTML, CSS and vanilla JavaScript with zero dependencies, every number stays on the phone, works offline, deployed to GitHub Pages.

## Decisions

1. **Savings is not spending.** Money moved to a Savings category lowers your balance and counts toward your goal, but does not use up your monthly spending limit.
2. **Refunds and paybacks.** Quick Add has Expense | Refund | Income. A refund, or a friend paying you back, is negative spending in its category, so Eating Out goes down instead of income going up.
3. **Today's number is the safer of two answers:** what's left of your monthly budget spread over the days left, and your cash (balance minus bills due before payday) spread over the days until payday. Both rounded down to the cent. The month number is guarded the same way, and a one-line note says when the cash guard is the one in charge.
4. **Pace ignores fixed bills.** Otherwise rent on the 1st would flag "Ahead of pace" all month. Pace compares everyday spending to an even spread of (limit minus this month's bills).
5. **"Over limit"** means spent plus bills still scheduled this month is more than the limit. The 80% and 100% warnings use what you have actually spent.
6. **Twice-a-month pay** asks which two days (1st and 15th, 15th and last day, or custom).
7. **Suggested monthly limit** = 80% of monthly pay, rounded down to $10 (the 50% needs + 30% wants of 50/30/20).
8. **Demo data lives in its own slot.** It never mixes with your real setup, and "Clear demo data" puts you back exactly where you were.
9. **Reopening the app** returns to the screen you left if that was under 30 minutes ago. Otherwise it opens Home.
10. **Starting balance** is "as of the start of that day". Transactions dated earlier don't change the balance (the bank already counted them) but still count toward that month's spending.
11. **A new bill whose next charge date is in the past** posts the missed charges right away, with a heads-up line in the form before saving.
12. **Adjustments** (from Reconcile) change the balance only, never spending or income.
13. **Accent color: indigo.** Never green, red or amber, so it never reads as a status. Contrast at least 4.5:1.
14. **Minimum iOS 16.4** (needed for the icon badge). No CSS nesting or other very new features.
15. **Status bar:** `default` style plus light and dark `theme-color`. The translucent style forces white status text, unreadable in light mode.
16. **Backups** go through the iOS share sheet ("Save to Files"), with a plain download as fallback.
17. **Dev tools stay out of the app.** A local server, the icon generator and a version-bump script are zero-dependency Node scripts in `tools/`. Playwright (screenshots) lives only in a temp folder, never in the repo.

## Architecture

```
index.html  manifest.webmanifest  sw.js  .nojekyll  .gitignore  package.json
css/app.css           design tokens (light and dark) and components
js/app.js             boot: load and migrate, persist(), catch-up posting, router, render, SW, badge
js/store.js           load/save/migrate/export/import, storage passed in so Node tests use a fake
js/actions.js         every data change as a pure function (add, edit, reconcile, bills, categories...)
js/money.js           parse and format cents, keypad entry rules
js/dates.js           local YYYY-MM-DD helpers, budget periods, days left
js/budget.js          balance, safe-to-spend, guard, pace, split, leftover, goal, warnings, chart data
js/recurring.js       charge dates (31st and Feb 29 rules), idempotent catch-up, totals, upcoming
js/pay.js             paydays, next payday, pending paydays, monthly pay, suggested limit
js/categories.js      defaults, buckets, most-used 6, delete-and-move
js/explain.js         plain-English formula text with live numbers for every "?"
js/csv.js             CSV export
js/demo.js            deterministic demo dataset, relative to today
js/charts.js          SVG builders plus pure geometry helpers
js/ids.js, js/version.js
js/ui/                screens and components (DOM code lives only here and in app.js)
icons/                generated PNGs
tools/                serve.js, make-icons.js, release.js
tests/*.test.js       node --test
```

- Logic modules have no DOM code. A test enforces it.
- Rendering: one state object. Every change goes through `update()`, which saves and re-renders the visible screen. User text is always escaped, so a tampered backup cannot inject markup.
- Dates: `YYYY-MM-DD` strings from local date parts. Day math uses `Date.UTC` day numbers, which ignore DST and time zones.
- Money: integer cents everywhere. Formatting builds an exact decimal string from the cents and hands it to `Intl.NumberFormat`.

## Data model (schemaVersion 1)

localStorage keys: `runway:data` (your data, the only thing backups contain), `runway:demo` (demo slot), `runway:mode` ("demo" while demo data shows), `runway:ui` (last screen, filters, not backed up), `runway:data:pre-vN` (raw copy saved before any migration).

```js
{
  schemaVersion: 1,
  setupDone: false,
  balance: { start: 123456, startDate: "2026-11-18" } | null,
  pay: { amount: 52000, frequency: "weekly" | "biweekly" | "semimonthly" | "monthly",
         anchor: "2026-11-21",               // a known payday (semimonthly: the day pay was set up)
         days: [1, 15] | null,                // semimonthly only, 31 means last day
         handledThrough: "2026-11-07" } | null, // paydays on or before this are confirmed or dismissed
  budget: { limit: 120000 | null, startDay: 1, split: { need: 50, want: 30, savings: 20 } },
  goal: { name: "Spring break", target: 60000, saved: 0, since: "2026-11-18" } | null,
  categories: [{ id, name, emoji, color, bucket: "need" | "want" | "savings", limit: null }], // array order = display order
  transactions: [{
    id, type: "expense" | "income" | "adjustment",
    amount: -450,               // signed effect on balance: purchase -, refund +, income +
    categoryId,                 // expenses only
    bucket: null | "need" | "want", // only set when you flip a purchase; otherwise it follows the category
    source,                     // income only: "paycheck" | "family" | "other"
    note: "", date: "2026-11-18",
    recurringId, recurringDate, // only on auto-posted bill charges
    createdAt, updatedAt
  }],
  recurring: [{ id, name, amount: 1199, categoryId, cadence: "weekly" | "monthly" | "yearly",
                anchor: "2026-01-31",   // original day, so the 31st never drifts to the 28th
                next: "2026-11-30", active: true, createdAt }],
  posted: ["<recurringId>:2026-11-01"], // auto-post log: each charge posts once, ever
  settings: { badge: false },
  meta: { createdAt, lastBackupAt: null, lastOpened: "2026-11-18" }
}
```

- Migrations: an ordered list of steps `vN -> vN+1` in `js/store.js`. On load: parse, keep a raw copy in `pre-vN`, migrate step by step, validate, save. Data that fails to parse, or comes from a newer app version, is never overwritten; a recovery screen offers "Export raw data" instead.
- 14 default categories, each with emoji, color and bucket. Income sources: Paycheck, From family, Other.

## The math (js/budget.js) in plain English

Budget month = calendar month, or "starts on day X" (1 to 28). Days left includes today.

- **Balance** = starting balance + every transaction dated from the start date through today.
- **Spent** = purchases minus refunds in Need and Want categories this budget month.
- **Scheduled** = active bill charges after today through month end (Need and Want).
- **Safe this month (budget)** = limit - spent - scheduled.
- **Budget per day** = safe this month / days left, rounded down.
- **Cash until payday** = balance - every bill (any bucket, savings included) due after today and before the next payday. No pay schedule: the horizon is month end. An unconfirmed paycheck is never counted.
- **Cash per day** = cash until payday / days until payday, rounded down.
- **Shown today** = the smaller of budget per day and cash per day, never below $0. **Shown this month** = the smaller of the two monthly numbers, which can go negative (red, labeled "Over").
- **Pace**: bills this month = posted + scheduled recurring charges. Everyday budget = limit - bills. Expected by today = everyday budget x days elapsed / days in month. "On track" if everyday spending is at or under expected, "Ahead of pace" if over, "Over limit" if safe this month is below zero.
- **Projected left over** = income this month - (all expenses + all scheduled). Savings transfers count as outflow here, so money already saved isn't nudged twice.
- **Goal progress** = already saved + savings transfers since the goal was set (moving money back out reduces it).
- **Monthly net** = income - spending. Savings transfers count as kept, not spent.
- **Needs/Wants/Savings** = this month's amounts vs target % of income (falls back to expected monthly pay before any income arrives).
- No limit set: the cash guard alone drives the numbers. No balance: budget numbers only, plus a prompt to add it. Nothing set: Home shows a setup prompt.

## Phases (run tests, fix, commit after each)

1. **Scaffold, store, logic, tests.** Repo, docs, dev server, page shell, every logic module, store with migrations, unit tests.
2. **Onboarding, Home, Quick Add, Activity.** UI kit (templates, router, sheets, toasts, keypad, tab bar), first-run setup, Home's three answers, 3-tap Quick Add, Activity with search, filters, swipe to delete and Undo.
3. **Categories, Needs/Wants, Bills, Pay, Reconcile.** Settings, category manager, split, Bills tab with totals and pause toggles, auto-posting, payday banner, reconcile, warnings, goal card.
4. **Charts and Insights.** Balance line with projection and scrubbing, limit ring, 6-month net bars, category donut, needs/wants/savings bar, Insights with a month switcher.
5. **PWA, badge, backup.** Icons, manifest, service worker with update toast, version bump script, icon badge, JSON backup and import, CSV export, backup reminder, erase everything.
6. **Polish and QA.** Screenshots at 390x844 in light and dark, empty and demo; automated checks for the done list; fresh subagent review.
7. **Deploy and teach.** GitHub repo, Pages, HOW-TO-INSTALL.md.

## Edge cases handled

- **Money:** float traps, absurd amounts (capped at $1,000,000), "4,50" rejected instead of read as $450, negative balances never break layout, refunds larger than a category's spending (charts clamp at zero).
- **Dates:** 11pm purchases, DST changes, traveling across time zones (dates are plain strings), budget months crossing New Year, the app left open past midnight.
- **Bills:** 31st and Feb 29 rules, long absences, opening twice in a day, pause and resume, edits, deleted posted charges, past next-charge dates, deleted categories (bills move with the transactions).
- **Pay:** several missed paydays (one banner at a time, oldest first), late paycheck ("Not paid" vs "Different amount"), no pay schedule.
- **Budget:** no limit, no balance, nothing set, bills bigger than the limit, last day of the month, future-dated items, savings transfers, threshold warnings shown once per month.
- **Storage:** corrupt data, newer-version data, storage full, private browsing, migration safety copies, invalid import files, importing while in demo mode.
- **UI:** 1,000+ transactions, long notes and names, large text, swipe vs scroll, double-tapped Save, keyboard covering inputs, reduced motion.
- **PWA:** stale HTTP cache during updates, Safari and the home-screen app having separate storage, badge unsupported or permission denied.

## Verification ("Done means")

| Check | How it is proven |
|---|---|
| All tests pass | `node --test` after every phase |
| 3 taps plus amount | Playwright counts the taps from Home to a saved expense |
| Safe-to-spend matches hand math | `tests/demo.test.js` recomputes demo numbers with plain loops |
| 2 months without opening | fake the clock 2 months ahead; each missed charge posts once; a reload posts nothing new |
| Works offline | load once, go offline, relaunch |
| Data survives | close and reopen; bump the version and tap "Update"; export, erase, import |
| Clean screenshots | 390x844, light and dark, empty and demo, reviewed by eye |
| No console errors | Playwright collects errors across every screen |
| No real data in repo | synthetic demo data only, .gitignore blocks backups, scan before pushing |

## Decision log

- **2026-11-19** A transaction stores a bucket only when you flip it. Otherwise it follows its category, so changing a category from Need to Want updates past purchases you never flipped by hand.
- **2026-11-19** Added `js/actions.js`: every change to the data is a pure function, unit tested in Node.
- **2026-11-19** Invisible or banned characters (the CSV byte-order mark, dashes in the rules test) are built with `String.fromCharCode`, so they can never hide in source files.
- **2026-11-19** Demo paychecks land every other Friday; the demo starts 182 days back so the 6-month chart is full.
- **2026-11-19** The local dev server serves the repo at `/runway/`, exactly like GitHub Pages, so a wrong absolute path breaks locally first.
- **2026-11-19** Quick Add was compacted and its Save button pinned, so it fits a real iPhone with the notch and home bar (screenshots simulate both).
- **2026-11-19** Saving or resuming a bill posts any charges due on or before today right away, and says so in a toast.
- **2026-11-19** Paydays before the pay schedule's first date never ask "Did you get paid?". Several missed paydays are asked one at a time, oldest first. "Not paid" just stops asking for that date.
- **2026-11-19** Limit warnings show as a Home card whenever a limit is at 80% or more, and as a one-time toast per limit, level and month when a change crosses the line. The toast waits for any Undo toast to finish.
- **2026-11-19** Deleting a category or bill offers Undo for 5 seconds, but only if nothing else changed in between.
- **2026-11-19** While a sheet is open, toasts appear at the top of the screen so they never cover the sheet's buttons.
- **2026-11-19** Charts follow one validated system: 2px lines, bars at most 24px with a rounded data end, hairline grids, 2px gaps between slices. Every chart has a "Show as a table" view and never relies on color alone.
- **2026-11-19** The balance chart shows its reading above the plot (like the Stocks app) instead of a floating tooltip, so your finger never covers the number. Arrow keys scrub too.
- **2026-11-19** The category donut shows at most 6 slices: the top 5 plus "Other". Tapping a slice or its row opens Activity filtered to that category and month.
- **2026-11-19** Needs, wants and savings use the colorblind-validated blue, orange and aqua. The default Coffee color changed to a richer brown that passes the checks.
- **2026-11-19** Big numbers use the same system font as everything else (no rounded display face), per the spec's system font stack.
- **2026-11-19** The app icon is drawn by `tools/make-icons.js` (no image tools needed): a white rising line over runway dashes on an indigo gradient. The maskable version keeps the mark inside the safe zone.
- **2026-11-19** A new version installs quietly and waits. "Update available, tap to refresh" switches over only when you tap it; otherwise it takes over the next time the app fully closes. Old caches are deleted on activation.
- **2026-11-19** The icon badge only ever shows your real data (never demo numbers), and it is cleared at $0 or below.
- **2026-11-19** The backup reminder appears 14 days after setup or after your last backup, and "Later" hides it for 3 days. Backups are blocked in demo mode so a demo file is never mistaken for yours.
- **2026-11-19** Restoring a backup keeps a safety copy of the replaced data on the phone. After Erase everything, the app writes nothing more before it restarts at setup.
- **2026-11-19** Final review fixes (1.0.1): paydays are never expected before the first payday you entered; balance dates can't be in the future; a balance typed "right now" (setup or Reconcile) already includes what you logged today; changing only the paycheck amount keeps unanswered paydays asking; closing stacked sheets happens in one history step; one broken screen can never lock you out of the app; the update prompt comes back if another message covers it.
