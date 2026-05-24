import { describe, it, expect } from 'vitest';
import { formatDuration, isExcluded, normalizeFolderPath, getNoteName, getNoteDisplay, getWeekDates, getMonthDates } from '../src/util';

// ── formatDuration ────────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('returns 0s for zero or negative', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-500)).toBe('0s');
  });

  it('formats seconds only', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(45000)).toBe('45s');
    expect(formatDuration(59999)).toBe('59s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(3599000)).toBe('59m 59s');
  });

  it('formats hours, minutes, and seconds', () => {
    expect(formatDuration(3600000)).toBe('1h 0m 0s');
    expect(formatDuration(3661000)).toBe('1h 1m 1s');
    expect(formatDuration(3723000)).toBe('1h 2m 3s');
    expect(formatDuration(86399000)).toBe('23h 59m 59s');
  });

  it('ignores sub-second precision', () => {
    expect(formatDuration(1500)).toBe('1s');
    expect(formatDuration(61999)).toBe('1m 1s');
  });
});

// ── normalizeFolderPath ────────────────────────────────────────────────────────

describe('normalizeFolderPath', () => {
  it('adds trailing slash', () => {
    expect(normalizeFolderPath('Templates')).toBe('Templates/');
    expect(normalizeFolderPath('Archive/Old')).toBe('Archive/Old/');
  });

  it('strips extra trailing slashes', () => {
    expect(normalizeFolderPath('Templates/')).toBe('Templates/');
    expect(normalizeFolderPath('Templates///')).toBe('Templates/');
  });

  it('trims whitespace', () => {
    expect(normalizeFolderPath('  Templates  ')).toBe('Templates/');
  });

  it('returns empty string for blank input', () => {
    expect(normalizeFolderPath('')).toBe('');
    expect(normalizeFolderPath('   ')).toBe('');
  });
});

// ── isExcluded ────────────────────────────────────────────────────────────────

describe('isExcluded', () => {
  const excluded = ['Templates', 'Archive', 'System/Config'];

  it('excludes notes directly inside an excluded folder', () => {
    expect(isExcluded('Templates/daily.md', excluded)).toBe(true);
    expect(isExcluded('Archive/old-note.md', excluded)).toBe(true);
    expect(isExcluded('System/Config/settings.md', excluded)).toBe(true);
  });

  it('excludes notes in nested subfolders of excluded folders', () => {
    expect(isExcluded('Templates/Weekly/template.md', excluded)).toBe(true);
    expect(isExcluded('Archive/2022/project.md', excluded)).toBe(true);
  });

  it('does NOT exclude notes whose path only starts with the same letters', () => {
    // "Daily" should not be excluded just because "Templates" is
    expect(isExcluded('TemplatesExtra/note.md', excluded)).toBe(false);
    expect(isExcluded('ArchiveSomething/note.md', excluded)).toBe(false);
  });

  it('does not exclude notes in non-excluded folders', () => {
    expect(isExcluded('Projects/task.md', excluded)).toBe(false);
    expect(isExcluded('Daily/2024-01-15.md', excluded)).toBe(false);
  });

  it('returns false for empty excluded list', () => {
    expect(isExcluded('Templates/note.md', [])).toBe(false);
  });

  it('handles root-level notes (no folder)', () => {
    expect(isExcluded('mynote.md', excluded)).toBe(false);
  });
});

// ── getNoteName ───────────────────────────────────────────────────────────────

describe('getNoteName', () => {
  it('strips .md extension', () => {
    expect(getNoteName('Projects/my-task.md')).toBe('my-task');
    expect(getNoteName('note.md')).toBe('note');
  });

  it('returns the filename when no .md extension', () => {
    expect(getNoteName('Projects/attachment.pdf')).toBe('attachment.pdf');
  });

  it('handles nested paths', () => {
    expect(getNoteName('a/b/c/deep-note.md')).toBe('deep-note');
  });
});

// ── getNoteDisplay ────────────────────────────────────────────────────────────

describe('getNoteDisplay', () => {
  it('splits nested path into folder, name, full', () => {
    expect(getNoteDisplay('A/B/Note.md')).toEqual({ folder: 'A/B', name: 'Note', full: 'A/B/Note.md' });
  });

  it('returns empty folder for root-level note', () => {
    expect(getNoteDisplay('Note.md')).toEqual({ folder: '', name: 'Note', full: 'Note.md' });
  });

  it('leaves non-.md extension unchanged', () => {
    expect(getNoteDisplay('Assets/image.png')).toEqual({ folder: 'Assets', name: 'image.png', full: 'Assets/image.png' });
  });

  it('handles names with dots (date-style filenames)', () => {
    expect(getNoteDisplay('Journal/2024-01-15.md')).toEqual({ folder: 'Journal', name: '2024-01-15', full: 'Journal/2024-01-15.md' });
  });

  it('handles deeply nested paths', () => {
    expect(getNoteDisplay('a/b/c/d.md')).toEqual({ folder: 'a/b/c', name: 'd', full: 'a/b/c/d.md' });
  });
});

