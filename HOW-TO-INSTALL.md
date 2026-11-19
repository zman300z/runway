# How to install and use Runway

Runway lives at this link:

**https://zman300z.github.io/runway/**

It's a web app that installs to your iPhone's home screen and then works like a normal app, even in airplane mode. Your money data is saved only on your phone. Nothing is ever sent to GitHub or anywhere else.

## Install it on your iPhone (1 minute)

1. Open **Safari** on your iPhone (it has to be Safari, not Chrome).
2. Go to **https://zman300z.github.io/runway/**
3. Tap the **Share** button (the square with an arrow pointing up, at the bottom of the screen).
4. Scroll down and tap **Add to Home Screen**.
5. Tap **Add** in the top right corner.
6. From now on, **always open Runway from its icon** on your home screen, never from Safari.

Why the icon matters: iPhone keeps the home screen app's data separate from Safari's. If you log purchases in a Safari tab, they won't show up in the app (and the other way around).

## The first 3 things to do

1. **Finish setup.** Open the app, tap Get started, and answer the 5 quick questions (balance, pay, monthly limit, savings goal, demo data). You can skip any of them and change them later in Settings (the gear on Home).
2. **Add your bills.** Go to the Bills tab, tap +, and add rent, your phone plan and every subscription. Runway posts each charge on its date automatically, even on days you don't open the app.
3. **Log your next purchase.** Tap the big + at the bottom, type the amount, tap a category, tap Add. That's it.

Tip: the little **?** next to any number shows exactly how it's calculated, with your real numbers.

## Using a credit card

1. **Add the card.** Settings (the gear on Home), Credit cards, Add a credit card. Your card app shows the statement closing day and the payment due day. Add your credit limit, your own monthly cap, and turn on Autopay if it's set up.
2. **Log a card purchase.** In Quick Add, tap the **Debit** button once so it shows your card, then log as usual. Debit stays the default every time.
3. **Read Home.** *Bank balance* is what's really in your account. *Credit card owed* is everything on the card. *After card is paid off* is your bank balance once the card is paid. Card purchases count as spending the day you make them, and paying the card never counts as spending.
4. **When Runway asks, answer.** On the closing day it asks you to confirm the statement balance from your card app, and on the due day it asks how much left your bank. If the card app ever shows a different balance, open the card (Card details on Home) and tap **Reconcile**.

The cash back numbers are always estimates, because your categories won't match the card company's exactly.

## How to update the app later

1. Tell Claude Code what you want changed, in plain words.
2. Claude makes the change, runs the tests, bumps the version, and pushes it to GitHub.
3. Wait about a minute for GitHub to publish it.
4. Open Runway on your phone. You'll see **"Update available, tap to refresh"**. Tap it.

Your data stays put through every update. If the message doesn't appear, close Runway completely (swipe it away in the app switcher) and open it again.

## How to back up your data

Do this every couple of weeks, and **always before deleting the app or switching phones**.

1. Open Runway and tap the **gear** on Home to open Settings.
2. Tap **Export backup**.
3. In the share sheet, tap **Save to Files**, then pick **iCloud Drive** (or On My iPhone) and tap **Save**.

To restore: Settings, **Import backup**, pick the file. Runway shows you what will be replaced before anything changes, and keeps a safety copy of what was there.

You can also tap **Export transactions (CSV)** to open your purchases in Excel or Google Sheets.

Runway reminds you on Home if you haven't backed up in 14 days.

## If the command line ever fails: upload with the website instead

If Claude Code can't push for some reason, you can update the site by hand:

1. On your computer, go to **https://github.com/zman300z/runway** and sign in.
2. Click **Add file**, then **Upload files**.
3. Open the `runway` folder on your Desktop in File Explorer, and drag in the files and folders that changed (for example `index.html`, `sw.js`, the `js` folder, the `css` folder).
4. Write a short note like "Update app" in the box at the bottom, and click **Commit changes**.
5. Wait about a minute, then open the app on your phone.

Important: whenever you change anything, the version number in `sw.js` and `js/version.js` must go up (Claude does this with `node tools/release.js`). Without that, phones keep showing the old version.

## Troubleshooting

**The page is blank.**
Usually a file path problem after a change. Make sure the link ends with `/runway/` (with the slash). If you changed files by hand, check that every file was uploaded, including the `js` and `css` folders. Then close the app and reopen it.

**An old version keeps showing.**
Close Runway completely (swipe up from the bottom and swipe the app away), then open it again. If it still looks old, wait a minute and repeat. Updates install in the background and switch over when you tap "Update available" or fully close the app.

**The icon is missing or looks wrong.**
Remove it from the home screen (press and hold the icon, tap Remove or Delete, and confirm), then add it again from Safari with the steps above. Export a backup first: removing the icon can delete the app's data.

**My data is gone.**
Check that you opened Runway from the home screen icon, not a Safari tab (they keep separate data). If you deleted and re-added the app, import your latest backup from Settings.

**The app icon badge doesn't show a number.**
Turn it on in Settings ("Show today's safe-to-spend on the app icon") and allow notifications when asked. The badge updates when you open Runway. If it's $0 or below, the badge is cleared on purpose.

## Two-minute check on your phone

After installing, try these once:

- Turn on airplane mode and open Runway from the icon. It should open normally.
- Tap +, type 4.50, tap Coffee, tap Add. The purchase appears under Recent.
- Swipe the purchase left in Activity to delete it, then tap Undo.
- Switch your iPhone between light and dark mode (Settings, Display and Brightness). Runway should follow.
- Tap a **?** on Home and read how the number is calculated.

## Why the code is public

GitHub Pages hosts free websites only from public repositories. The repository holds **only the app's code**, which has no personal information in it. Your balance, purchases and bills live only in your phone's storage and are never uploaded.
