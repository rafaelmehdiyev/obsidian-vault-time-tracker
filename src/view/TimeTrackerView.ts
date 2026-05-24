import { ItemView, WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE } from '../types';
import { Storage } from '../storage';
import { Tracker, TickListener } from '../tracker';
import { DailyTab } from './DailyTab';
import { WeeklyTab } from './WeeklyTab';
import { MonthlyTab } from './MonthlyTab';
import type VaultTimeTrackerPlugin from '../main';

type TabId = 'daily' | 'weekly' | 'monthly';

export class TimeTrackerView extends ItemView {
  private plugin: VaultTimeTrackerPlugin;
  private storage: Storage;
  private tracker: Tracker;

  private activeTab: TabId = 'daily';
  private tabContent: HTMLElement | null = null;
  private tabButtons: Record<TabId, HTMLElement> = {} as Record<TabId, HTMLElement>;
  private statusBar: HTMLElement | null = null;

  private unsubscribeTick: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: VaultTimeTrackerPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.storage = plugin.storage;
    this.tracker = plugin.tracker;
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return 'Time Tracker'; }
  getIcon(): string { return 'clock'; }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass('vtt-view');

    // ── Status bar (currently tracking) ──────────────────────────────────────
    this.statusBar = root.createDiv({ cls: 'vtt-status-bar' });

    // ── Tab selector ─────────────────────────────────────────────────────────
    const tabBar = root.createDiv({ cls: 'vtt-tab-bar' });
    const tabs: TabId[] = ['daily', 'weekly', 'monthly'];
    for (const tab of tabs) {
      const btn = tabBar.createEl('button', { text: tab.charAt(0).toUpperCase() + tab.slice(1), cls: 'vtt-tab-btn' });
      this.tabButtons[tab] = btn;
      btn.addEventListener('click', () => this.switchTab(tab));
    }

    // ── Tab content ───────────────────────────────────────────────────────────
    this.tabContent = root.createDiv({ cls: 'vtt-tab-content' });

    this.switchTab(this.activeTab);

    // Subscribe to tick updates
    const listener: TickListener = () => {
      this.updateStatusBar();
      this.renderActiveTab();
    };
    this.unsubscribeTick = this.tracker.onTick(listener);
    this.updateStatusBar();
  }

  async onClose(): Promise<void> {
    this.unsubscribeTick?.();
    this.unsubscribeTick = null;
  }

  private switchTab(tab: TabId): void {
    this.activeTab = tab;

    // Update button active states
    for (const [id, btn] of Object.entries(this.tabButtons)) {
      btn.toggleClass('vtt-tab-btn--active', id === tab);
    }

    this.renderActiveTab();
  }

  private renderActiveTab(): void {
    if (!this.tabContent) return;
    this.tabContent.empty();

    const app = this.app;
    switch (this.activeTab) {
      case 'daily':
        new DailyTab(this.tabContent, this.storage, this.tracker, app).render();
        break;
      case 'weekly':
        new WeeklyTab(this.tabContent, this.storage, this.tracker, app).render();
        break;
      case 'monthly':
        new MonthlyTab(this.tabContent, this.storage, this.tracker, app).render();
        break;
    }
  }

  private updateStatusBar(): void {
    if (!this.statusBar) return;
    this.statusBar.empty();

    const status = this.tracker.getStatus();
    if (status.status === 'tracking') {
      const live = this.tracker.getLiveTotal();
      const timeStr = live ? this.formatLive(live.totalMs) : '0s';
      const noteName = status.notePath.split('/').pop()?.replace(/\.md$/, '') ?? status.notePath;
      this.statusBar.createSpan({ cls: 'vtt-status-dot vtt-status-dot--active' });
      this.statusBar.createSpan({ text: ` ${noteName} · ${timeStr}`, cls: 'vtt-status-text' });
    } else if (status.status === 'paused') {
      this.statusBar.createSpan({ cls: 'vtt-status-dot vtt-status-dot--paused' });
      const reason = status.reason === 'idle' ? 'idle' : status.reason === 'suspend' ? 'suspended' : 'excluded';
      this.statusBar.createSpan({ text: ` Paused (${reason})`, cls: 'vtt-status-text' });
    } else {
      this.statusBar.createSpan({ cls: 'vtt-status-dot vtt-status-dot--idle' });
      this.statusBar.createSpan({ text: ' No note active', cls: 'vtt-status-text' });
    }
  }

  private formatLive(ms: number): string {
    if (ms <= 0) return '0s';
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }
}
