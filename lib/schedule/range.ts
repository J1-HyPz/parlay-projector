/**
 * Schedule date range.
 *
 * Pure, no config, no side effects — the timezone is always passed in, so the
 * midnight-boundary behaviour is directly testable.
 *
 * The critical case: at 00:30 on Tuesday in Europe/London during BST, the UTC
 * date is still Monday. Deriving "today" from UTC would show a Monday-to-Monday
 * week to a user who is already on Tuesday. Everything here works from the
 * calendar date **in the application timezone**.
 */

/** Days after today that the schedule covers. Today + 7 = 8 dates inclusive. */
export const SCHEDULE_DAYS_AHEAD = 7;

/** Hard ceiling on how many dates a single request may ever cover. */
export const MAX_SCHEDULE_DATES = SCHEDULE_DAYS_AHEAD + 1;

/** Calendar date (YYYY-MM-DD) for an instant, in the given timezone. */
export function dateInTimezone(instant: Date, timeZone: string): string {
  // `en-CA` formats as YYYY-MM-DD, and Intl applies the zone correctly across
  // DST transitions — safer than any manual offset arithmetic.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * Add whole days to a YYYY-MM-DD date.
 *
 * Operates on the calendar date itself via UTC midnight, so it never drifts by
 * an hour across a DST boundary the way local-time arithmetic can.
 */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) throw new RangeError(`invalid date: ${date}`);

  const base = Date.UTC(year, month - 1, day);
  const shifted = new Date(base + days * 86_400_000);

  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface ScheduleRange {
  /** Today in the application timezone. */
  start: string;
  /** Today + 7, inclusive. */
  end: string;
  /** Every date from start to end, ascending. Always 8 entries. */
  dates: string[];
  timezone: string;
}

/**
 * The schedule window: today through today + 7, inclusive, in `timeZone`.
 *
 * "This week" for this application means today + 7 days — deliberately not
 * Monday to Sunday.
 */
export function scheduleRange(
  timeZone: string,
  now: Date = new Date(),
  daysAhead: number = SCHEDULE_DAYS_AHEAD,
): ScheduleRange {
  const span = Math.max(0, Math.min(daysAhead, MAX_SCHEDULE_DATES - 1));
  const start = dateInTimezone(now, timeZone);

  const dates: string[] = [];
  for (let offset = 0; offset <= span; offset += 1) {
    dates.push(addDays(start, offset));
  }

  return {
    start,
    end: dates[dates.length - 1] ?? start,
    dates,
    timezone: timeZone,
  };
}

/** Whether a date falls inside the range. */
export function isWithinRange(date: string, range: ScheduleRange): boolean {
  return date >= range.start && date <= range.end;
}

/**
 * The calendar date a game belongs to, in the application timezone.
 *
 * A 01:00 BST kick-off is stored as 00:00Z; grouping on the raw ISO date would
 * file it under the previous day for a London viewer.
 */
export function gameDate(startTime: string | null, timeZone: string): string | null {
  if (!startTime) return null;
  const instant = new Date(startTime);
  if (Number.isNaN(instant.getTime())) return null;
  return dateInTimezone(instant, timeZone);
}
