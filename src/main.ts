import { Plugin, TFile, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { Storage } from './storage';
import { IdleDetector } from './idle';
import { Tracker } from './tracker';
import { TimeTrackerView } from './view/TimeTrackerView';
import { DashboardView } from './view/DashboardView';
import { VTTSettingsTab } from './settings';
import { PluginData, VIEW_TYPE, DASHBOARD_VIEW_TYPE } from './types';
import { runTimeSmokeTests } from './time';
import { formatDuration } from './util';

export default class VaultTimeTrackerPlugin extends Plugin {
  storage!: Storage;
  tracker!: Tracker;
  private idleDetector!: IdleDetector;
  private statusBarEl!: HTMLElement;

  async onload(): Promise<void> {
    // Run TZ smoke tests in development (non-production build has inline sourcemaps)
    if (process.env.NODE_ENV !== 'production') {
      try { runTimeSmokeTests(); }
      catch (e) { console.error('[VTT] Timezone smoke tests failed:', e); }
    }

    // Load and migrate persisted data
    const raw = await this.loadData();
    const data = Storage.migrate(raw);

    // Initialize services
    this.storage = new Storage(data, async (d: PluginData) => { await this.saveData(d); });
    this.idleDetector = new IdleDetector(data.settings.idleDetectionMode);
    this.tracker = new Tracker(this.app, this.storage, this.idleDetector);

    // Register views
    this.registerView(VIEW_TYPE, (leaf) => new TimeTrackerView(leaf, this));
    this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));

    // Ribbon icons
    this.addRibbonIcon('clock', 'Open Time Tracker', () => this.activateView());
    this.addRibbonIcon('table', 'Open Time Tracker Dashboard', () => this.activateDashboard());

    // Command palette
    this.addCommand({
      id: 'open-time-tracker',
      name: 'Open Time Tracker',
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: 'open-time-tracker-dashboard',
      name: 'Open Time Tracker Dashboard',
      callback: () => this.activateDashboard(),
    });

    this.addCommand({
      id: 'pause-resume-tracker',
      name: 'Pause / Resume tracking',
      callback: () => this.togglePause(),
    });

    // Settings tab
    this.addSettingTab(new VTTSettingsTab(this.app, this));

    // Workspace events
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
        this.tracker.onActiveLeafChange(leaf);
      })
    );

    this.registerEvent(
      this.app.workspace.on('file-open', (file: TFile | null) => {
        this.tracker.onFileOpen(file);
      })
    );

    // Vault events
    this.registerEvent(
      this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.storage.handleRename(oldPath, file.path);
          this.tracker.handleRename(oldPath, file.path);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', (file: TAbstractFile) => {
        if (file instanceof TFile && file.extension === 'md') {
          // If the deleted note was being tracked, stop tracking it
          if (this.tracker.getActiveNotePath() === file.path) {
            this.tracker.onFileOpen(null);
          }
        }
      })
    );

    // Status bar item — bottom right, next to word count
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass('vtt-statusbar');
    this.updateStatusBar();

    // Keep status bar in sync with every tracker tick
    this.tracker.onTick(() => this.updateStatusBar());

    // Start the tracker (begins tick + save loops, picks up active note)
    this.tracker.start();
  }

  onunload(): void {
    this.tracker.stop();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.storage.getData());
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE);

    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);
  }

  private async activateDashboard(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);

    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = workspace.getLeaf('tab');
    await leaf.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);
  }

  private togglePause(): void {
    const status = this.tracker.getStatus();
    if (status.status === 'paused' && status.reason === 'idle') {
      // Resume by re-opening the last note
      const path = this.tracker.getActiveNotePath();
      if (path) this.tracker.onFileOpen(this.app.vault.getAbstractFileByPath(path) as TFile | null);
    }
    // Note: there is no manual "pause" command in v1 — idle detection handles pausing
  }

  private updateStatusBar(): void {
    if (!this.statusBarEl) return;
    const status = this.tracker.getStatus();

    if (status.status === 'tracking') {
      const live = this.tracker.getLiveTotal();
      const timeStr = live ? formatDuration(live.totalMs) : '0s';
      // Show a small clock icon + today's total for the active note
      this.statusBarEl.setText(`⏱ ${timeStr}`);
      this.statusBarEl.setAttribute('aria-label', `Time Tracker: ${status.notePath.split('/').pop()?.replace(/\.md$/, '') ?? ''} — ${timeStr} today`);
    } else if (status.status === 'paused') {
      this.statusBarEl.setText('⏸');
      this.statusBarEl.setAttribute('aria-label', 'Time Tracker: paused');
    } else {
      this.statusBarEl.setText('');
    }
  }
}
