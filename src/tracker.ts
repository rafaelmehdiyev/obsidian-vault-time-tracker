import { App, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { Storage } from './storage';
import { IdleDetector } from './idle';
import { localDate, localMidnightUtc } from './time';
import { isExcluded, isTrackedExtension } from './util';
import { Session, TrackerStatus } from './types';

export type TickListener = (status: TrackerStatus, liveTotalMs: number) => void;

export interface LiveTotal {
  path: string;
  totalMs: number;
}

export class Tracker {
  private app: App;
  private storage: Storage;
  private idle: IdleDetector;

  private status: TrackerStatus = { status: 'idle' };

  // Active in-flight session (not yet finalized)
  private activeSession: Session | null = null;
  // Value in dailyTotals at the moment this session started — used for absolute set
  private sessionBase: number = 0;
  private sessionStartMs: number = 0;

  private lastKnownNotePath: string | null = null;

  private tickIntervalId: ReturnType<typeof setInterval> | null = null;
  private saveIntervalId: ReturnType<typeof setInterval> | null = null;
  private powerMonitorCleanup: (() => void) | null = null;

  private tickListeners: Set<TickListener> = new Set();

  constructor(app: App, storage: Storage, idle: IdleDetector) {
    this.app = app;
    this.storage = storage;
    this.idle = idle;
  }

  start(): void {
    const settings = this.storage.getSettings();

    // Clamp to safe minimums so a corrupted data.json can't spin the event loop
    const tickMs   = Math.max(200,   Number.isFinite(settings.tickIntervalMs)      ? settings.tickIntervalMs      : 1000);
    const saveMs   = Math.max(5000,  Number.isFinite(settings.saveIntervalSeconds) ? settings.saveIntervalSeconds * 1000 : 30000);

    this.tickIntervalId = setInterval(() => this.tick(), tickMs);
    this.saveIntervalId = setInterval(() => this.periodicSave(), saveMs);

    this.powerMonitorCleanup = this.idle.tryAttachPowerMonitor(
      () => this.onSuspend(),
      () => this.onResume(),
    );

    // Pick up the currently active note if one is already open
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile instanceof TFile && isTrackedExtension(activeFile.extension)) {
      this.beginTracking(activeFile.path);
    }
  }

  /** Re-read tickIntervalMs / saveIntervalSeconds from settings and restart the
   *  internal intervals without touching the active session. Call this whenever
   *  the user saves settings so changes take effect immediately. */
  refreshIntervals(): void {
    const settings = this.storage.getSettings();
    const tickMs = Math.max(200,  Number.isFinite(settings.tickIntervalMs)      ? settings.tickIntervalMs              : 1000);
    const saveMs = Math.max(5000, Number.isFinite(settings.saveIntervalSeconds) ? settings.saveIntervalSeconds * 1000  : 30000);

    if (this.tickIntervalId !== null) { clearInterval(this.tickIntervalId); }
    if (this.saveIntervalId !== null) { clearInterval(this.saveIntervalId); }

    this.tickIntervalId = setInterval(() => this.tick(), tickMs);
    this.saveIntervalId = setInterval(() => this.periodicSave(), saveMs);
  }

  stop(): void {
    if (this.tickIntervalId !== null) { clearInterval(this.tickIntervalId); this.tickIntervalId = null; }
    if (this.saveIntervalId !== null) { clearInterval(this.saveIntervalId); this.saveIntervalId = null; }
    this.powerMonitorCleanup?.();
    this.powerMonitorCleanup = null;
    this.finalizeSession('unload');
    this.periodicSave(); // flush to disk synchronously in memory; async write starts
    this.idle.destroy();
  }

  onActiveLeafChange(leaf: WorkspaceLeaf | null): void {
    if (!leaf) {
      // No active leaf at all — file was closed, stop tracking
      if (this.status.status !== 'idle') {
        this.finalizeSession('switch');
        this.status = { status: 'idle' };
      }
      return;
    }

    const file = (leaf.view as unknown as { file?: unknown }).file;

    if (file instanceof TFile && isTrackedExtension(file.extension)) {
      if (file.path !== this.lastKnownNotePath) {
        this.switchNote(file.path);
      }
      return;
    }

    // Non-tracked view is now active.
    // If the last known file is no longer open in any leaf, the user closed it → go idle.
    if (this.lastKnownNotePath && !this.isFileOpenInWorkspace(this.lastKnownNotePath)) {
      this.finalizeSession('switch');
      this.status = { status: 'idle' };
      return;
    }

    // The file is still open in another leaf (e.g. user switched to graph/settings).
    // Respect countWhileNonNoteViewActive.
    if (!this.storage.getSettings().countWhileNonNoteViewActive) {
      this.finalizeSession('switch');
      this.status = { status: 'idle' };
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /** Returns true if the given path is still open in any workspace leaf
   *  (root, sidebars, split panes, and floating/popout windows). */
  private isFileOpenInWorkspace(path: string): boolean {
    let found = false;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (found) return;
      const f = (leaf.view as unknown as { file?: unknown }).file;
      if (f instanceof TFile && f.path === path) found = true;
    });
    return found;
  }

  onFileOpen(file: TFile | null): void {
    if (!file) {
      // file-open(null) fires after the active file is cleared — the leaf's .file
      // is already null by this point, so iterateAllLeaves won't see it.
      // If the last tracked file is gone from every leaf, go idle.
      if (this.lastKnownNotePath && !this.isFileOpenInWorkspace(this.lastKnownNotePath)) {
        this.finalizeSession('switch');
        this.status = { status: 'idle' };
      }
      return;
    }
    if (!isTrackedExtension(file.extension)) return;
    if (file.path !== this.lastKnownNotePath) {
      this.switchNote(file.path);
    }
  }

  handleRename(oldPath: string, newPath: string): void {
    if (this.status.status !== 'idle' && this.status.notePath === oldPath) {
      (this.status as { notePath: string }).notePath = newPath;
    }
    if (this.activeSession?.notePath === oldPath) this.activeSession.notePath = newPath;
    if (this.lastKnownNotePath === oldPath) this.lastKnownNotePath = newPath;

    // If the renamed path is now excluded, stop tracking it
    if (this.status.status === 'tracking' && this.status.notePath === newPath) {
      if (isExcluded(newPath, this.storage.getSettings().excludedFolders)) {
        this.finalizeSession('excluded');
        this.status = { status: 'idle' };
      }
    }
  }

  getStatus(): TrackerStatus { return this.status; }

  getActiveNotePath(): string | null {
    if (this.status.status === 'idle') return null;
    return this.status.notePath || null;
  }

  getLiveTotal(): LiveTotal | null {
    if (this.status.status !== 'tracking' || !this.activeSession) return null;
    return {
      path: this.activeSession.notePath,
      totalMs: this.sessionBase + (Date.now() - this.sessionStartMs),
    };
  }

  onTick(listener: TickListener): () => void {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private switchNote(newPath: string): void {
    if (this.status.status !== 'idle') {
      this.finalizeSession('switch');
    }
    this.lastKnownNotePath = newPath;

    if (isExcluded(newPath, this.storage.getSettings().excludedFolders)) {
      this.status = { status: 'paused', notePath: newPath, reason: 'excluded' };
      return;
    }

    this.beginTracking(newPath);
  }

  private beginTracking(path: string): void {
    if (isExcluded(path, this.storage.getSettings().excludedFolders)) {
      this.status = { status: 'paused', notePath: path, reason: 'excluded' };
      return;
    }

    const nowMs = Date.now();
    const tz = this.storage.getSettings().timezone;
    const date = localDate(nowMs, tz);

    // Capture what's already stored for today — new time adds on top
    this.sessionBase = this.storage.getDuration(path, date);
    this.sessionStartMs = nowMs;

    const session: Session = {
      id: crypto.randomUUID(),
      notePath: path,
      startUtc: new Date(nowMs).toISOString(),
      endUtc: new Date(nowMs).toISOString(),
      durationMs: 0,
      localDate: date,
    };

    this.activeSession = session;
    this.lastKnownNotePath = path;
    this.status = { status: 'tracking', notePath: path, sessionId: session.id };
  }

  private finalizeSession(reason: Session['endReason']): void {
    if (!this.activeSession) return;

    const nowMs = Date.now();
    const session = this.activeSession;
    const sessionMs = nowMs - this.sessionStartMs;
    const totalMs = this.sessionBase + sessionMs;

    session.endUtc = new Date(nowMs).toISOString();
    session.durationMs = Math.max(0, sessionMs);
    session.endReason = reason;

    this.storage.setDuration(session.notePath, session.localDate, Math.max(0, totalMs));
    this.storage.upsertSession(session);

    this.activeSession = null;
    this.sessionBase = 0;
    this.sessionStartMs = 0;
  }

  private tick(): void {
    const settings = this.storage.getSettings();

    // If paused due to idle, check whether activity has resumed
    if (this.status.status === 'paused' && this.status.reason === 'idle') {
      if (
        settings.idleThresholdMinutes > 0 &&
        settings.idleDetectionMode !== 'off' &&
        this.lastKnownNotePath
      ) {
        const idleSec = this.idle.getIdleSeconds();
        if (idleSec < settings.idleThresholdMinutes * 60) {
          // Activity resumed — start a new session on the last-known note
          this.beginTracking(this.lastKnownNotePath);
          // fall through to the tracking path below
        } else {
          this.notifyListeners();
          return;
        }
      } else {
        this.notifyListeners();
        return;
      }
    }

    // Belt-and-suspenders: verify the tracked file is still open in the workspace.
    // Events (active-leaf-change, file-open) have ordering gaps when a tab is
    // closed, so this tick-level check guarantees we catch it within one tick.
    if (this.lastKnownNotePath && !this.isFileOpenInWorkspace(this.lastKnownNotePath)) {
      if (this.status.status === 'tracking') {
        this.finalizeSession('switch');
      }
      this.status = { status: 'idle' };
      this.lastKnownNotePath = null;
      this.notifyListeners();
      return;
    }

    if (this.status.status !== 'tracking') {
      this.notifyListeners();
      return;
    }

    const nowMs = Date.now();
    const tz = settings.timezone;

    // Check for midnight rollover
    if (this.activeSession && localDate(nowMs, tz) !== this.activeSession.localDate) {
      this.handleMidnightSplit(tz);
      return;
    }

    // Check idle
    if (settings.idleThresholdMinutes > 0 && settings.idleDetectionMode !== 'off') {
      const idleSec = this.idle.getIdleSeconds();
      if (idleSec >= settings.idleThresholdMinutes * 60) {
        this.handleIdlePause(idleSec);
        return;
      }
    }

    // Update session's endUtc in memory (for crash safety on next periodic save)
    if (this.activeSession) {
      this.activeSession.endUtc = new Date(nowMs).toISOString();
    }

    this.notifyListeners();
  }

  private handleMidnightSplit(tz: string): void {
    if (!this.activeSession) return;

    const session = this.activeSession;
    const oldDate = session.localDate;
    const nowMs = Date.now();

    // The boundary is midnight of the NEW local date
    const newDate = localDate(nowMs, tz);
    const boundaryMs = localMidnightUtc(newDate, tz);

    // Time in the old day: from sessionStart to the midnight boundary
    const durationInOldDay = Math.max(0, boundaryMs - this.sessionStartMs);
    const totalInOldDay = this.sessionBase + durationInOldDay;

    // Finalize old session at boundary
    session.endUtc = new Date(boundaryMs).toISOString();
    session.durationMs = durationInOldDay;
    session.endReason = 'midnight';
    this.storage.setDuration(session.notePath, oldDate, Math.max(0, totalInOldDay));
    this.storage.upsertSession(session);

    // Start new session from boundary in new day
    const newBase = this.storage.getDuration(session.notePath, newDate); // 0 for a fresh day
    const newSession: Session = {
      id: crypto.randomUUID(),
      notePath: session.notePath,
      startUtc: new Date(boundaryMs).toISOString(),
      endUtc: new Date(boundaryMs).toISOString(),
      durationMs: 0,
      localDate: newDate,
      splitFromId: session.id,
    };

    this.activeSession = newSession;
    this.sessionBase = newBase;
    this.sessionStartMs = boundaryMs;
    this.status = { status: 'tracking', notePath: session.notePath, sessionId: newSession.id };

    this.notifyListeners();
  }

  private handleIdlePause(idleSec: number): void {
    if (!this.activeSession) return;

    const nowMs = Date.now();
    const session = this.activeSession;

    // Trim session to when activity stopped
    const idleStartMs = Math.max(this.sessionStartMs, nowMs - Math.floor(idleSec) * 1000);
    const sessionMs = Math.max(0, idleStartMs - this.sessionStartMs);
    const totalMs = this.sessionBase + sessionMs;

    session.endUtc = new Date(idleStartMs).toISOString();
    session.durationMs = sessionMs;
    session.endReason = 'idle';

    this.storage.setDuration(session.notePath, session.localDate, Math.max(0, totalMs));
    this.storage.upsertSession(session);

    this.activeSession = null;
    this.sessionBase = 0;
    this.sessionStartMs = 0;

    const pausedPath = this.status.status !== 'idle' ? this.status.notePath : (this.lastKnownNotePath ?? '');
    this.status = { status: 'paused', notePath: pausedPath, reason: 'idle' };

    this.notifyListeners();
  }

  private onSuspend(): void {
    if (this.status.status === 'tracking') {
      this.finalizeSession('suspend');
      const path = this.lastKnownNotePath ?? '';
      this.status = { status: 'paused', notePath: path, reason: 'suspend' };
      this.periodicSave();
    }
  }

  private onResume(): void {
    // Only resume if the last known file is actually still open (it may have been
    // closed while the device was suspended).
    if (
      this.lastKnownNotePath &&
      this.isFileOpenInWorkspace(this.lastKnownNotePath) &&
      !isExcluded(this.lastKnownNotePath, this.storage.getSettings().excludedFolders)
    ) {
      this.beginTracking(this.lastKnownNotePath);
    }
  }

  private periodicSave(): void {
    // Persist in-flight session state for crash safety
    if (this.activeSession && this.status.status === 'tracking') {
      const nowMs = Date.now();
      const currentMs = nowMs - this.sessionStartMs;
      const totalMs = this.sessionBase + currentMs;

      this.activeSession.endUtc = new Date(nowMs).toISOString();
      this.activeSession.durationMs = currentMs;

      this.storage.setDuration(this.activeSession.notePath, this.activeSession.localDate, Math.max(0, totalMs));
      this.storage.upsertSession(this.activeSession);
    }

    // Clamp to at least 1 so we never prune the session we just upserted
    const pruneDays = Math.max(1, this.storage.getSettings().pruneSessionsAfterDays || 7);
    this.storage.pruneOldSessions(pruneDays);
    this.storage.pruneOldRenames(pruneDays);
    this.storage.flush().catch(err => {
      console.error('[VTT] save error:', err);
      new Notice('⏱ Time Tracker: failed to save data — check the console for details.');
    });
  }

  private notifyListeners(): void {
    const live = this.getLiveTotal();
    const liveTotalMs = live ? live.totalMs : 0;
    for (const listener of this.tickListeners) {
      listener(this.status, liveTotalMs);
    }
  }
}
