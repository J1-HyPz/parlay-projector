/**
 * Projecting a fight.
 *
 * Nothing in the scoring model transfers, and the reason is not that a fight is
 * a simpler fixture. The team model asks how much each side will score and
 * compares the two distributions; **a fight has no scoring process to ask that
 * of.** There is one discrete outcome and nothing to accumulate. So there is no
 * attack rate, no defence rate, no `expectedScores`, and no total — the rating
 * is an Elo alone, walked forward through completed fights exactly as team Elo
 * already is.
 *
 * That makes this model *simpler* than the team model in one specific respect
 * rather than a stripped-down copy of it, which is what §4.8.a step 4 asks for.
 *
 * **There is no simulation here, deliberately.** Every other model in this
 * application simulates because it needs a joint distribution: totals, spreads
 * and team totals all have to be read off the same simulated games or they can
 * contradict one another. A fight winner is a single Bernoulli outcome, and its
 * probability *is* the answer — running ten thousand coin flips at a known
 * probability would return that probability plus sampling noise, and nothing
 * else. When a method-of-victory or round market is built on top, that market
 * may need one; the winner does not.
 *
 * **Division scoping.** A rating is built from a fighter's results at the
 * weight they are fighting at, never blended across divisions — §4.8.a step 8.
 * A fighter is therefore rated once per division they have competed in, and a
 * fighter arriving in a new division starts from the same place a debutant
 * does. That is deliberately conservative: moving weight is a real disruption,
 * and carrying a rating across it would assert an equivalence nobody has
 * established. `divisionsFought` exists so a projection can *say* that a
 * fighter has moved rather than silently rating them as new.
 *
 * **The rating window is years, and this is not the NCAAF mistake.** §4.3 is
 * emphatic that a team's rating window never gets extended, because a longer
 * window lets a team borrow a roster that is no longer the team being
 * projected. A fighter does not turn over: their last several fights across
 * three years are evidence about the same specific person. A UFC fighter may
 * have ten to twenty fights in an entire career, so a window of a few hundred
 * days would hold one or two of them and say nothing at all.
 *
 * What is deliberately **not** modelled:
 *
 *   Method of victory beyond decision-versus-finish. The feed's
 *   `status.type.detail` is the bare string "Final" on every completed fight,
 *   so KO/TKO cannot be told from submission. Checked 2026-09-10, not assumed.
 *
 *   Style matchup, reach, stance, age, layoff, weight-cut difficulty, judging
 *   variance, referee stoppage timing. All real, all widely discussed, and none
 *   of them recoverable from a win/loss record. Stated rather than approximated
 *   from something that correlates with them.
 *
 * Pure: given the same results and seed, the same numbers come out.
 */

import { clamp, eloExpectation, eloUpdate } from './math.ts';
import type { Game } from '../home/types';

export interface BoutModelConfig {
  /**
   * Elo K-factor.
   *
   * Higher than a team sport's on purpose: a fighter competes two or three
   * times a year against a team's fifty or eighty, so a rating that moved as
   * slowly per contest would never arrive anywhere within a career.
   */
  eloK: number;
  /** Fights at this division below which no projection is offered at all. */
  minFights: number;
  /** Fights at which the rating is considered to stand on its own. */
  targetFights: number;
  /** How far back completed fights are read, in days. */
  historyDays: number;
  /**
   * Rating points of edge per unit of the win probability curve.
   *
   * Not a free parameter — it is Elo's own 400, kept named so the model does
   * not read as though a magic number were buried in it.
   */
  scale: number;
}

