/**
 * Measuring a competition's constants from its archived seasons.
 *
 * Pure. Games in, numbers out.
 *
 * Every `SportModelConfig` but NCAA Football's carries values marked `assumed`
 * — published long-run averages rather than anything measured against this
 * application's own data. This module is what replaces an assumption with a
 * measurement, and the fit that uses it lives in `scripts/calibrate.ts`.
 *
 * **Pre-season is excluded, and that is not a detail.** The history archive
 * stores every fixture a competition played, exhibitions included, because
 * they happened. A `baselineTotal` fitted over them is fitted partly on games
 * of backups: the NFL archives about 335 fixtures a season where 272 are
 * competitive, so a quarter of the sample would be exhibition football. The
 * archive is right to hold them and the calibration is right to drop them.
 *
 * The filter is by date, because nothing else in a stored fixture distinguishes
 * them. `round` cannot: an NFL divisional play-off in February carries
 * `round: "4"`, exactly like a regular-season week four. The provider does
 * publish a season type, but this application's normaliser has never kept it,
 * and the honest fix for that is to keep it rather than to infer it — noted in
 * the spec as follow-on work. Until then the boundaries below are checked
 * against what each competition is known to play, which is what the
 * `expectedRegularSeason` table is for.
 */

import type { ConcreteSportId, Game } from '../home/types';

/**
 * When competitive play actually runs, as a month-and-day window.
 *
 * A range rather than a start date, and it took a wrong version to see why.
 * The first attempt kept anything falling *earlier* in the calendar than the
 * opening, on the reasoning that such a fixture must be the tail of a season
 * that began the previous year — a January play-off. It is also true of an
 * August pre-season game, so the NFL filter removed nothing at all: 335 games
 * in, 335 out, a quarter of them exhibitions.
 *
 * The front edge is deliberately conservative. Clipping the first day of a
 * real season costs a slightly smaller sample; admitting pre-season biases
 * every constant fitted from it.
 */
interface MonthDay {
  month: number;
  day: number;
}

interface CompetitiveWindow {
  from: MonthDay;
  to: MonthDay;
  /** Whether the window runs past 31 December into the new year. */
  crossesYear: boolean;
}

const BY_SPORT: Record<ConcreteSportId, CompetitiveWindow> = {
  // Pre-season fills August; week one is the Thursday after Labor Day, and the
  // Super Bowl is in February.
  nfl: { from: { month: 9, day: 1 }, to: { month: 2, day: 28 }, crossesYear: true },
  // Pre-season is the first half of October; the Finals end in June.
  nba: { from: { month: 10, day: 18 }, to: { month: 6, day: 30 }, crossesYear: true },
  // Pre-season is September; the Stanley Cup is decided in June.
  nhl: { from: { month: 10, day: 1 }, to: { month: 6, day: 30 }, crossesYear: true },
  // Spring training fills February and most of March; opening day is the last
  // week of March, and the World Series ends in early November.
  mlb: { from: { month: 3, day: 25 }, to: { month: 11, day: 30 }, crossesYear: false },
  // Friendlies run through July; competitive football is August to May.
  football: { from: { month: 8, day: 1 }, to: { month: 6, day: 30 }, crossesYear: true },
  // Testing is in February; the season runs March to December.
  f1: { from: { month: 3, day: 1 }, to: { month: 12, day: 31 }, crossesYear: false },
  tennis: { from: { month: 1, day: 1 }, to: { month: 12, day: 31 }, crossesYear: false },
};

/**
 * Competitions whose competitive window is not their sport's.
 *
 * The same override `lib/history/season.ts` needs, and for the same reason:
 * the CFL is filed under American football and plays through the summer, so
 * the NFL's September-to-February window would discard its entire season.
 */
const BY_LEAGUE: Record<string, CompetitiveWindow> = {
  cfl: { from: { month: 6, day: 1 }, to: { month: 12, day: 15 }, crossesYear: false },
  afle: { from: { month: 3, day: 1 }, to: { month: 11, day: 30 }, crossesYear: false },
  efa: { from: { month: 3, day: 1 }, to: { month: 11, day: 30 }, crossesYear: false },
};

function inWindow(month: number, day: number, window: CompetitiveWindow): boolean {
  const afterStart =
    month > window.from.month || (month === window.from.month && day >= window.from.day);
  const beforeEnd = month < window.to.month || (month === window.to.month && day <= window.to.day);

  // A window that wraps the new year is satisfied by either half of it.
  return window.crossesYear ? afterStart || beforeEnd : afterStart && beforeEnd;
}

/**
 * Games that count toward a fitted constant.
 *
 * Finished, with a real scoreline, and played inside the competitive window.
 */
export function competitiveGames(
  games: readonly Game[],
  sport: ConcreteSportId,
  leagueId?: string,
): Game[] {
  const window = (leagueId ? BY_LEAGUE[leagueId] : undefined) ?? BY_SPORT[sport];

  return games.filter((game) => {
    if (game.status !== 'finished') return false;
    const home = game.score?.home;
    const away = game.score?.away;
    if (typeof home !== 'number' || typeof away !== 'number') return false;

    const date = game.start_time?.slice(0, 10);
    if (!date) return false;

    return inWindow(
      Number.parseInt(date.slice(5, 7), 10),
      Number.parseInt(date.slice(8, 10), 10),
      window,
    );
  });
}

