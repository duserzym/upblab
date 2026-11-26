import { expect, it } from 'vitest';
import { formatCalendarDate } from './calendar-date';

it('uses English month names without shifting the stored calendar day', () => {
  expect(formatCalendarDate('2026-11-16')).toBe('16 Nov 2026');
  expect(formatCalendarDate('2026-01-01')).toBe('1 Jan 2026');
  expect(formatCalendarDate('2024-02-29')).toBe('29 Feb 2024');
  expect(formatCalendarDate('2026-12-31')).toBe('31 Dec 2026');
});
it('does not invent a date for missing or invalid input', () => {
  expect(formatCalendarDate('')).toBe('—');
  for (const value of ['2026-02-29', '2026-11-31', '2026-13-01', '2026-00-00', 'unknown', '2026-11-16T00:00:00Z']) expect(formatCalendarDate(value)).toBe(value);
});
