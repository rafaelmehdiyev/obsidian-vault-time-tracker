export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function normalizeFolderPath(folder: string): string {
  const trimmed = folder.trim().replace(/\/+$/, '');
  return trimmed ? trimmed + '/' : '';
}

export function isExcluded(notePath: string, excludedFolders: string[]): boolean {
  for (const folder of excludedFolders) {
    const normalized = normalizeFolderPath(folder);
    if (normalized && notePath.startsWith(normalized)) return true;
  }
  return false;
}

export function getNoteName(path: string): string {
  const parts = path.split('/');
  const filename = parts[parts.length - 1];
  return filename.endsWith('.md') ? filename.slice(0, -3) : filename;
}

export function getNoteDisplay(path: string): { folder: string; name: string; full: string } {
  const parts = path.split('/');
  const filename = parts.pop() ?? path;
  const name = filename.endsWith('.md') ? filename.slice(0, -3) : filename;
  return { folder: parts.join('/'), name, full: path };
}

/**
 * Returns YYYY-MM-DD strings for the 7 days of the week containing todayStr.
 * weekStartsOn: 0=Sun, 1=Mon.
 */
export function getWeekDates(todayStr: string, weekStartsOn: 0 | 1): string[] {
  const [y, m, d] = todayStr.split('-').map(Number);
  const today = new Date(Date.UTC(y, m - 1, d));
  const dow = today.getUTCDay(); // 0=Sun, 6=Sat

  // Offset to the start of the week
  let startOffset: number;
  if (weekStartsOn === 1) {
    startOffset = dow === 0 ? -6 : 1 - dow; // Monday
  } else {
    startOffset = -dow; // Sunday
  }

  const weekStart = new Date(today.getTime() + startOffset * 86400000);
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart.getTime() + i * 86400000);
    return date.toISOString().slice(0, 10);
  });
}

/**
 * Returns all YYYY-MM-DD strings in the calendar month containing todayStr.
 */
export function getMonthDates(todayStr: string): string[] {
  const [y, m] = todayStr.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: daysInMonth }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${day}`;
  });
}

/**
 * Returns a short day label like "Mon 23" from a YYYY-MM-DD string.
 */
export function shortDayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${day} ${d}`;
}
