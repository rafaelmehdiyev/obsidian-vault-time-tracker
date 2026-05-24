import { App } from 'obsidian';
import { Storage } from '../storage';
import { Tracker } from '../tracker';
import { localDate } from '../time';
import { formatDuration, getNoteName, getMonthDates } from '../util';

export class MonthlyTab {
  private container: HTMLElement;
  private storage: Storage;
  private tracker: Tracker;
  private app: App;

  constructor(container: HTMLElement, storage: Storage, tracker: Tracker, app: App) {
    this.container = container;
    this.storage = storage;
    this.tracker = tracker;
    this.app = app;
  }

  render(): void {
    this.container.empty();
    this.container.addClass('vtt-tab-monthly');

    const settings = this.storage.getSettings();
    const tz = settings.timezone;
    const todayStr = localDate(Date.now(), tz);
    const monthDates = getMonthDates(todayStr);

    const monthly = this.storage.getMonthly(monthDates);

    // Apply live total if today is in this month (it always is)
    const live = this.tracker.getLiveTotal();
    if (live) {
      monthly[live.path] = (monthly[live.path] ?? 0);
      // Replace stored today value with live total
      const stored = this.storage.getDuration(live.path, todayStr);
      monthly[live.path] = (monthly[live.path] - stored) + live.totalMs;
    }

    const entries = Object.entries(monthly).sort((a, b) => b[1] - a[1]);
    const grandTotal = entries.reduce((sum, [, ms]) => sum + ms, 0);

    const [year, month] = todayStr.split('-').map(Number);
    const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('default', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });

    this.container.createEl('h4', { text: monthLabel, cls: 'vtt-month-heading' });

    if (entries.length === 0) {
      this.container.createEl('p', { text: 'No time tracked this month yet.', cls: 'vtt-empty' });
      return;
    }

    const table = this.container.createEl('table', { cls: 'vtt-table' });
    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    headerRow.createEl('th', { text: 'Note' });
    headerRow.createEl('th', { text: 'Time this month', cls: 'vtt-time-col' });

    const tbody = table.createEl('tbody');
    for (const [path, ms] of entries) {
      const tr = tbody.createEl('tr');
      const nameTd = tr.createEl('td', { cls: 'vtt-note-name' });

      const exists = !!this.app.vault.getAbstractFileByPath(path);
      const displayName = getNoteName(path);

      if (!exists) {
        nameTd.createEl('span', { text: displayName, cls: 'vtt-deleted' });
        nameTd.createEl('span', { text: ' (deleted)', cls: 'vtt-deleted-label' });
      } else {
        const link = nameTd.createEl('a', { text: displayName, cls: 'vtt-note-link', href: '#' });
        link.addEventListener('click', async (e) => {
          e.preventDefault();
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file) await this.app.workspace.openLinkText(path, '', false);
        });
      }

      tr.createEl('td', { text: formatDuration(ms), cls: 'vtt-time-col vtt-time-value' });
    }

    const tfoot = table.createEl('tfoot');
    const footRow = tfoot.createEl('tr', { cls: 'vtt-total-row' });
    footRow.createEl('td', { text: `Total — ${monthLabel}` });
    footRow.createEl('td', { text: formatDuration(grandTotal), cls: 'vtt-time-col vtt-time-value' });
  }
}
