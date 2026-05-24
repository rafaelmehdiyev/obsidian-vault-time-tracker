import { App } from 'obsidian';
import { Storage } from '../storage';
import { Tracker } from '../tracker';
import { localDate } from '../time';
import { formatDuration, getNoteName, getWeekDates, shortDayLabel } from '../util';

export class WeeklyTab {
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
    this.container.addClass('vtt-tab-weekly');

    const settings = this.storage.getSettings();
    const tz = settings.timezone;
    const todayStr = localDate(Date.now(), tz);
    const weekDates = getWeekDates(todayStr, settings.weekStartsOn);

    // Fetch stored weekly data
    const weekly = this.storage.getWeekly(weekDates);

    // Apply live total for the active note if today is in this week
    const live = this.tracker.getLiveTotal();
    if (live && weekDates.includes(todayStr)) {
      if (!weekly[live.path]) weekly[live.path] = {};
      weekly[live.path][todayStr] = live.totalMs;
    }

    const paths = Object.keys(weekly).sort((a, b) => {
      const totalA = Object.values(weekly[a]).reduce((s, v) => s + v, 0);
      const totalB = Object.values(weekly[b]).reduce((s, v) => s + v, 0);
      return totalB - totalA;
    });

    if (paths.length === 0) {
      this.container.createEl('p', { text: 'No time tracked this week yet.', cls: 'vtt-empty' });
      return;
    }

    const table = this.container.createEl('table', { cls: 'vtt-table vtt-table-weekly' });
    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    headerRow.createEl('th', { text: 'Note' });
    for (const d of weekDates) {
      const th = headerRow.createEl('th', { text: shortDayLabel(d), cls: 'vtt-time-col' });
      if (d === todayStr) th.addClass('vtt-today-col');
    }
    headerRow.createEl('th', { text: 'Total', cls: 'vtt-time-col vtt-week-total-col' });

    const tbody = table.createEl('tbody');
    const colTotals: number[] = weekDates.map(() => 0);
    let grandTotal = 0;

    for (const path of paths) {
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

      let rowTotal = 0;
      weekDates.forEach((d, i) => {
        const ms = weekly[path][d] ?? 0;
        const td = tr.createEl('td', { text: ms > 0 ? formatDuration(ms) : '—', cls: 'vtt-time-col vtt-time-value' });
        if (d === todayStr) td.addClass('vtt-today-col');
        colTotals[i] += ms;
        rowTotal += ms;
      });

      tr.createEl('td', { text: formatDuration(rowTotal), cls: 'vtt-time-col vtt-time-value vtt-week-total-col' });
      grandTotal += rowTotal;
    }

    const tfoot = table.createEl('tfoot');
    const footRow = tfoot.createEl('tr', { cls: 'vtt-total-row' });
    footRow.createEl('td', { text: 'Total' });
    weekDates.forEach((d, i) => {
      const td = footRow.createEl('td', { text: colTotals[i] > 0 ? formatDuration(colTotals[i]) : '—', cls: 'vtt-time-col vtt-time-value' });
      if (d === todayStr) td.addClass('vtt-today-col');
    });
    footRow.createEl('td', { text: formatDuration(grandTotal), cls: 'vtt-time-col vtt-time-value vtt-week-total-col' });
  }
}
