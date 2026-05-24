import { describe, it, expect } from 'vitest';
import { localDate, localMidnightUtc, resolveTimezone } from '../src/time';

// ── resolveTimezone ───────────────────────────────────────────────────────────

describe('resolveTimezone', () => {
  it('returns the string unchanged for a named timezone', () => {
    expect(resolveTimezone('America/New_York')).toBe('America/New_York');
    expect(resolveTimezone('UTC')).toBe('UTC');
    expect(resolveTimezone('Asia/Baku')).toBe('Asia/Baku');
  });

  it('returns a non-empty string for "auto"', () => {
    const tz = resolveTimezone('auto');
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
  });
});

// ── localDate ─────────────────────────────────────────────────────────────────

describe('localDate', () => {
  it('returns YYYY-MM-DD in UTC', () => {
    expect(localDate(Date.UTC(2024, 0, 15, 12, 0, 0), 'UTC')).toBe('2024-01-15');
    expect(localDate(Date.UTC(2024, 0, 15, 0, 0, 0), 'UTC')).toBe('2024-01-15');
    expect(localDate(Date.UTC(2024, 0, 15, 23, 59, 59), 'UTC')).toBe('2024-01-15');
  });

  it('midnight UTC is still the same UTC date', () => {
    expect(localDate(Date.UTC(2024, 5, 1, 0, 0, 0), 'UTC')).toBe('2024-06-01');
  });

  it('correctly shifts to UTC-5 (EST, January)', () => {
    // Jan 15 2024 03:00 UTC = Jan 14 2024 22:00 EST
    expect(localDate(Date.UTC(2024, 0, 15, 3, 0, 0), 'America/New_York')).toBe('2024-01-14');
    // Jan 15 2024 05:00 UTC = Jan 15 2024 00:00 EST (exactly midnight)
    expect(localDate(Date.UTC(2024, 0, 15, 5, 0, 0), 'America/New_York')).toBe('2024-01-15');
    // Jan 15 2024 06:00 UTC = Jan 15 2024 01:00 EST
    expect(localDate(Date.UTC(2024, 0, 15, 6, 0, 0), 'America/New_York')).toBe('2024-01-15');
  });

  it('correctly shifts to UTC+4 (Gulf Standard Time)', () => {
    // Jan 15 2024 22:00 UTC = Jan 16 2024 02:00 GST (+4)
    expect(localDate(Date.UTC(2024, 0, 15, 22, 0, 0), 'Asia/Dubai')).toBe('2024-01-16');
    // Jan 15 2024 20:00 UTC = Jan 16 2024 00:00 GST — exactly next day midnight
    expect(localDate(Date.UTC(2024, 0, 15, 20, 0, 0), 'Asia/Dubai')).toBe('2024-01-16');
    // Jan 15 2024 19:59 UTC = Jan 15 2024 23:59 GST — still previous day
    expect(localDate(Date.UTC(2024, 0, 15, 19, 59, 0), 'Asia/Dubai')).toBe('2024-01-15');
  });

  it('handles UTC+5:30 (India)', () => {
    // Jan 15 2024 18:30 UTC = Jan 15 2024 00:00 IST (midnight)
    expect(localDate(Date.UTC(2024, 0, 15, 18, 30, 0), 'Asia/Kolkata')).toBe('2024-01-16');
    // Jan 15 2024 18:29 UTC = Jan 15 2024 23:59 IST — still Jan 15
    expect(localDate(Date.UTC(2024, 0, 15, 18, 29, 0), 'Asia/Kolkata')).toBe('2024-01-15');
  });

  it('handles year and month boundaries', () => {
    // Dec 31 2023 23:59:59 UTC → still Dec 31
    expect(localDate(Date.UTC(2023, 11, 31, 23, 59, 59), 'UTC')).toBe('2023-12-31');
    // Jan 1 2024 00:00:00 UTC → Jan 1 2024
    expect(localDate(Date.UTC(2024, 0, 1, 0, 0, 0), 'UTC')).toBe('2024-01-01');
  });
});

// ── localMidnightUtc ──────────────────────────────────────────────────────────

describe('localMidnightUtc', () => {
  it('UTC midnight is at 00:00 UTC', () => {
    expect(localMidnightUtc('2024-01-15', 'UTC')).toBe(Date.UTC(2024, 0, 15, 0, 0, 0));
    expect(localMidnightUtc('2024-06-01', 'UTC')).toBe(Date.UTC(2024, 5, 1, 0, 0, 0));
  });

  it('EST midnight (UTC-5) is at 05:00 UTC', () => {
    // January — no DST, EST = UTC-5
    const result = localMidnightUtc('2024-01-15', 'America/New_York');
    expect(result).toBe(Date.UTC(2024, 0, 15, 5, 0, 0));
  });

  it('EDT midnight (UTC-4) is at 04:00 UTC', () => {
    // July — DST active, EDT = UTC-4
    const result = localMidnightUtc('2024-07-15', 'America/New_York');
    expect(result).toBe(Date.UTC(2024, 6, 15, 4, 0, 0));
  });

  it('GST midnight (UTC+4) is at 20:00 UTC previous day', () => {
    const result = localMidnightUtc('2024-01-15', 'Asia/Dubai');
    expect(result).toBe(Date.UTC(2024, 0, 14, 20, 0, 0));
  });

  it('IST midnight (UTC+5:30) is at 18:30 UTC previous day', () => {
    const result = localMidnightUtc('2024-01-15', 'Asia/Kolkata');
    expect(result).toBe(Date.UTC(2024, 0, 14, 18, 30, 0));
  });

  it('DST spring-forward night: March 10 2024 (USA)', () => {
    // Before DST: EST = UTC-5. So midnight Mar 10 local = 05:00 UTC Mar 10.
    const result = localMidnightUtc('2024-03-10', 'America/New_York');
    expect(result).toBe(Date.UTC(2024, 2, 10, 5, 0, 0));
  });

  it('DST fall-back night: Nov 3 2024 (USA)', () => {
    // DST ends at 2:00 AM EDT on Nov 3 — midnight itself is still in EDT (UTC-4).
    // So midnight Nov 3 local = 04:00 UTC. Nov 4 onwards: EST = UTC-5.
    const nov3 = localMidnightUtc('2024-11-03', 'America/New_York');
    expect(nov3).toBe(Date.UTC(2024, 10, 3, 4, 0, 0)); // midnight in EDT

    const nov4 = localMidnightUtc('2024-11-04', 'America/New_York');
    expect(nov4).toBe(Date.UTC(2024, 10, 4, 5, 0, 0)); // midnight in EST (after fallback)
  });

  it('round-trips with localDate: midnight in TZ returns the same date', () => {
    const tz = 'Europe/Berlin';
    const dateStr = '2024-06-15';
    const midnightUtc = localMidnightUtc(dateStr, tz);
    // midnightUtc in Berlin local time should be the same date
    expect(localDate(midnightUtc, tz)).toBe(dateStr);
    // One ms before midnight should be the previous day
    expect(localDate(midnightUtc - 1, tz)).toBe('2024-06-14');
  });

  it('round-trips across year boundary', () => {
    const dateStr = '2024-01-01';
    const midnightUtc = localMidnightUtc(dateStr, 'UTC');
    expect(localDate(midnightUtc, 'UTC')).toBe(dateStr);
    expect(localDate(midnightUtc - 1, 'UTC')).toBe('2023-12-31');
  });
});