// ── getWeekDates ──────────────────────────────────────────────────────────────

describe('getWeekDates', () => {
  it('returns 7 dates', () => {
    expect(getWeekDates('2024-01-15', 1)).toHaveLength(7);
    expect(getWeekDates('2024-01-15', 0)).toHaveLength(7);
  });

  it('Mon-start: week containing Wednesday Jan 17 2024 starts on Monday Jan 15', () => {
    const week = getWeekDates('2024-01-17', 1);
    expect(week[0]).toBe('2024-01-15'); // Monday
    expect(week[6]).toBe('2024-01-21'); // Sunday
  });

  it('Mon-start: week containing Monday Jan 15 2024 starts on that Monday', () => {
    const week = getWeekDates('2024-01-15', 1);
    expect(week[0]).toBe('2024-01-15');
    expect(week[6]).toBe('2024-01-21');
  });

  it('Sun-start: week containing Wednesday Jan 17 2024 starts on Sunday Jan 14', () => {
    const week = getWeekDates('2024-01-17', 0);
    expect(week[0]).toBe('2024-01-14'); // Sunday
    expect(week[6]).toBe('2024-01-20'); // Saturday
  });

  it('Mon-start: week containing Sunday Jan 21 2024 starts on Monday Jan 15', () => {
    const week = getWeekDates('2024-01-21', 1);
    expect(week[0]).toBe('2024-01-15');
    expect(week[6]).toBe('2024-01-21');
  });

  it('spans month boundary correctly', () => {
    // Jan 31 2024 is a Wednesday; Mon-start week: Jan 29 – Feb 4
    const week = getWeekDates('2024-01-31', 1);
    expect(week[0]).toBe('2024-01-29');
    expect(week[6]).toBe('2024-02-04');
  });

  it('spans year boundary correctly', () => {
    // Jan 1 2024 is a Monday; Mon-start week: Jan 1 – Jan 7
    const week = getWeekDates('2024-01-01', 1);
    expect(week[0]).toBe('2024-01-01');
    expect(week[6]).toBe('2024-01-07');

    // Dec 31 2023 is a Sunday; Mon-start week: Dec 25 – Dec 31
    const week2 = getWeekDates('2023-12-31', 1);
    expect(week2[0]).toBe('2023-12-25');
    expect(week2[6]).toBe('2023-12-31');
  });

  it('always contains the input date', () => {
    const date = '2024-06-15';
    expect(getWeekDates(date, 1)).toContain(date);
    expect(getWeekDates(date, 0)).toContain(date);
  });

  it('returns consecutive dates', () => {
    const week = getWeekDates('2024-01-15', 1);
    for (let i = 1; i < week.length; i++) {
      const prev = new Date(week[i - 1]).getTime();
      const curr = new Date(week[i]).getTime();
      expect(curr - prev).toBe(86400000); // exactly 1 day
    }
  });
});

// ── getMonthDates ─────────────────────────────────────────────────────────────

describe('getMonthDates', () => {
  it('returns correct number of days for each month', () => {
    expect(getMonthDates('2024-01-15')).toHaveLength(31); // Jan
    expect(getMonthDates('2024-02-15')).toHaveLength(29); // Feb 2024 (leap year)
    expect(getMonthDates('2023-02-15')).toHaveLength(28); // Feb 2023 (non-leap)
    expect(getMonthDates('2024-04-01')).toHaveLength(30); // Apr
    expect(getMonthDates('2024-12-31')).toHaveLength(31); // Dec
  });

  it('starts on the 1st', () => {
    expect(getMonthDates('2024-03-15')[0]).toBe('2024-03-01');
  });

  it('ends on the last day of the month', () => {
    const feb = getMonthDates('2024-02-10');
    expect(feb[feb.length - 1]).toBe('2024-02-29');

    const jan = getMonthDates('2024-01-01');
    expect(jan[jan.length - 1]).toBe('2024-01-31');
  });

  it('always contains the input date', () => {
    expect(getMonthDates('2024-06-15')).toContain('2024-06-15');
    expect(getMonthDates('2024-06-01')).toContain('2024-06-01');
    expect(getMonthDates('2024-06-30')).toContain('2024-06-30');
  });

  it('returns consecutive dates', () => {
    const month = getMonthDates('2024-01-15');
    for (let i = 1; i < month.length; i++) {
      const prev = new Date(month[i - 1]).getTime();
      const curr = new Date(month[i]).getTime();
      expect(curr - prev).toBe(86400000);
    }
  });
});