export const BOUT_CONFIG: BoutModelConfig = {
  /*
   * Fitted against 1,125 held-out fights from 2024-2025, everything else held
   * fixed. Swept until it turned: Brier falls from 0.2379 at K=64 to 0.2344 at
   * 160 and rises again beyond it, and calibration bias crosses zero between
   * 160 and 200. Both criteria land in the same place.
   *
   * This is more than twenty times the NFL's K, and that is the sport rather
   * than a mistake. A team plays sixty or eighty times a season and a rating
   * has all year to find it; a UFC fighter competes two or three times a year
   * and may have eight fights in the entire window. A rating that moved at a
   * team sport's pace would never leave 1500, which is exactly what the first
   * run of this model did -- it gave the favourite 52% and the favourite won
   * 59%.
   */
  eloK: 160,
  /*
   * Three fights at a division before this model will say anything.
   *
   * §4.8.a step 6 is explicit that a large share of any card will not clear
   * this and that the honest answer is "insufficient data". A UFC prelim is
   * frequently two debutants, and there is nothing to know about that fight.
   *
   * Chosen on the fights each floor *admits*, which is the only way to read
   * it: comparing whole-sample error across floors is meaningless, because a
   * stricter floor skips the fights the model knows least about and its error
   * falls for a reason that has nothing to do with being better. Scored on
   * the fights every floor projected, 2, 3, 4 and 6 produce byte-identical
   * numbers -- the floor decides *which* fights get a projection and nothing
   * about their quality.
   *
   * The marginal fights settle it. Going from 4 to 3 admits 117 held-out
   * fights at 62.4% accuracy and a Brier of 0.2324, as good as the base.
   * Going from 3 to 2 admits 154 more at 55.8% and a bias of +0.0391 --
   * barely better than a coin toss, and over-confident about it. Those are
   * fights this model does not know, and it says so instead.
   */
  minFights: 3,
  targetFights: 8,
  /*
   * Five years. Long by this application's standards and short by the sport's:
   * a fighter competing twice a year has ten fights in it, which is roughly a
   * whole career for a UFC roster member.
   */
  historyDays: 5 * 365,
  scale: 400,
};

/** Starting rating for a fighter nobody has seen yet. */
export const STARTING_ELO = 1500;

export interface FighterRating {
  fighter: string;
  /** Fights counted at this division inside the window. */
  fights: number;
  elo: number;
  /** Wins, losses and draws at this division, for the explanation text. */
  wins: number;
  losses: number;
  draws: number;
  /** Most recent fight, for a layoff caution. */
  lastFought: number | null;
  /** Recent results, newest first. */
  recentForm: ('W' | 'D' | 'L')[];
}

export interface BoutRatings {
  /** Keyed by `fighterId|division`; a fighter is rated once per division. */
  fighters: Map<string, FighterRating>;
  /** Which divisions each fighter has appeared in, for the move caution. */
  divisionsFought: Map<string, Set<string>>;
  /** Completed fights the ratings were built from. */
  sample: number;
}

/** One completed fight, reduced to what a rating needs. */
export interface BoutResult {
  date: number;
  homeId: string;
  awayId: string;
  /** Null for a draw or a no-contest, which settle as neither side's win. */
  winner: 'home' | 'away' | null;
  division: string;
}

/** The key a rating is stored under. A fighter is a different rating per weight. */
export function ratingKey(fighterId: string, division: string | null | undefined): string {
  return `${fighterId}|${(division ?? 'unknown').toLowerCase()}`;
}

/**
 * Completed fights, oldest first.
 *
 * `asOf` is the hard boundary, exactly as in every other model here: a fight is
 * only included if it started before that instant. Passing the projected
 * fight's own start time is what stops a projection seeing its own result.
 */
export function toBoutResults(games: readonly Game[], asOf: number): BoutResult[] {
  const results: BoutResult[] = [];

  for (const game of games) {
    if (game.status !== 'finished' || !game.start_time) continue;
    const date = Date.parse(game.start_time);
    if (!Number.isFinite(date) || date >= asOf) continue;

    const home = game.home_team?.id;
    const away = game.away_team?.id;
    if (!home || !away || home === away) continue;

    /*
     * A no-contest is not a result.
     *
     * `winner` is null for a draw and for a no-contest alike, and the two are
     * different: a draw is a contested outcome and belongs in a rating at 0.5,
     * a no-contest settled nothing at all. The feed does not distinguish them,
     * so both are taken as draws — which is the conservative reading, since it
     * moves a rating less than treating either as a win would.
     */
    results.push({
      date,
      homeId: home,
      awayId: away,
      winner: game.winner ?? null,
      division: game.division ?? 'unknown',
    });
  }

  return results.sort((a, b) => a.date - b.date);
}

/**
 * Rate every fighter from completed fights.
 *
 * One chronological pass. Unlike the team model there is no second pass for
 * opposition strength, because Elo already carries it: beating a highly rated
 * fighter moves a rating further than beating a poorly rated one, by
 * construction.
 *
 * The margin multiplier `eloUpdate` applies for team sports is neutralised
 * here by passing a margin of 1 for every fight. A win is a win — there is no
 * scoreline to be emphatic about, and a decision and a first-round knockout
 * count the same because the feed cannot reliably tell them apart anyway.
 */
