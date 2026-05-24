import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Storage } from '../src/storage';
import { PluginData, DEFAULT_DATA } from '../src/types';

function makeSaveFn() {
  return vi.fn().mockResolvedValue(undefined) as (data: PluginData) => Promise<void>;
}

function freshStorage(overrides?: Partial<PluginData>) {
  const data: PluginData = {
    ...structuredClone(DEFAULT_DATA),
    ...overrides,
  };
  return new Storage(data, makeSaveFn());
}

// ── Storage.migrate ───────────────────────────────────────────────────────────

describe('Storage.migrate', () => {
  it('returns default data for null/undefined input', () => {
    const d = Storage.migrate(null);
    expect(d.version).toBe(1);
    expect(d.dailyTotals).toEqual({});
    expect(d.sessions).toEqual([]);
  });

  it('returns default data for completely wrong shape', () => {
    const d = Storage.migrate('not an object');
    expect(d.dailyTotals).toEqual({});
  });

  it('merges partial settings with defaults', () => {
    const d = Storage.migrate({ settings: { saveIntervalSeconds: 60 } });
    expect(d.settings.saveIntervalSeconds).toBe(60);
    // untouched defaults preserved
    expect(d.settings.timezone).toBe('auto');
    expect(d.settings.idleThresholdMinutes).toBe(5);
  });

  it('preserves existing dailyTotals and sessions', () => {
    const raw = {
      dailyTotals: { '2024-01-15': { 'note.md': 5000 } },
      sessions: [{ id: 'abc', notePath: 'note.md', startUtc: 'x', endUtc: 'x', durationMs: 5000, localDate: '2024-01-15' }],
      renames: [],
    };
    const d = Storage.migrate(raw);
    expect(d.dailyTotals['2024-01-15']['note.md']).toBe(5000);
    expect(d.sessions).toHaveLength(1);
  });
});

// ── getDuration / setDuration ─────────────────────────────────────────────────

describe('getDuration / setDuration', () => {
  it('returns 0 for unknown path/date', () => {
    const s = freshStorage();
    expect(s.getDuration('note.md', '2024-01-15')).toBe(0);
  });

  it('sets and retrieves a value', () => {
    const s = freshStorage();
    s.setDuration('Projects/task.md', '2024-01-15', 12345);
    expect(s.getDuration('Projects/task.md', '2024-01-15')).toBe(12345);
  });

  it('overwrites a previous value (absolute, not additive)', () => {
    const s = freshStorage();
    s.setDuration('note.md', '2024-01-15', 1000);
    s.setDuration('note.md', '2024-01-15', 5000);
    expect(s.getDuration('note.md', '2024-01-15')).toBe(5000);
  });

  it('floors negative values to 0', () => {
    const s = freshStorage();
    s.setDuration('note.md', '2024-01-15', -100);
    expect(s.getDuration('note.md', '2024-01-15')).toBe(0);
  });

  it('keeps different dates independent', () => {
    const s = freshStorage();
    s.setDuration('note.md', '2024-01-15', 1000);
    s.setDuration('note.md', '2024-01-16', 2000);
    expect(s.getDuration('note.md', '2024-01-15')).toBe(1000);
    expect(s.getDuration('note.md', '2024-01-16')).toBe(2000);
  });
});

// ── handleRename ──────────────────────────────────────────────────────────────

describe('handleRename', () => {
  it('rewrites all dailyTotals keys from old path to new path', () => {
    const s = freshStorage({
      dailyTotals: {
        '2024-01-15': { 'old/note.md': 3000 },
        '2024-01-16': { 'old/note.md': 1500, 'other.md': 500 },
      },
    });

    s.handleRename('old/note.md', 'new/note.md');

    expect(s.getDuration('old/note.md', '2024-01-15')).toBe(0);
    expect(s.getDuration('new/note.md', '2024-01-15')).toBe(3000);
    expect(s.getDuration('new/note.md', '2024-01-16')).toBe(1500);
    // unrelated note unchanged
    expect(s.getDuration('other.md', '2024-01-16')).toBe(500);
  });

  it('merges into existing new-path value when both old and new exist on same day', () => {
    const s = freshStorage({
      dailyTotals: {
        '2024-01-15': { 'old.md': 2000, 'new.md': 1000 },
      },
    });

    s.handleRename('old.md', 'new.md');

    // merged: 2000 + 1000
    expect(s.getDuration('new.md', '2024-01-15')).toBe(3000);
    expect(s.getDuration('old.md', '2024-01-15')).toBe(0);
  });

  it('records the rename in history', () => {
    const s = freshStorage();
    s.handleRename('a.md', 'b.md');
    const data = s.getData();
    expect(data.renames).toHaveLength(1);
    expect(data.renames[0].from).toBe('a.md');
    expect(data.renames[0].to).toBe('b.md');
  });

  it('rewrites session notePath entries', () => {
    const s = freshStorage({
      sessions: [
        { id: '1', notePath: 'old.md', startUtc: '', endUtc: '', durationMs: 0, localDate: '2024-01-15' },
        { id: '2', notePath: 'other.md', startUtc: '', endUtc: '', durationMs: 0, localDate: '2024-01-15' },
      ],
    });

    s.handleRename('old.md', 'new.md');

    const sessions = s.getData().sessions;
    expect(sessions.find(s => s.id === '1')?.notePath).toBe('new.md');
    expect(sessions.find(s => s.id === '2')?.notePath).toBe('other.md'); // unchanged
  });
});