export interface ScoringMeasurement {
  games: number;
  /** Mean combined score — what `baselineTotal` is supposed to be. */
  baseline_total: number;
  /** Mean home margin. Not `homeAdvantage`; see the note in the fit script. */
  mean_home_margin: number;
  /** Standard deviation of the home margin, for comparison with `scoreSd`. */
  margin_sd: number;
  /** Share of fixtures the home side won, draws excluded. */
  home_win_rate: number;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * What a competition actually scores.
 *
 * Descriptive only. `mean_home_margin` in particular is *not* `homeAdvantage`
 * — the ratings already carry most of the home edge through where teams
 * actually played, so fitting the constant to the raw margin double-counts it.
 * That was the exact error NCAA Football's own fit found and corrected, and it
 * is why this returns a measurement rather than a recommendation.
 */
export function measureScoring(games: readonly Game[]): ScoringMeasurement | null {
  const totals: number[] = [];
  const margins: number[] = [];
  let homeWins = 0;
  let decided = 0;

  for (const game of games) {
    const home = game.score?.home;
    const away = game.score?.away;
    if (typeof home !== 'number' || typeof away !== 'number') continue;

    totals.push(home + away);
    margins.push(home - away);
    if (home !== away) {
      decided += 1;
      if (home > away) homeWins += 1;
    }
  }

  if (totals.length === 0) return null;

  return {
    games: totals.length,
    baseline_total: mean(totals),
    mean_home_margin: mean(margins),
    margin_sd: standardDeviation(margins),
    home_win_rate: decided > 0 ? homeWins / decided : 0,
  };
}

/** Games grouped by the season file they came from, for held-out validation. */
export function bySeason(games: readonly Game[]): Map<string, Game[]> {
  const seasons = new Map<string, Game[]>();
  for (const game of games) {
    const season = game.season ?? 'unknown';
    const list = seasons.get(season);
    if (list) list.push(game);
    else seasons.set(season, [game]);
  }
  return seasons;
}

/**
 * What each competition's regular season should come to.
 *
 * A check on the filter above rather than a constant anything reads. If the
 * competitive count lands far from this, the date boundary is wrong and every
 * number fitted from it would be wrong with it — which is precisely the class
 * of error that produced a 27-game CFL season and was caught the same way.
 *
 * Play-offs sit on top of these, so the measured figure should exceed the
 * entry rather than match it exactly.
 */
export const EXPECTED_REGULAR_SEASON: Record<string, number> = {
  nfl: 272, // 32 teams, 17 games
  nba: 1230, // 30 teams, 82 games
  nhl: 1312, // 32 teams, 82 games
  mlb: 2430, // 30 teams, 162 games
  epl: 380, // 20 teams, double round robin
  laliga: 380,
  seriea: 380,
  bundesliga: 306, // 18 teams
  championship: 552, // 24 teams
  'league-one': 552,
  cfl: 81, // 9 teams, 18 games
};

// ---------------------------------------------------------------------------
// Distributional fit
// ---------------------------------------------------------------------------

export interface DispersionMeasurement {
  scores: number;
  mean_score: number;
  score_variance: number;
  /**
   * Variance divided by mean. A Poisson process gives exactly 1.
   *
   * Above 1 the sport scores in bursts a Poisson draw cannot produce, and no
   * value of any constant will widen the simulation to match: the variance is
   * pinned to the mean by the distribution itself.
   */
  variance_ratio: number;
  /** Observed SD of the home margin. */
  margin_sd: number;
  /** The margin SD a Poisson model can produce: sqrt(2 * mean score). */
  poisson_margin_sd: number;
}

/**
 * Whether a competition's scoring is actually Poisson.
 *
 * Worth measuring before fitting anything for a Poisson sport, because it asks
 * a question no constant can answer. Checked across five archived seasons, the
 * NHL came out at 0.99 and the football competitions between 1.01 and 1.15 —
 * the model family is well chosen for them. Baseball came out at 2.27, with a
 * margin spread half again as wide as Poisson allows, which is a statement
 * about the distribution rather than about any value in its config.
 */
export function measureDispersion(games: readonly Game[]): DispersionMeasurement | null {
  const scores: number[] = [];
  const margins: number[] = [];

  for (const game of games) {
    const home = game.score?.home;
    const away = game.score?.away;
    if (typeof home !== 'number' || typeof away !== 'number') continue;
    scores.push(home, away);
    margins.push(home - away);
  }

  if (scores.length < 2) return null;

  const meanScore = mean(scores);
  const variance = standardDeviation(scores) ** 2;

  return {
    scores: scores.length,
    mean_score: meanScore,
    score_variance: variance,
    variance_ratio: meanScore > 0 ? variance / meanScore : 0,
    margin_sd: standardDeviation(margins),
    poisson_margin_sd: Math.sqrt(2 * meanScore),
  };
}
