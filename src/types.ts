export const PLUGIN_ID = 'vault-time-tracker';
export const VIEW_TYPE = 'vault-time-tracker';
export const DASHBOARD_VIEW_TYPE = 'vault-time-tracker-dashboard';

export const DEFAULT_SETTINGS: TimeTrackerSettings = {
  timezone: 'auto',
  saveIntervalSeconds: 30,
  tickIntervalMs: 1000,
  excludedFolders: [],
  idleThresholdMinutes: 0,
  idleDetectionMode: 'auto',
  countWhileNonNoteViewActive: true,
  pruneSessionsAfterDays: 7,
  weekStartsOn: 1,
};

export const DEFAULT_DATA: PluginData = {
  version: 1,
  settings: { ...DEFAULT_SETTINGS },
  dailyTotals: {},
  sessions: [],
  renames: [],
};

export interface PluginData {
  version: number;
  settings: TimeTrackerSettings;
  dailyTotals: DailyTotals;
  sessions: Session[];
  renames: RenameRecord[];
}

export interface DailyTotals {
  [localDate: string]: {
    [notePath: string]: number; // milliseconds
  };
}

export interface Session {
  id: string;
  notePath: string;
  startUtc: string;  // ISO 8601 UTC
  endUtc: string;    // ISO 8601 UTC — kept up-to-date on every save tick
  durationMs: number;
  localDate: string; // YYYY-MM-DD in user's local TZ
  splitFromId?: string;
  endReason?: 'switch' | 'midnight' | 'idle' | 'excluded' | 'unload' | 'suspend';
}

export interface RenameRecord {
  from: string;
  to: string;
  atUtc: string;
}

export interface TimeTrackerSettings {
  timezone: string;                              // IANA name, or "auto"
  saveIntervalSeconds: number;                   // default 30
  tickIntervalMs: number;                        // default 1000
  excludedFolders: string[];                     // path prefixes
  idleThresholdMinutes: number;                  // default 5, 0 = disabled
  idleDetectionMode: 'auto' | 'system' | 'window' | 'off';
  countWhileNonNoteViewActive: boolean;          // default true
  pruneSessionsAfterDays: number;                // default 7
  weekStartsOn: 0 | 1;                           // 0=Sun, 1=Mon
}

export type TrackerStatus =
  | { status: 'idle' }
  | { status: 'tracking'; notePath: string; sessionId: string }
  | { status: 'paused'; notePath: string; reason: 'idle' | 'excluded' | 'suspend' };
