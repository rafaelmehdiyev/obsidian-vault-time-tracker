import { ItemView, WorkspaceLeaf } from 'obsidian';
import { DASHBOARD_VIEW_TYPE } from '../types';
import { Storage } from '../storage';
import { Tracker, TickListener } from '../tracker';
import { localDate } from '../time';
import { formatDuration, getNoteDisplay, getWeekDates, getMonthDates, shortDayLabel } from '../util';
import type VaultTimeTrackerPlugin from '../main';

type Period = 'daily' | 'weekly' | 'monthly';
type SortKey = 'folder' | 'note' | 'total';
type SortDir = 'asc' | 'desc';

interface LiveRefs {
  path: string;
  noteTimeCell: HTMLElement;
  noteRowTotalCell?: HTMLElement;
  footerTodayCell?: HTMLElement;
  footerGrandCell: HTMLElement;
  grandBaseMs: number;
  todayBaseMs?: number;
  rowBaseMs?: number;
}

export class DashboardView extends ItemView {
  private plugin: VaultTimeTrackerPlugin;
  private storage: Storage;
  private tracker: Tracker;

  private period: Period = 'daily';
  private sortKey: SortKey = 'total';
  private sortDir: SortDir = 'desc';

  private tableWrapper: HTMLElement | null = null;
  private periodBtns: Record<Period, HTMLElement> = {} as Record<Period, HTMLElement>;
  private liveRefs: LiveRefs | null = null;
  private unsubscribeTick: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: VaultTimeTrackerPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.storage = plugin.storage;
    this.tracker = plugin.tracker;
  }

  getViewType(): string { return DASHBOARD_VIEW_TYPE; }
  getDisplayText(): string { return 'Time Tracker Dashboard'; }
  getIcon(): string { return 'clock'; }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('vtt-dashboard');

    const tabBar = container.createDiv({ cls: 'vtt-tab-bar' });
    for (const p of (['daily', 'weekly', 'monthly'] as Period[])) {
      const btn = tabBar.createEl('button', {
        text: p.charAt(0).toUpperCase() + p.slice(1),
        cls: 'vtt-tab-btn',
      });
      this.periodBtns[p] = btn;
      btn.addEventListener('click', () => this.switchPeriod(p));
    }

    this.tableWrapper = container.createDiv({ cls: 'vtt-dashboard-table-wrapper' });
    this.updatePeriodBtns();
    this.renderTable();

    const listener: TickListener = () => this.onTick();
    this.unsubscribeTick = this.tracker.onTick(listener);
  }

  async onClose(): Promise<void> {
    this.unsubscribeTick?.();
    this.unsubscribeTick = null;
  }

  private switchPeriod(p: Period): void {
    this.period = p;
    this.updatePeriodBtns();
    this.renderTable();
  }

  private updatePeriodBtns(): void {
    for (const p of (['daily', 'weekly', 'monthly'] as Period[])) {
      this.periodBtns[p]?.toggleClass('vtt-tab-btn--active', p === this.period);
    }
  }

  private onTick(): void {
    const live = this.tracker.getLiveTotal();

    if (!live) {
      if (this.liveRefs) { this.liveRefs = null; this.renderTable(); }
      return;
    }

    if (!this.liveRefs || this.liveRefs.path !== live.path) {
      this.renderTable();
      return;
    }

    // Surgical patch — avoids full DOM rebuild and scroll-position reset
    const refs = this.liveRefs;
    refs.noteTimeCell.textContent = formatDuration(live.totalMs);
    refs.footerGrandCell.textContent = formatDuration(refs.grandBaseMs + live.totalMs);
    if (refs.noteRowTotalCell !== undefined && refs.rowBaseMs !== undefined) {
      refs.noteRowTotalCell.textContent = formatDuration(refs.rowBaseMs + live.totalMs);
    }
    if (refs.footerTodayCell !== undefined && refs.todayBaseMs !== undefined) {
      refs.footerTodayCell.textContent = formatDuration(refs.todayBaseMs + live.totalMs);
    }
  }

  private renderTable(): void {
    if (!this.tableWrapper) return;
    this.tableWrapper.empty();
    this.liveRefs = null;

    switch (this.period) {
      case 'daily':   this.renderDaily();   break;
      case 'weekly':  this.renderWeekly();  break;
      case 'monthly': this.renderMonthly(); break;
    }
  }

  // ── Daily ────────────────────────────────────────────────────────────────────

  private renderDaily(): void {
    const settings = this.storage.getSettings();
    const todayStr = localDate(Date.now(), settings.timezone);

    const stored = this.storage.getDaily(todayStr);
    const live = this.tracker.getLiveTotal();
    const totals: Record<string, number> = { ...stored };
    if (live) totals[live.path] = live.totalMs;

    const paths = this.sortedPaths(Object.keys(totals), p => totals[p] ?? 0);

    if (paths.length === 0) {
      this.tableWrapper!.createEl('p', { text: 'No time tracked today yet.', cls: 'vtt-empty' });
      return;
    }

    const grandTotal = paths.reduce((s, p) => s + (totals[p] ?? 0), 0);
    const table = this.tableWrapper!.createEl('table', { cls: 'vtt-table' });
    const headerRow = table.createEl('thead').createEl('tr');
    this.makeSortHeader(headerRow, 'folder', 'Folder', 'vtt-folder-col');
    this.makeSortHeader(headerRow, 'note', 'Note');
    this.makeSortHeader(headerRow, 'total', `Time today — ${todayStr}`, 'vtt-time-col');

    const tbody = table.createEl('tbody');
    let liveTd: HTMLElement | null = null;

    for (const path of paths) {
      const { folder, name, full } = getNoteDisplay(path);
      const tr = tbody.createEl('tr');

      const folderTd = tr.createEl('td', { cls: 'vtt-folder-col' });
      folderTd.textContent = folder || '/';
      folderTd.setAttribute('title', full);

      const nameTd = tr.createEl('td', { cls: 'vtt-note-name' });
      this.renderNoteCell(nameTd, path, name, full);

      const timeTd = tr.createEl('td', { cls: 'vtt-time-col vtt-time-value', text: formatDuration(totals[path] ?? 0) });
      if (live && path === live.path) liveTd = timeTd;
    }

    const footRow = table.createEl('tfoot').createEl('tr', { cls: 'vtt-total-row' });
    const footLabel = footRow.createEl('td', { text: 'Total' });
    footLabel.colSpan = 2;
    const footGrand = footRow.createEl('td', { text: formatDuration(grandTotal), cls: 'vtt-time-col vtt-time-value' });

    if (live && liveTd) {
      this.liveRefs = {
        path: live.path,
        noteTimeCell: liveTd,
        footerGrandCell: footGrand,
        grandBaseMs: grandTotal - live.totalMs,
      };
    }
  }

  // ── Weekly ───────────────────────────────────────────────────────────────────

  private renderWeekly(): void {
    const settings = this.storage.getSettings();
    const todayStr = localDate(Date.now(), settings.timezone);
    const weekDates = getWeekDates(todayStr, settings.weekStartsOn);

    const weekly = this.storage.getWeekly(weekDates);
    const live = this.tracker.getLiveTotal();
    if (live && weekDates.includes(todayStr)) {
      if (!weekly[live.path]) weekly[live.path] = {};
      weekly[live.path][todayStr] = live.totalMs;
    }

    const rowTotals: Record<string, number> = {};
    for (const [path, days] of Object.entries(weekly)) {
      rowTotals[path] = Object.values(days).reduce((s, v) => s + v, 0);
    }

    const paths = this.sortedPaths(Object.keys(weekly), p => rowTotals[p] ?? 0);

    if (paths.length === 0) {
      this.tableWrapper!.createEl('p', { text: 'No time tracked this week yet.', cls: 'vtt-empty' });
      return;
    }

    const todayIdx = weekDates.indexOf(todayStr);
    const table = this.tableWrapper!.createEl('table', { cls: 'vtt-table vtt-table-weekly' });
    const headerRow = table.createEl('thead').createEl('tr');
    this.makeSortHeader(headerRow, 'folder', 'Folder', 'vtt-folder-col');
    this.makeSortHeader(headerRow, 'note', 'Note');
    for (let i = 0; i < weekDates.length; i++) {
      const th = headerRow.createEl('th', { text: shortDayLabel(weekDates[i]), cls: 'vtt-time-col' });
      if (i === todayIdx) th.addClass('vtt-today-col');
    }
    this.makeSortHeader(headerRow, 'total', 'Total', 'vtt-time-col vtt-week-total-col');

    const tbody = table.createEl('tbody');
    const colTotals: number[] = weekDates.map(() => 0);
    let grandTotal = 0;
    let liveTodayTd: HTMLElement | null = null;
    let liveRowTotalTd: HTMLElement | null = null;

    for (const path of paths) {
      const { folder, name, full } = getNoteDisplay(path);
      const tr = tbody.createEl('tr');

      const folderTd = tr.createEl('td', { cls: 'vtt-folder-col' });
      folderTd.textContent = folder || '/';
      folderTd.setAttribute('title', full);

      const nameTd = tr.createEl('td', { cls: 'vtt-note-name' });
      this.renderNoteCell(nameTd, path, name, full);

      let rowTotal = 0;
      const dayTds: HTMLElement[] = [];
      for (let i = 0; i < weekDates.length; i++) {
        const ms = weekly[path]?.[weekDates[i]] ?? 0;
        const td = tr.createEl('td', {
          text: ms > 0 ? formatDuration(ms) : '—',
          cls: 'vtt-time-col vtt-time-value',
        });
        if (i === todayIdx) td.addClass('vtt-today-col');
        colTotals[i] += ms;
        rowTotal += ms;
        dayTds.push(td);
      }

      const rowTotalTd = tr.createEl('td', {
        text: formatDuration(rowTotal),
        cls: 'vtt-time-col vtt-time-value vtt-week-total-col',
      });
      grandTotal += rowTotal;

      if (live && path === live.path && todayIdx >= 0) {
        liveTodayTd = dayTds[todayIdx];
        liveRowTotalTd = rowTotalTd;
      }
    }

    const footRow = table.createEl('tfoot').createEl('tr', { cls: 'vtt-total-row' });
    const footLabel = footRow.createEl('td', { text: 'Total' });
    footLabel.colSpan = 2;
    const footerColTds: HTMLElement[] = [];
    for (let i = 0; i < weekDates.length; i++) {
      const td = footRow.createEl('td', {
        text: colTotals[i] > 0 ? formatDuration(colTotals[i]) : '—',
        cls: 'vtt-time-col vtt-time-value',
      });
      if (i === todayIdx) td.addClass('vtt-today-col');
      footerColTds.push(td);
    }
    const footGrand = footRow.createEl('td', {
      text: formatDuration(grandTotal),
      cls: 'vtt-time-col vtt-time-value vtt-week-total-col',
    });

    if (live && liveTodayTd && liveRowTotalTd && todayIdx >= 0) {
      this.liveRefs = {
        path: live.path,
        noteTimeCell: liveTodayTd,
        noteRowTotalCell: liveRowTotalTd,
        footerTodayCell: footerColTds[todayIdx],
        footerGrandCell: footGrand,
        grandBaseMs: grandTotal - live.totalMs,
        todayBaseMs: colTotals[todayIdx] - live.totalMs,
        rowBaseMs: (rowTotals[live.path] ?? 0) - live.totalMs,
      };
    }
  }

  // ── Monthly ──────────────────────────────────────────────────────────────────

  private renderMonthly(): void {
    const settings = this.storage.getSettings();
    const todayStr = localDate(Date.now(), settings.timezone);
    const monthDates = getMonthDates(todayStr);

    const monthly = this.storage.getMonthly(monthDates);
    const live = this.tracker.getLiveTotal();
    if (live) {
      const stored = this.storage.getDuration(live.path, todayStr);
      monthly[live.path] = (monthly[live.path] ?? 0) - stored + live.totalMs;
    }

    const paths = this.sortedPaths(Object.keys(monthly), p => monthly[p] ?? 0);

    const [year, month] = todayStr.split('-').map(Number);
    const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('default', {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    });

    if (paths.length === 0) {
      this.tableWrapper!.createEl('p', { text: 'No time tracked this month yet.', cls: 'vtt-empty' });
      return;
    }

    const grandTotal = paths.reduce((s, p) => s + (monthly[p] ?? 0), 0);
    const table = this.tableWrapper!.createEl('table', { cls: 'vtt-table' });
    const headerRow = table.createEl('thead').createEl('tr');
    this.makeSortHeader(headerRow, 'folder', 'Folder', 'vtt-folder-col');
    this.makeSortHeader(headerRow, 'note', 'Note');
    this.makeSortHeader(headerRow, 'total', `Time — ${monthLabel}`, 'vtt-time-col');

    const tbody = table.createEl('tbody');
    let liveTd: HTMLElement | null = null;

    for (const path of paths) {
      const { folder, name, full } = getNoteDisplay(path);
      const tr = tbody.createEl('tr');

      const folderTd = tr.createEl('td', { cls: 'vtt-folder-col' });
      folderTd.textContent = folder || '/';
      folderTd.setAttribute('title', full);

      const nameTd = tr.createEl('td', { cls: 'vtt-note-name' });
      this.renderNoteCell(nameTd, path, name, full);

      const timeTd = tr.createEl('td', { cls: 'vtt-time-col vtt-time-value', text: formatDuration(monthly[path] ?? 0) });
      if (live && path === live.path) liveTd = timeTd;
    }

    const footRow = table.createEl('tfoot').createEl('tr', { cls: 'vtt-total-row' });
    const footLabel = footRow.createEl('td', { text: `Total — ${monthLabel}` });
    footLabel.colSpan = 2;
    const footGrand = footRow.createEl('td', { text: formatDuration(grandTotal), cls: 'vtt-time-col vtt-time-value' });

    if (live && liveTd) {
      this.liveRefs = {
        path: live.path,
        noteTimeCell: liveTd,
        footerGrandCell: footGrand,
        grandBaseMs: grandTotal - live.totalMs,
      };
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private renderNoteCell(td: HTMLElement, path: string, name: string, full: string): void {
    const exists = !!this.app.vault.getAbstractFileByPath(path);
    if (!exists) {
      const span = td.createEl('span', { text: name, cls: 'vtt-deleted' });
      span.setAttribute('title', full);
      td.createEl('span', { text: ' (deleted)', cls: 'vtt-deleted-label' });
    } else {
      const link = td.createEl('a', { text: name, cls: 'vtt-note-link', href: '#' });
      link.setAttribute('title', full);
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        await this.app.workspace.openLinkText(path, '', false);
      });
    }
  }

  private makeSortHeader(row: HTMLElement, key: SortKey, text: string, cls?: string): void {
    const th = cls ? row.createEl('th', { cls }) : row.createEl('th');
    const arrow = this.sortKey === key ? (this.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    th.textContent = text + arrow;
    th.addClass('vtt-sortable');
    th.addEventListener('click', () => {
      if (this.sortKey === key) {
        this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortKey = key;
        this.sortDir = key === 'total' ? 'desc' : 'asc';
      }
      this.renderTable();
    });
  }

  private sortedPaths(paths: string[], getTotalMs: (path: string) => number): string[] {
    return [...paths].sort((a, b) => {
      const da = getNoteDisplay(a);
      const db = getNoteDisplay(b);
      let primary: number;
      if (this.sortKey === 'folder') {
        primary = da.folder.localeCompare(db.folder);
      } else if (this.sortKey === 'note') {
        primary = da.name.localeCompare(db.name);
      } else {
        primary = getTotalMs(a) - getTotalMs(b); // ascending; negated below when desc
      }
      if (primary === 0) primary = da.name.localeCompare(db.name);
      return this.sortDir === 'asc' ? primary : -primary;
    });
  }
}
