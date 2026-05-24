import { PluginData, Session, DailyTotals, RenameRecord, TimeTrackerSettings, DEFAULT_DATA } from './types';

export class Storage {
  private data: PluginData;
  private saveFn: (data: PluginData) => Promise<void>;

  constructor(data: PluginData, saveFn: (data: PluginData) => Promise<void>) {
    this.data = data;
    this.saveFn = saveFn;
  }

  static migrate(raw: unknown): PluginData {
    if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_DATA);
    const obj = raw as Record<string, unknown>;
    const base = structuredClone(DEFAULT_DATA);
    return {
      version: 1,
      settings: { ...base.settings, ...(obj.settings as Partial<TimeTrackerSettings> ?? {}) },
      dailyTotals: (obj.dailyTotals as DailyTotals) ?? {},
      sessions: (obj.sessions as Session[]) ?? [],
      renames: (obj.renames as RenameRecord[]) ?? [],
    };
  }

  getData(): PluginData { return this.data; }
  getSettings(): TimeTrackerSettings { return this.data.settings; }

  updateSettings(settings: TimeTrackerSettings): void {
    this.data.settings = settings;
  }

  async flush(): Promise<void> {
    await this.saveFn(this.data);
  }

  // --- Duration accessors ---

  getDuration(notePath: string, localDateStr: string): number {
    const raw = this.data.dailyTotals[localDateStr]?.[notePath];
    // Guard against corrupted (non-numeric) values in data.json
    return typeof raw === 'number' && isFinite(raw) ? Math.max(0, raw) : 0;
  }

  setDuration(notePath: string, localDateStr: string, durationMs: number): void {
    if (!this.data.dailyTotals[localDateStr]) {
      this.data.dailyTotals[localDateStr] = {};
    }
    this.data.dailyTotals[localDateStr][notePath] = Math.max(0, durationMs);
  }

  // --- Session management ---

  upsertSession(session: Session): void {
    const idx = this.data.sessions.findIndex(s => s.id === session.id);
    if (idx >= 0) {
      this.data.sessions[idx] = { ...session };
    } else {
      this.data.sessions.push({ ...session });
    }
  }

  pruneOldSessions(afterDays: number): void {
    const days = Math.max(1, afterDays); // never prune everything in one sweep
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();
    this.data.sessions = this.data.sessions.filter(s => s.startUtc >= cutoffIso);
  }

  pruneOldRenames(afterDays: number): void {
    const days = Math.max(1, afterDays);
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();
    this.data.renames = this.data.renames.filter(r => r.atUtc >= cutoffIso);
  }

  // --- Vault event handlers ---

  handleRename(oldPath: string, newPath: string): void {
    this.data.renames.push({ from: oldPath, to: newPath, atUtc: new Date().toISOString() });

    // Rewrite all dailyTotals keys: merge old into new if both exist
    for (const dateKey of Object.keys(this.data.dailyTotals)) {
      const day = this.data.dailyTotals[dateKey];
      if (oldPath in day) {
        day[newPath] = (day[newPath] ?? 0) + day[oldPath];
        delete day[oldPath];
      }
    }

    // Rewrite session records
    for (const session of this.data.sessions) {
      if (session.notePath === oldPath) session.notePath = newPath;
    }
  }

  // --- View queries ---

  getDaily(localDateStr: string): Record<string, number> {
    return { ...(this.data.dailyTotals[localDateStr] ?? {}) };
  }

  /**
   * Returns { notePath: { dateStr: ms } } for each date in weekDates.
   */
  getWeekly(weekDates: string[]): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};
    for (const dateStr of weekDates) {
      const day = this.data.dailyTotals[dateStr] ?? {};
      for (const [path, ms] of Object.entries(day)) {
        if (!result[path]) result[path] = {};
        result[path][dateStr] = (result[path][dateStr] ?? 0) + ms;
      }
    }
    return result;
  }

  /**
   * Returns { notePath: totalMs } summed across all monthDates.
   */
  getMonthly(monthDates: string[]): Record<string, number> {
    const result: Record<string, number> = {};
    for (const dateStr of monthDates) {
      const day = this.data.dailyTotals[dateStr] ?? {};
      for (const [path, ms] of Object.entries(day)) {
        result[path] = (result[path] ?? 0) + ms;
      }
    }
    return result;
  }
}
