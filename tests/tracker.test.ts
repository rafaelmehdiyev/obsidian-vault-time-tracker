import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
// 'obsidian' is aliased to tests/__mocks__/obsidian.ts in vitest.config.ts.
// Both tracker.ts and this file import the same TFile class, so instanceof works.
import { TFile } from 'obsidian';
import type { App, WorkspaceLeaf } from 'obsidian';
import { Tracker } from '../src/tracker';
import { Storage } from '../src/storage';
import type { IdleDetector } from '../src/idle';
import { DEFAULT_DATA } from '../src/types';
import type { TimeTrackerSettings, PluginData } from '../src/types';

// ── Harness helpers ───────────────────────────────────────────────────────────

function makeTFile(path: string, extension = 'md'): TFile {
  // Object.create so instanceof TFile passes (same prototype as the mocked class)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f = Object.create((TFile as any).prototype);
  f.path = path;
  f.extension = extension;
  return f as TFile;
}

function makeLeaf(file: TFile | null): WorkspaceLeaf {
  return { view: { file } } as unknown as WorkspaceLeaf;
}

class FakeIdle {
  idleSeconds = 0;
  suspendCb: (() => void) | null = null;
  resumeCb: (() => void) | null = null;

  getIdleSeconds() { return this.idleSeconds; }

  tryAttachPowerMonitor(onSuspend: () => void, onResume: () => void) {
    this.suspendCb = onSuspend;
    this.resumeCb = onResume;
    return () => { this.suspendCb = null; this.resumeCb = null; };
  }

  destroy() {}
}

function makeStorage(overrides?: Partial<PluginData>) {
  const saves: PluginData[] = [];
  const data: PluginData = { ...structuredClone(DEFAULT_DATA), ...overrides };
  const storage = new Storage(data, async (d) => { saves.push(structuredClone(d)); });
  return { storage, saves };
}

function makeTracker(opts: {
  activeFile?: TFile | null;
  settings?: Partial<TimeTrackerSettings>;
  data?: Partial<PluginData>;
} = {}) {
  const { storage, saves } = makeStorage(opts.data);
  if (opts.settings) {
    storage.updateSettings({ ...storage.getSettings(), ...opts.settings });
  }
  const idle = new FakeIdle();
  const app = {
    workspace: { getActiveFile: () => opts.activeFile ?? null },
  } as unknown as App;
  const tracker = new Tracker(app, storage, idle as unknown as IdleDetector);
  return { tracker, storage, saves, idle };
}

// Base time: 2024-01-15 10:00:00 UTC (well within the day, no midnight surprises)
const BASE_MS = Date.UTC(2024, 0, 15, 10, 0, 0);

