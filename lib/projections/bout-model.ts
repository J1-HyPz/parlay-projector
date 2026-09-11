/**
 * Projecting a contest between two individuals.
 *
 * Written for fights and now shared with tennis, which is why the vocabulary
 * says "bout" throughout. The two sports need exactly the same engine — rate
 * each competitor by Elo from completed results, read the winner probability
 * off the gap — and differ only in their constants, the way the NFL and the
 * NBA share the Normal-scoring family with different numbers. `BOUT_CONFIG`
 * and `TENNIS_CONFIG` at the bottom are that difference, and nothing else in
 * this file knows which sport it is looking at.
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
   * Stored on every prediction this config produces.
   *
   * Per competition, as the v2 spec requires: a UFC prediction and a WTA one
   * are made by different constants and must never be averaged together under
   * one label in the accuracy breakdown.
   */
  modelVersion: string;
  /**
   * What a contest and a competitor are called in this sport.
   *
   * Only for the text a projection explains itself with. A tennis reader
   * shown "fights" would rightly stop trusting the rest of the sentence.
   */
  nouns: { contest: string; contests: string; competitor: string };
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
  modelVersion: 'bout-v1-ufc',
  nouns: { contest: 'fight', contests: 'fights', competitor: 'fighter' },
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

/**
 * Tennis, on the same engine with its own numbers.
 *
 * `eloK` is 32 against MMA's 160, and the ratio is the schedule rather than a
 * judgement about the sports. A tour player contests fifty or eighty matches a
 * year where a fighter has two or three, so a rating has vastly more chances to
 * find its level and each one should move it less. Swept and turned cleanly:
 * held-out Brier falls to 0.2242 at 32 and rises either side, and calibration
 * bias crosses zero between 32 and 48. Both criteria agree.
 *
 * **`minFights` is the one value here the data does not identify, and saying so
 * matters.** Accuracy was measured against the weaker player's record length
 * directly, in bands: 4-6 gave 57.4%, 6-8 gave 55.1%, 8-10 gave 64.6%, 13-16
 * gave 66.5% and 16-20 gave 54.0%. There is no ordering in that — the bands
 * hold two or three hundred matches each and are all within noise of one
 * another. Only the 30-and-over band is stable, at 62.8% across 5,641 matches
 * with a bias of +0.0001.
 *
 * So 10 is a judgement, not an optimum. It is defended by the two loosest steps
 * measured earlier — dropping from 10 to 6 admitted 368 matches at 58.7%, and 6
 * to 4 admitted 209 at 56.0% — and by ten tour matches being a record a person
 * would recognise as one. It is not defended by a measured minimum, because
 * there is not one.
 *
 * `historyDays` measured best at five years, marginally (Brier 0.2234 against
 * 0.2242 at three). Worth reading carefully: the archive begins in 2020, so a
 * five-year window on a 2024 match reaches past its start. The real comparison
 * is therefore "three years" against "everything there is", and everything won
 * narrowly.
 *
 * **Qualifying rounds are rated.** They are a third of the draw and they cost
 * nothing: scored on the main-draw matches both variants could project,
 * including them gave 63.7% and a Brier of 0.2187 against 63.8% and 0.2180
 * without — identical. But they let the model reach 6,860 held-out matches
 * instead of 4,753. Free coverage for no measurable quality.
 */
export const TENNIS_CONFIG: BoutModelConfig = {
  modelVersion: 'bout-v1-atp',
  nouns: { contest: 'match', contests: 'matches', competitor: 'player' },
  eloK: 32,
  minFights: 10,
  targetFights: 30,
  historyDays: 5 * 365,
  scale: 400,
};

/**
 * The women's tour, which wants its own K.
 *
 * Checked rather than assumed that one tennis config would serve both, and it
 * does not. On the WTA archive, K=32 leaves the model 2.1 points
 * under-confident (bias -0.0214); K=48 brings that to -0.0015 and takes Brier
 * from 0.2238 to 0.2230. The error difference is small and the calibration
 * difference is not — a systematically under-confident price is wrong in the
 * same direction every time, which is exactly what bias measures and error
 * averages away.
 *
 * No explanation is offered for *why* the women's tour wants faster-moving
 * ratings. Several are plausible and this application has no evidence for any
 * of them, so the measurement is recorded and the story is not.
 *
 * Everything else is the ATP's, because everything else was measured on the
 * ATP archive and nothing suggested the two tours differ in it.
 */
export const WTA_CONFIG: BoutModelConfig = {
  ...TENNIS_CONFIG,
  modelVersion: 'bout-v1-wta',
  eloK: 48,
};

/**
 * The config for a competition rated by this engine, or null.
 *
 * Null is the answer for every team sport and every race: those have their own
 * models, and this one must not be handed a fixture it would rate as though
 * two people had played it.
 */
export function boutConfigForLeague(leagueId: string): BoutModelConfig | null {
  if (leagueId === 'ufc') return BOUT_CONFIG;
  if (leagueId === 'atp') return TENNIS_CONFIG;
  if (leagueId === 'wta') return WTA_CONFIG;
  return null;
}

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
     * A walkover is not evidence about anybody.
     *
     * The opponent withdrew before play, so no tennis happened at all and the
     * "winner" did nothing to earn it. A retirement is different and is kept:
     * a set and a half was played and the player who stopped was usually
     * losing it.
     *
     * Measured before being decided, because the principle could have gone
     * either way. Excluding walkovers, retirements, both or neither moves the
     * held-out Brier by less than 0.0003 across 7,170 matches — they are 3.3%
     * of the archive and the difference is nothing. So this is a choice made
     * on principle over a tie, not a measured improvement, and it is recorded
     * that way rather than dressed up as a finding.
     */
    if (game.completion === 'walkover') continue;

    /*
     * A no-contest is not a result either.
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

/**
 * The model's raw answer for one contest.
 *
 * The number and what it rests on, nothing else. The projection a reader sees
 * — names, records, evidence, a model version — is built from this in
 * `bout-selections.ts`, the same way `projectGame` dresses the scoring model's
 * distribution. Kept apart so the estimate stays a pure function of the
 * ratings, which is what the backtest replays.
 */
export interface BoutEstimate {
  /** Probability the first-listed fighter wins, excluding a draw. */
  home: number;
  away: number;
  /** Elo points between them, first-listed minus second. */
  edge: number;
  /** 0..1, how much the projection actually rests on. */
  dataQuality: number;
  /** True when either fighter is competing outside their usual division. */
  movedDivision: boolean;
  /** How many divisions each has appeared in, so the caution can name who moved. */
  divisions: { home: number; away: number };
  /** The two ratings the estimate was read from, for the explanation. */
  ratings: { home: FighterRating; away: FighterRating };
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
): BoutEstimate | null {
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

  const divisions = {
    home: ratings.divisionsFought.get(homeId)?.size ?? 0,
    away: ratings.divisionsFought.get(awayId)?.size ?? 0,
  };

  return {
    home: homeWin,
    away: 1 - homeWin,
    edge,
    dataQuality,
    movedDivision: divisions.home > 1 || divisions.away > 1,
    divisions,
    ratings: { home, away },
  };
}