// ── upsertSession / pruneOldSessions ─────────────────────────────────────────

describe('upsertSession', () => {
  it('inserts a new session', () => {
    const s = freshStorage();
    s.upsertSession({ id: 'abc', notePath: 'note.md', startUtc: '', endUtc: '', durationMs: 500, localDate: '2024-01-15' });
    expect(s.getData().sessions).toHaveLength(1);
  });

  it('updates an existing session by id', () => {
    const s = freshStorage();
    s.upsertSession({ id: 'abc', notePath: 'note.md', startUtc: '', endUtc: '', durationMs: 100, localDate: '2024-01-15' });
    s.upsertSession({ id: 'abc', notePath: 'note.md', startUtc: '', endUtc: '', durationMs: 999, localDate: '2024-01-15' });
    expect(s.getData().sessions).toHaveLength(1);
    expect(s.getData().sessions[0].durationMs).toBe(999);
  });
});

describe('pruneOldSessions', () => {
  it('removes sessions older than the cutoff', () => {
    const old = new Date(Date.now() - 10 * 86400000).toISOString(); // 10 days ago
    const recent = new Date(Date.now() - 1 * 86400000).toISOString(); // 1 day ago
    const s = freshStorage({
      sessions: [
        { id: '1', notePath: 'a.md', startUtc: old, endUtc: old, durationMs: 0, localDate: '2024-01-01' },
        { id: '2', notePath: 'b.md', startUtc: recent, endUtc: recent, durationMs: 0, localDate: '2024-01-01' },
      ],
    });

    s.pruneOldSessions(7);

    const sessions = s.getData().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('2');
  });

  it('keeps all sessions when none are older than cutoff', () => {
    const recent = new Date(Date.now() - 1 * 86400000).toISOString();
    const s = freshStorage({
      sessions: [
        { id: '1', notePath: 'a.md', startUtc: recent, endUtc: recent, durationMs: 0, localDate: '2024-01-01' },
      ],
    });
    s.pruneOldSessions(7);
    expect(s.getData().sessions).toHaveLength(1);
  });
});

// ── getDaily / getWeekly / getMonthly ─────────────────────────────────────────

describe('getDaily', () => {
  it('returns empty object for a date with no data', () => {
    expect(freshStorage().getDaily('2024-01-15')).toEqual({});
  });

  it('returns a copy, not a reference', () => {
    const s = freshStorage({ dailyTotals: { '2024-01-15': { 'note.md': 1000 } } });
    const result = s.getDaily('2024-01-15');
    result['note.md'] = 99999; // mutate the copy
    expect(s.getDuration('note.md', '2024-01-15')).toBe(1000); // original unchanged
  });
});

describe('getWeekly', () => {
  it('aggregates multiple days into per-note-per-day map', () => {
    const s = freshStorage({
      dailyTotals: {
        '2024-01-15': { 'a.md': 1000, 'b.md': 500 },
        '2024-01-16': { 'a.md': 2000 },
        '2024-01-17': { 'b.md': 300 },
      },
    });

    const weekly = s.getWeekly(['2024-01-15', '2024-01-16', '2024-01-17']);
    expect(weekly['a.md']['2024-01-15']).toBe(1000);
    expect(weekly['a.md']['2024-01-16']).toBe(2000);
    expect(weekly['b.md']['2024-01-15']).toBe(500);
    expect(weekly['b.md']['2024-01-17']).toBe(300);
  });

  it('returns empty object when no data exists for those dates', () => {
    expect(freshStorage().getWeekly(['2024-01-15', '2024-01-16'])).toEqual({});
  });
});

describe('getMonthly', () => {
  it('sums all days into per-note totals', () => {
    const s = freshStorage({
      dailyTotals: {
        '2024-01-10': { 'a.md': 1000 },
        '2024-01-11': { 'a.md': 2000, 'b.md': 500 },
        '2024-01-12': { 'b.md': 300 },
      },
    });

    const monthly = s.getMonthly(['2024-01-10', '2024-01-11', '2024-01-12']);
    expect(monthly['a.md']).toBe(3000);
    expect(monthly['b.md']).toBe(800);
  });
});

// ── flush ─────────────────────────────────────────────────────────────────────

describe('flush', () => {
  it('calls the save function with the current data', async () => {
    const saveFn = makeSaveFn();
    const data = structuredClone(DEFAULT_DATA);
    const s = new Storage(data, saveFn);
    await s.flush();
    expect(saveFn).toHaveBeenCalledOnce();
    expect(saveFn).toHaveBeenCalledWith(data);
  });
});
