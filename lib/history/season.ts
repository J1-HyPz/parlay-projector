/**
 * What a season is, per sport.
 *
 * Pure. No provider, no clock beyond what is passed in.
 *
 * The archive is organised by season rather than by rolling window, because a
 * completed season is the natural unit of "this will never change again" —
 * which is what makes it safe to write to a file and never re-fetch. That only
 * works if this module gets the boundaries right, and they differ by sport in
 * ways that matter:
 *
 *   Baseball runs inside one calendar year, so its season *is* the year.
 *   Football (soccer) runs August to May, so `2024` means 2024-25.
 *   The NFL, NBA and NHL also cross the new year, and their own labels follow
 *   the starting year the same way.
 *
 * The windows below are deliberately a little wider than the competition
 * itself. Nothing is fabricated by asking for a fortnight of empty dates, and
 * a window that clipped a play-off game would silently lose real results — the
 * expensive error of the two. What actually lands in a season file is whatever
 * the provider returned inside the window, not the window itself.
 */

import type { ConcreteSportId } from '../home/types';

/** The competition, reduced to what a season boundary depends on. */
export interface SeasonSubject {
  id: string;
  sport: ConcreteSportId;
}

export interface SeasonWindow {
  /** The season's label, as the archive keys it — the starting year. */
  season: string;
  /** Inclusive `YYYY-MM-DD` bounds to ask the provider for. */
  startDate: string;
  endDate: string;
  /** Whether the window closes in a later calendar year than it opens. */
  crossesYear: boolean;
}

/**
 * Month-day bounds per sport, as `MM-DD`.
 *
 * `crossesYear` is the load-bearing field: it decides whether a season labelled
 * 2024 ends in 2024 or in 2025, and getting it wrong for a sport would file a
 * season's second half under the wrong year — or drop it entirely.
 */
const BOUNDS: Record<ConcreteSportId, { from: string; to: string; crossesYear: boolean }> = {
  // Kick-off in early September, Super Bowl in mid-February.
  nfl: { from: '08-01', to: '02-28', crossesYear: true },
  nba: { from: '09-15', to: '06-30', crossesYear: true },
  nhl: { from: '09-15', to: '06-30', crossesYear: true },
  // The one that sits inside a single calendar year: spring training through
  // to the World Series in early November.
  mlb: { from: '02-15', to: '11-30', crossesYear: false },
  // August to May across every competition in the football pool.
  football: { from: '07-01', to: '06-30', crossesYear: true },
  // A Formula 1 season is a calendar year, March to December.
  f1: { from: '02-01', to: '12-31', crossesYear: false },
  /*
   * The UFC has no season to bound. It runs cards more or less continuously,
   * about fifty a year with no close season, so a "season" here is the
   * calendar year and the window is all of it. Stated rather than defaulted:
   * a bound that pretended there were an off-season would silently drop every
   * card outside it.
   */
  mma: { from: '01-01', to: '12-31', crossesYear: false },
  /*
   * No competition in the catalogue uses this yet — the sport id exists ahead
   * of §4.8, which brings tennis into real coverage. The entry is here because
   * the exhaustive `Record` demands a decision rather than letting a sport
   * quietly fall through to a wrong default, and the answer is a genuine one:
   * a tour season is a calendar year, opening in Australia in January and
   * closing at the Finals in November.
   */
  tennis: { from: '01-01', to: '12-31', crossesYear: false },
};

/**
 * Competitions whose calendar is not their sport's.
 *
 * Found the hard way: the CFL is `sport: 'nfl'` and inherited the NFL's
 * August-to-February window, which clipped its June-to-November season to 27
 * games where a nine-team schedule plays 81. Nothing failed — the archive
 * simply held a third of a season and looked complete, which is the exact
 * failure mode the file validation refuses to let a *damaged* file cause and
 * could not have caught here, because these files were faithfully written from
 * a wrong question.
 *
 * So a sport's calendar is a default, not a rule. The three competitions here
 * play summer schedules in the northern hemisphere while their sport's flagship
 * league plays through the winter.
 */
const LEAGUE_BOUNDS: Record<string, { from: string; to: string; crossesYear: boolean }> = {
  // June to November, with the Grey Cup in late November.
  cfl: { from: '05-01', to: '12-15', crossesYear: false },
  // Both play over the European summer; both were founded in 2026, so there
  // is no earlier season for these windows to find.
  afle: { from: '03-01', to: '11-30', crossesYear: false },
  efa: { from: '03-01', to: '11-30', crossesYear: false },
};

function boundsFor(subject: SeasonSubject) {
  return LEAGUE_BOUNDS[subject.id] ?? BOUNDS[subject.sport];
}

function pad(year: number): string {
  return String(year).padStart(4, '0');
}

/**
 * The window for one season of a sport.
 *
 * `season` is the *starting* year, matching how every provider here labels a
 * season that crosses the new year.
 */
export function seasonWindow(subject: SeasonSubject, season: number): SeasonWindow {
  const bounds = boundsFor(subject);
  const endYear = bounds.crossesYear ? season + 1 : season;

  return {
    season: pad(season),
    startDate: `${pad(season)}-${bounds.from}`,
    endDate: `${pad(endYear)}-${bounds.to}`,
    crossesYear: bounds.crossesYear,
  };
}

/**
 * Whether a season has finished, as at a date.
 *
 * Only a finished season is written to the archive. An in-progress one can
 * still gain results, and a file that claimed to hold a complete season while
 * missing its last month would be worse than no file — every calibration
 * reading it would silently work from a truncated season.
 */
export function seasonComplete(window: SeasonWindow, today: string): boolean {
  return window.endDate < today;
}

/**
 * The seasons to archive for a sport, newest first.
 *
 * Returns only completed seasons. `count` is the target depth; a sport whose
 * provider coverage is thinner than that simply yields fewer files, which the
 * archive records as the fact it is rather than padding out.
 */
export function seasonsToArchive(
  subject: SeasonSubject,
  today: string,
  count: number,
): SeasonWindow[] {
  const year = Number.parseInt(today.slice(0, 4), 10);
  if (!Number.isFinite(year)) return [];

  const windows: SeasonWindow[] = [];
  // Start from the current year and walk back; the current season is usually
  // still running, so it is filtered out rather than assumed absent.
  for (let candidate = year; candidate > year - count - 2; candidate -= 1) {
    const window = seasonWindow(subject, candidate);
    if (seasonComplete(window, today)) windows.push(window);
    if (windows.length >= count) break;
  }
  return windows;
}
