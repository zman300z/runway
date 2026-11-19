// Backups and data safety: export a JSON backup, import one (with a preview), export CSV,
// a gentle reminder after 14 days, and Erase everything behind a typed confirmation.
import { html } from './dom.js';
import { icon } from './icons.js';
import { openSheet } from './sheet.js';
import { shareFile, pickTextFile } from './files.js';
import { plural } from './format.js';
import { serializeBackup, parseBackup, countData } from '../store.js';
import { transactionsToCSV } from '../csv.js';
import { markBackedUp } from '../actions.js';
import { formatDate, todayISO, diffDays } from '../dates.js';
import { APP_VERSION } from '../version.js';

const DAY_MS = 86400000;
export const BACKUP_EVERY_DAYS = 14;

/** Local date of a timestamp. */
const dateOf = (ms) => todayISO(new Date(ms));

/** True when Home should nudge you to back up. */
export function backupDue(ctx, now = Date.now()) {
  const d = ctx.data;
  if (ctx.mode === 'demo' || !d.setupDone || !d.transactions.length) return false;
  if ((ctx.ui.backupSnoozeUntil ?? 0) > now) return false;
  const since = d.meta.lastBackupAt ?? d.meta.createdAt ?? now;
  return now - since >= BACKUP_EVERY_DAYS * DAY_MS;
}

export function lastBackupText(ctx) {
  const at = ctx.data.meta.lastBackupAt;
  if (!at) return 'Never';
  const days = diffDays(dateOf(at), ctx.today);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return formatDate(dateOf(at), 'short');
}

export function backupBanner(ctx) {
  if (!backupDue(ctx)) return '';
  const at = ctx.data.meta.lastBackupAt;
  return html`<section class="card backup-banner" aria-labelledby="backup-title">
    <div class="backup-top">${icon('download')}<div>
      <h2 id="backup-title">Time for a backup</h2>
      <p class="muted small">${at ? `Your last backup was ${lastBackupText(ctx)}.` : 'You haven\'t backed up yet.'} Your data lives only on this phone, so save a copy to Files or iCloud Drive.</p>
    </div></div>
    <div class="backup-actions">
      <button type="button" class="btn btn-primary btn-sm" data-action="export-backup">Back up now</button>
      <button type="button" class="btn btn-plain btn-sm" data-action="snooze-backup">Later</button>
    </div>
  </section>`;
}

export async function exportBackup(ctx) {
  if (ctx.mode === 'demo') {
    ctx.toast('Clear demo data first, then back up your own data.', { tone: 'bad' });
    return;
  }
  const now = Date.now();
  const marked = markBackedUp(ctx.data, now);
  const text = serializeBackup(marked, { exportedAt: new Date(now).toISOString(), appVersion: APP_VERSION });
  const result = await shareFile(`runway-backup-${ctx.today}.json`, text, 'application/json');
  if (result === 'cancelled') return;
  ctx.update(() => marked);
  ctx.toast(result === 'shared' ? 'Backup ready. Saved copies stay safe even if you delete the app.' : 'Backup downloaded.');
}

export async function exportCSV(ctx) {
  const csv = transactionsToCSV(ctx.data);
  const result = await shareFile(`runway-transactions-${ctx.today}.csv`, csv, 'text/csv');
  if (result !== 'cancelled') ctx.toast(`Exported ${plural(ctx.data.transactions.length, 'transaction')}`);
}

export async function importBackup(ctx) {
  try {
    await importFlow(ctx);
  } catch (err) {
    ctx.toast(`Couldn't read that file. ${err.message}`, { tone: 'bad', duration: 7000 });
  }
}

async function importFlow(ctx) {
  const file = await pickTextFile('.json,application/json');
  if (!file) return;
  let parsed;
  try {
    parsed = parseBackup(file.text);
  } catch (err) {
    ctx.toast(err.code === 'newer' ? 'This backup is from a newer Runway. Update the app first (close and reopen it).' : err.message, { tone: 'bad', duration: 7000 });
    return;
  }
  const mine = ctx.mode === 'demo' ? ctx.realData() : ctx.data;
  const now = countData(mine);
  const incoming = parsed.counts;
  const stamp = parsed.exportedAt ? new Date(parsed.exportedAt) : null;
  const when = stamp && !Number.isNaN(stamp.getTime()) ? formatDate(todayISO(stamp), 'full') : 'an unknown date';
  const sheet = openSheet({
    title: 'Restore this backup?',
    render: () => html`
      <p class="sheet-lead">This will replace ${plural(now.transactions, 'transaction')} and ${plural(now.bills, 'bill')} on this phone with the backup from ${when}.</p>
      <dl class="recon-rows">
        <div><dt>Transactions in the backup</dt><dd>${incoming.transactions}</dd></div>
        <div><dt>Bills and subscriptions</dt><dd>${incoming.bills}</dd></div>
        <div><dt>Categories</dt><dd>${incoming.categories}</dd></div>
      </dl>
      ${ctx.mode === 'demo' ? html`<p class="note note-info">${icon('info')}<span>Restoring also leaves demo mode.</span></p>` : ''}
      <p class="sheet-foot">${icon('lock')}Runway keeps a safety copy of your current data on this phone before restoring.</p>
      <button type="button" class="btn btn-primary btn-block" data-action="restore">Replace my data</button>
      <button type="button" class="btn btn-plain btn-block" data-action="cancel">Cancel</button>`,
    actions: {
      restore() {
        ctx.replaceData(parsed.data);
        sheet.close();
        ctx.toast(`Restored ${plural(incoming.transactions, 'transaction')} from your backup`);
      },
      cancel() {
        sheet.close();
      },
    },
  });
}

export function eraseSheet(ctx) {
  const sheet = openSheet({
    title: 'Erase everything',
    render: () => html`
      <p class="sheet-lead">This deletes every transaction, bill, category and setting on this phone, demo data included. It can't be undone.</p>
      <p class="note note-warn">${icon('alert')}<span>Export a backup first if there's any chance you'll want this data again.</span></p>
      <label class="form-field">
        <span class="field-label">Type ERASE to confirm</span>
        <input type="text" class="field-input" data-input="confirm" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Type ERASE to confirm">
      </label>
      <button type="button" class="btn btn-block btn-erase" data-action="erase" disabled>Erase everything</button>`,
    inputs: {
      confirm(el, e, sh) {
        sh.body.querySelector('[data-action="erase"]').disabled = el.value.trim().toUpperCase() !== 'ERASE';
      },
    },
    actions: {
      erase(el) {
        if (el.disabled) return;
        ctx.eraseEverything(); // reloads the app, which removes this sheet too
      },
    },
  });
}

export const actions = {
  'export-backup': (ctx) => exportBackup(ctx),
  'import-backup': (ctx) => importBackup(ctx),
  'export-csv': (ctx) => exportCSV(ctx),
  'erase-all': (ctx) => eraseSheet(ctx),
  'snooze-backup': (ctx) => {
    ctx.setUI({ backupSnoozeUntil: Date.now() + 3 * DAY_MS });
    ctx.rerender();
  },
};
