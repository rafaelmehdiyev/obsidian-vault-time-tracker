export function resolveTimezone(tz: string): string {
  return tz === 'auto' ? Intl.DateTimeFormat().resolvedOptions().timeZone : tz;
}

/**
 * Returns the local calendar date (YYYY-MM-DD) for a given UTC timestamp in a timezone.
 * Falls back to UTC if the timezone string is invalid.
 */
export function localDate(utcMs: number, tz: string): string {
  let resolved: string;
  try {
    resolved = resolveTimezone(tz);
    // Validate: throws RangeError for unknown timezone names
    new Intl.DateTimeFormat('en-CA', { timeZone: resolved });
  } catch {
    resolved = 'UTC';
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolved,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(utcMs);

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Returns the UTC ms for 00:00:00 local time on localDateStr in the given timezone.
 * Uses two refinement passes to handle DST transitions correctly.
 */
export function localMidnightUtc(localDateStr: string, tz: string): number {
  let resolved: string;
  try {
    resolved = resolveTimezone(tz);
    new Intl.DateTimeFormat('en-CA', { timeZone: resolved });
  } catch {
    resolved = 'UTC';
  }
  const [year, month, day] = localDateStr.split('-').map(Number);

  // Initial estimate using UTC noon (avoids edge cases near midnight)
  const approxUtc = Date.UTC(year, month - 1, day, 12, 0, 0);
  const offset1 = getLocalOffsetMs(approxUtc, resolved);
  const estimate = Date.UTC(year, month - 1, day, 0, 0, 0) - offset1;

  // Refinement pass — offset may differ at midnight vs. noon due to DST
  const offset2 = getLocalOffsetMs(estimate, resolved);
  const refined = Date.UTC(year, month - 1, day, 0, 0, 0) - offset2;

  // Final pass to handle DST transitions that land exactly at midnight
  const offset3 = getLocalOffsetMs(refined, resolved);
  return Date.UTC(year, month - 1, day, 0, 0, 0) - offset3;
}

/**
 * Returns offset in ms: localWallClockMs - utcMs.
 * I.e., if local time is UTC+4, returns 4*3600*1000.
 */
function getLocalOffsetMs(utcMs: number, tz: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(utcMs);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0', 10);

  let hours = get('hour');
  // Intl can return 24 for midnight in some engines
  if (hours === 24) hours = 0;

  const localWallClockMs = Date.UTC(get('year'), get('month') - 1, get('day'), hours, get('minute'), get('second'));
  return localWallClockMs - utcMs;
}

/**
 * Smoke tests for the TZ math — called once on plugin load in development builds.
 * Throws if any assertion fails.
 */
export function runTimeSmokeTests(): void {
  // Jan 15 2024 12:00 UTC → should be 2024-01-15 in UTC
  const utcNoon = Date.UTC(2024, 0, 15, 12, 0, 0);
  const d1 = localDate(utcNoon, 'UTC');
  if (d1 !== '2024-01-15') throw new Error(`[VTT] time smoke test 1 failed: ${d1}`);

  // UTC midnight roundtrip
  const midnightUtc = localMidnightUtc('2024-01-15', 'UTC');
  if (midnightUtc !== Date.UTC(2024, 0, 15, 0, 0, 0)) {
    throw new Error(`[VTT] time smoke test 2 failed: ${midnightUtc}`);
  }

  // UTC-5 (EST, January — no DST): Jan 15 2024 03:00 UTC = Jan 14 2024 22:00 EST
  const utc3am = Date.UTC(2024, 0, 15, 3, 0, 0);
  const d2 = localDate(utc3am, 'America/New_York');
  if (d2 !== '2024-01-14') throw new Error(`[VTT] time smoke test 3 failed: ${d2}`);

  // localMidnightUtc for EST: Jan 15 midnight EST = Jan 15 05:00 UTC
  const estMidnight = localMidnightUtc('2024-01-15', 'America/New_York');
  if (estMidnight !== Date.UTC(2024, 0, 15, 5, 0, 0)) {
    throw new Error(`[VTT] time smoke test 4 failed: ${estMidnight} expected ${Date.UTC(2024, 0, 15, 5, 0, 0)}`);
  }
}