export function buildBoutRatings(
  results: readonly BoutResult[],
  config: BoutModelConfig = BOUT_CONFIG,
): BoutRatings {
  const fighters = new Map<string, FighterRating>();
  const divisionsFought = new Map<string, Set<string>>();

  const ensure = (id: string, division: string): FighterRating => {
    const key = ratingKey(id, division);
    const existing = fighters.get(key);
    if (existing) return existing;
    const created: FighterRating = {
      fighter: id,
      fights: 0,
      elo: STARTING_ELO,
      wins: 0,
      losses: 0,
      draws: 0,
      lastFought: null,
      recentForm: [],
    };
    fighters.set(key, created);
    return created;
  };

  for (const result of results) {
    const home = ensure(result.homeId, result.division);
    const away = ensure(result.awayId, result.division);

    for (const [id, set] of [
      [result.homeId, divisionsFought],
      [result.awayId, divisionsFought],
    ] as const) {
      const seen = set.get(id) ?? new Set<string>();
      seen.add(result.division.toLowerCase());
      set.set(id, seen);
    }

    const homeScore: 1 | 0.5 | 0 =
      result.winner === 'home' ? 1 : result.winner === 'away' ? 0 : 0.5;

    // Read both ratings before either is written, so a fight updates from the
    // state that stood before it rather than from a half-applied one.
    const homeElo = home.elo;
    const awayElo = away.elo;
    home.elo = eloUpdate(homeElo, awayElo, homeScore, 1, config.eloK);
    away.elo = eloUpdate(
      awayElo,
      homeElo,
      homeScore === 1 ? 0 : homeScore === 0 ? 1 : 0.5,
      1,
      config.eloK,
    );

    for (const [rating, score] of [
      [home, homeScore],
      [away, homeScore === 1 ? 0 : homeScore === 0 ? 1 : 0.5],
    ] as const) {
      rating.fights += 1;
      rating.lastFought = result.date;
      if (score === 1) rating.wins += 1;
      else if (score === 0) rating.losses += 1;
      else rating.draws += 1;
      rating.recentForm.unshift(score === 1 ? 'W' : score === 0 ? 'L' : 'D');
      if (rating.recentForm.length > 6) rating.recentForm.pop();
    }
  }

  return { fighters, divisionsFought, sample: results.length };
}

export interface BoutProjection {
  /** Probability the first-listed fighter wins, excluding a draw. */
  home: number;
  away: number;
  /** Elo points between them, first-listed minus second. */
  edge: number;
  /** 0..1, how much the projection actually rests on. */
  dataQuality: number;
  /** True when either fighter is competing outside their usual division. */
  movedDivision: boolean;
}

/**
 * How much this projection knows, 0..1.
 *
 * Driven by the *weaker* of the two records, exactly as the team model is: a
 * fight between a twenty-fight veteran and a debutant is a thin projection, and
 * averaging the two would disguise that.
 */
function quality(home: FighterRating, away: FighterRating, config: BoutModelConfig): number {
  const weakest = Math.min(home.fights, away.fights);
  if (weakest < config.minFights) return 0;
  return clamp(weakest / config.targetFights, 0, 1);
}

/**
 * Project a fight, or return null when there is not enough to say anything.
 *
 * Null rather than a low-confidence number is the whole point: on a typical
 * card several fights involve someone with no record at this weight, and the
 * honest answer for those is that this model does not know.
 */
export function projectBout(
  homeId: string,
  awayId: string,
  division: string | null | undefined,
  ratings: BoutRatings,
  config: BoutModelConfig = BOUT_CONFIG,
): BoutProjection | null {
  const home = ratings.fighters.get(ratingKey(homeId, division));
  const away = ratings.fighters.get(ratingKey(awayId, division));
  if (!home || !away) return null;

  const dataQuality = quality(home, away, config);
  if (dataQuality <= 0) return null;

  const edge = home.elo - away.elo;
  /*
   * No home advantage term, and none is possible.
   *
   * Neither fighter is at home; the order is the card's running order. The
   * team model's `homeAdvantage` has no counterpart here, and adding one would
   * be reading a venue effect into a presentation detail.
   */
  const homeWin = eloExpectation(edge);

  return {
    home: homeWin,
    away: 1 - homeWin,
    edge,
    dataQuality,
    movedDivision:
      (ratings.divisionsFought.get(homeId)?.size ?? 0) > 1 ||
      (ratings.divisionsFought.get(awayId)?.size ?? 0) > 1,
  };
}