describe('Tracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── start() ──────────────────────────────────────────────────────────────────

  describe('start()', () => {
    it('begins tracking when an md file is already active', () => {
      const { tracker } = makeTracker({ activeFile: makeTFile('notes/a.md') });
      tracker.start();
      expect(tracker.getStatus()).toMatchObject({ status: 'tracking', notePath: 'notes/a.md' });
    });

    it('stays idle when no active file', () => {
      const { tracker } = makeTracker();
      tracker.start();
      expect(tracker.getStatus().status).toBe('idle');
    });

    it('ignores non-md active files', () => {
      const { tracker } = makeTracker({ activeFile: makeTFile('image.png', 'png') });
      tracker.start();
      expect(tracker.getStatus().status).toBe('idle');
    });
  });

  // ── Tick accrual ─────────────────────────────────────────────────────────────

  describe('tick accrual', () => {
    it('getLiveTotal grows with time', () => {
      const { tracker } = makeTracker({ settings: { idleThresholdMinutes: 0 } });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));
      vi.advanceTimersByTime(60_000);
      expect(tracker.getLiveTotal()?.totalMs).toBe(60_000);
    });

    it('adds elapsed time on top of previously stored base', () => {
      const { tracker, storage } = makeTracker({ settings: { idleThresholdMinutes: 0 } });
      storage.setDuration('a.md', '2024-01-15', 120_000);
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));
      vi.advanceTimersByTime(30_000);
      expect(tracker.getLiveTotal()?.totalMs).toBe(150_000);
    });

    it('does not write to storage before the save interval elapses', () => {
      const { tracker, storage } = makeTracker({
        settings: { idleThresholdMinutes: 0, saveIntervalSeconds: 30 },
      });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));
      vi.advanceTimersByTime(10_000);
      expect(storage.getDuration('a.md', '2024-01-15')).toBe(0);
    });
  });

  // ── Note switch ───────────────────────────────────────────────────────────────

  describe('note switch', () => {
    it('finalizes old session and starts new one via onFileOpen', () => {
      const { tracker, storage } = makeTracker({ settings: { idleThresholdMinutes: 0 } });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));
      vi.advanceTimersByTime(60_000);
      tracker.onFileOpen(makeTFile('b.md'));

      expect(tracker.getStatus()).toMatchObject({ status: 'tracking', notePath: 'b.md' });
      expect(storage.getDuration('a.md', '2024-01-15')).toBe(60_000);
      const aSession = storage.getData().sessions.find(s => s.notePath === 'a.md');
      expect(aSession?.endReason).toBe('switch');
    });

    it('finalizes via onActiveLeafChange with a new md file', () => {
      const { tracker, storage } = makeTracker({ settings: { idleThresholdMinutes: 0 } });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));
      vi.advanceTimersByTime(30_000);
      tracker.onActiveLeafChange(makeLeaf(makeTFile('b.md')));

      expect(tracker.getStatus()).toMatchObject({ status: 'tracking', notePath: 'b.md' });
      expect(storage.getDuration('a.md', '2024-01-15')).toBe(30_000);
    });
  });

  // ── Non-note views ────────────────────────────────────────────────────────────

  describe('non-note view behavior', () => {
    it('keeps tracking last note when countWhileNonNoteViewActive=true', () => {
      const { tracker } = makeTracker({
        settings: { idleThresholdMinutes: 0, countWhileNonNoteViewActive: true },
      });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));
      tracker.onActiveLeafChange(makeLeaf(null));
      expect(tracker.getStatus()).toMatchObject({ status: 'tracking', notePath: 'a.md' });
    });

    it('goes idle on non-note view when countWhileNonNoteViewActive=false', () => {
      const { tracker, storage } = makeTracker({
        settings: { idleThresholdMinutes: 0, countWhileNonNoteViewActive: false },
      });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));
      vi.advanceTimersByTime(20_000);
      tracker.onActiveLeafChange(makeLeaf(null));

      expect(tracker.getStatus().status).toBe('idle');
      expect(storage.getDuration('a.md', '2024-01-15')).toBe(20_000);
    });
  });

  // ── Midnight split ────────────────────────────────────────────────────────────

  describe('midnight split', () => {
    it('splits session at UTC midnight and attributes time to correct days', () => {
      // 30s before Jan 15 00:00 UTC
      const startMs = Date.UTC(2024, 0, 14, 23, 59, 30);
      vi.setSystemTime(startMs);

      const { tracker, storage } = makeTracker({
        settings: { timezone: 'UTC', idleThresholdMinutes: 0 },
      });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));

      // Advance 35s — 30s in old day, 5s in new day
      vi.advanceTimersByTime(35_000);

      expect(storage.getDuration('a.md', '2024-01-14')).toBe(30_000);
      expect(tracker.getStatus()).toMatchObject({ status: 'tracking', notePath: 'a.md' });

      const sessions = storage.getData().sessions;
      const oldSession = sessions.find(s => s.localDate === '2024-01-14');
      expect(oldSession?.endReason).toBe('midnight');

      // Trigger a save to flush the new day's session into storage
      vi.advanceTimersByTime(30_000);
      const updatedSessions = storage.getData().sessions;
      const newSession = updatedSessions.find(s => s.localDate === '2024-01-15');
      expect(newSession).toBeDefined();
      expect(newSession?.splitFromId).toBe(oldSession?.id);
    });

    it('splits correctly for America/New_York (UTC-5 in January)', () => {
      // NY midnight Jan 15 = Jan 15 05:00 UTC; start 30s before
      const startMs = Date.UTC(2024, 0, 15, 4, 59, 30);
      vi.setSystemTime(startMs);

      const { tracker, storage } = makeTracker({
        settings: { timezone: 'America/New_York', idleThresholdMinutes: 0 },
      });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));
      vi.advanceTimersByTime(35_000);

      expect(storage.getDuration('a.md', '2024-01-14')).toBe(30_000);
      expect(tracker.getStatus()).toMatchObject({ status: 'tracking', notePath: 'a.md' });
    });
  });

  // ── Idle pause ────────────────────────────────────────────────────────────────

  describe('idle pause', () => {
    it('pauses with trimmed session when idle threshold is exceeded', () => {
      const { tracker, storage, idle } = makeTracker({
        settings: { idleThresholdMinutes: 5, idleDetectionMode: 'window' },
      });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));

      // 10 active minutes, then idle reports 6 min (threshold=5)
      vi.advanceTimersByTime(10 * 60_000);
      idle.idleSeconds = 6 * 60;
      vi.advanceTimersByTime(1_000);

      expect(tracker.getStatus()).toMatchObject({ status: 'paused', reason: 'idle', notePath: 'a.md' });

      // Stored total ≈ 4 min (10 active − 6 idle)
      const stored = storage.getDuration('a.md', '2024-01-15');
      expect(stored).toBeGreaterThanOrEqual(3 * 60_000);
      expect(stored).toBeLessThan(5 * 60_000);

      expect(storage.getData().sessions.find(s => s.endReason === 'idle')).toBeDefined();
    });
  });

  // ── Idle resume ───────────────────────────────────────────────────────────────

  describe('idle resume', () => {
    it('auto-resumes on the next tick once idle clears', () => {
      const { tracker, idle } = makeTracker({
        settings: { idleThresholdMinutes: 1, idleDetectionMode: 'window' },
      });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));

      // Trigger idle pause
      idle.idleSeconds = 90;
      vi.advanceTimersByTime(1_000);
      expect(tracker.getStatus().status).toBe('paused');

      // Activity resumes → idle clears → next tick auto-resumes
      idle.idleSeconds = 0;
      vi.advanceTimersByTime(1_000);
      expect(tracker.getStatus()).toMatchObject({ status: 'tracking', notePath: 'a.md' });
    });
  });

  // ── Suspend / resume ──────────────────────────────────────────────────────────

  describe('suspend / resume', () => {
    it('finalizes on suspend and resumes tracking on wake', () => {
      const { tracker, storage, idle } = makeTracker({ settings: { idleThresholdMinutes: 0 } });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));
      vi.advanceTimersByTime(30_000);

      idle.suspendCb!();
      expect(tracker.getStatus()).toMatchObject({ status: 'paused', reason: 'suspend' });
      expect(storage.getDuration('a.md', '2024-01-15')).toBe(30_000);
      expect(storage.getData().sessions.find(s => s.endReason === 'suspend')).toBeDefined();

      idle.resumeCb!();
      expect(tracker.getStatus()).toMatchObject({ status: 'tracking', notePath: 'a.md' });
    });
  });

  // ── sessionBase: no double-counting ──────────────────────────────────────────

  describe('sessionBase correctness', () => {
    it('periodic saves use absolute setDuration, not additive', () => {
      const { tracker, storage } = makeTracker({
        settings: { idleThresholdMinutes: 0, saveIntervalSeconds: 30 },
      });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));

      vi.advanceTimersByTime(30_000);
      expect(storage.getDuration('a.md', '2024-01-15')).toBe(30_000);

      vi.advanceTimersByTime(30_000);
      expect(storage.getDuration('a.md', '2024-01-15')).toBe(60_000);

      vi.advanceTimersByTime(30_000);
      const final = storage.getDuration('a.md', '2024-01-15');
      expect(final).toBe(90_000);
      // Guard: additive bug would give 30+60+90=180s
      expect(final).toBeLessThan(120_000);
    });
  });

  // ── Crash safety ──────────────────────────────────────────────────────────────

  describe('crash safety', () => {
    it('in-flight session is persisted by periodic save with correct endUtc', () => {
      const { tracker, saves } = makeTracker({
        settings: { idleThresholdMinutes: 0, saveIntervalSeconds: 30 },
      });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));
      vi.advanceTimersByTime(30_000);

      expect(saves.length).toBeGreaterThanOrEqual(1);
      const payload = saves[saves.length - 1];
      expect(payload.dailyTotals['2024-01-15']?.['a.md']).toBe(30_000);

      const liveSession = payload.sessions.find(s => s.notePath === 'a.md' && !s.endReason);
      expect(liveSession).toBeDefined();
      expect(liveSession?.endUtc).toBeTruthy();
    });
  });

  // ── handleRename ──────────────────────────────────────────────────────────────

  describe('handleRename', () => {
    it('updates active session, status, and lastKnownNotePath', () => {
      const { tracker } = makeTracker({ settings: { idleThresholdMinutes: 0 } });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));
      tracker.handleRename('a.md', 'a-renamed.md');

      expect(tracker.getStatus()).toMatchObject({ status: 'tracking', notePath: 'a-renamed.md' });
      expect(tracker.getActiveNotePath()).toBe('a-renamed.md');
    });

    it('finalizes with excluded reason when renamed into excluded folder', () => {
      const { tracker, storage } = makeTracker({
        settings: { idleThresholdMinutes: 0, excludedFolders: ['Daily/'] },
      });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));
      vi.advanceTimersByTime(20_000);
      tracker.handleRename('a.md', 'Daily/2024-01-15.md');

      expect(tracker.getStatus().status).toBe('idle');
      expect(storage.getDuration('Daily/2024-01-15.md', '2024-01-15')).toBe(20_000);
    });
  });

  // ── Excluded folders ──────────────────────────────────────────────────────────

  describe('excluded folders', () => {
    it('pauses with excluded reason for notes in excluded folder', () => {
      const { tracker } = makeTracker({
        settings: { idleThresholdMinutes: 0, excludedFolders: ['Daily/'] },
      });
      tracker.start();
      tracker.onFileOpen(makeTFile('Daily/2024-01-15.md'));

      expect(tracker.getStatus()).toMatchObject({ status: 'paused', reason: 'excluded' });
      expect(tracker.getLiveTotal()).toBeNull();
    });

    it('does not treat DailyJournal/ as excluded by Daily/ prefix', () => {
      const { tracker } = makeTracker({
        settings: { idleThresholdMinutes: 0, excludedFolders: ['Daily/'] },
      });
      tracker.start();
      tracker.onFileOpen(makeTFile('DailyJournal/note.md'));
      expect(tracker.getStatus()).toMatchObject({ status: 'tracking', notePath: 'DailyJournal/note.md' });
    });
  });

  // ── stop() ────────────────────────────────────────────────────────────────────

  describe('stop()', () => {
    it('finalizes in-flight session with endReason unload', () => {
      const { tracker, storage } = makeTracker({ settings: { idleThresholdMinutes: 0 } });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));
      vi.advanceTimersByTime(45_000);
      tracker.stop();

      expect(storage.getDuration('a.md', '2024-01-15')).toBe(45_000);
      expect(storage.getData().sessions.find(s => s.endReason === 'unload')).toBeDefined();
    });

    it('no more tick callbacks fire after stop', () => {
      const { tracker } = makeTracker({ settings: { idleThresholdMinutes: 0 } });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));

      let tickCount = 0;
      tracker.onTick(() => { tickCount++; });
      tracker.stop();
      const countAfterStop = tickCount;
      vi.advanceTimersByTime(60_000);
      expect(tickCount).toBe(countAfterStop);
    });
  });

  // ── Settings clamps ───────────────────────────────────────────────────────────

  describe('settings clamps', () => {
    it('clamps tickIntervalMs=0 to 200ms, does not hang', () => {
      const { tracker } = makeTracker({
        settings: { tickIntervalMs: 0, idleThresholdMinutes: 0 },
      });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));
      vi.advanceTimersByTime(1_000);
      expect(tracker.getStatus().status).toBe('tracking');
      tracker.stop();
    });

    it('clamps saveIntervalSeconds=0 to 5s minimum', () => {
      const { tracker, saves } = makeTracker({
        settings: { saveIntervalSeconds: 0, idleThresholdMinutes: 0 },
      });
      tracker.start();
      tracker.onFileOpen(makeTFile('a.md'));
      vi.advanceTimersByTime(4_000);
      expect(saves.length).toBe(0); // not yet at 5s clamp
      vi.advanceTimersByTime(2_000); // crosses 5s
      expect(saves.length).toBeGreaterThan(0);
      tracker.stop();
    });
  });
});
