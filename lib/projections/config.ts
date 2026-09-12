/**
 * Sport-specific model configuration.
 *
 * Every tunable number lives here rather than scattered through the models, so
 * the assumptions are visible in one place and can be revised without hunting
 * through formulas.
 *
 * Nothing is shared blindly across sports. Home advantage in the NBA is not
 * home advantage in the Premier League; a 27-point NFL score and a 2-goal
 * football score are not the same kind of quantity and are not modelled the
 * same way.
 *
 * The values are starting points calibrated from the long-run averages of each
 * competition, not learned parameters. They are stated as assumptions and
 * should be recalibrated once enough settled predictions exist — see
 * docs/projection-engine.md.
 */

import { MLB_PARK_FACTORS } from './parks.ts';
import type { ParkFactor } from './parks.ts';
import type { ConcreteSportId } from '../home/types';

/**
 * How a sport's scoring is modelled.
 *
 * `poisson`  Low-scoring, count-like: goals and runs. Discrete, right-skewed,
 *            and a draw is a real possibility.
 * `normal`   High-scoring: points. The total of many small scoring events is
 *            near-normal, and an exact tie is rare enough to ignore.
 */
export type ScoringModel = 'poisson' | 'normal';

export interface SportModelConfig {
  scoring: ScoringModel;
  /**
   * How conditions move the expected total, where they measurably do.
   *
   * Absent for every competition that has not been measured, and absent is not
   * "no effect assumed" — it is "not checked", and the modifier stays inert.
   * Indoor fixtures are unaffected whatever this says.
   */
  weather?: {
    /** Change in combined score per degree Celsius above `referenceC`. */
    perDegreeC: number;
    /** The temperature at which no adjustment is made — the archive's mean. */
    referenceC: number;
    /** Largest adjustment in either direction, in the sport's own units. */
    cap: number;
  };
  /**
   * The grounds this competition plays at, and how much scoring each adds.
   *
   * Corrects a bias in the ratings rather than a property of the fixture. A
   * club's scoring rate is built from every game it plays, half at its own
   * ground, so a club at an extreme park carries a rate too low for its home
   * fixtures and too high for its away ones — mirrored at r = -0.947 across
   * five archived MLB seasons. `weight` is the share of the gap the ratings
   * fail to price, fitted rather than assumed.
   *
   * Absent for every competition but baseball, and absent means inert: it was
   * measured for basketball and ice hockey and made both *worse*. §4.7 in
   * `docs/specs/projection-v2.md` has the numbers.
   */
  parks?: {
    /** Share of the park gap the ratings do not already carry. */
    weight: number;
    /** Largest adjustment in either direction, in the sport's own units. */
    cap: number;
    /** Home ground and factor per club. See `lib/projections/parks.ts`. */
    factors: Readonly<Record<string, ParkFactor>>;
  };
  /**
   * How much more a score varies than a Poisson process allows.
   *
   * Poisson fixes the variance of a count at its mean, which is a genuine
   * assumption rather than a formality: a sport that scores in bursts cannot
   * be simulated at its real spread however its other constants are set. Above
   * 1 the rate is mixed through a Gamma before the count is drawn, widening
   * the distribution without moving its mean.
   *
   * Absent, or 1, is plain Poisson, and it is the right answer for every
   * competition here except baseball — the variance-to-mean ratio measured
   * 0.99 for ice hockey and 1.01 to 1.15 across football. Ignored entirely by
   * a normal-scoring sport, which has `scoreSd` for the same job.
   */
  scoreDispersion?: number;
  /**
   * Overrides the stored model version for this sport only.
   *
   * The v2 spec requires a version bump *per competition*, when that
   * competition's change lands — not one global bump that relabels every
   * sport's stored predictions and makes it look as though all of them
   * changed. A sport whose behaviour is untouched leaves this unset and keeps
   * `MODEL_VERSION`, so the accuracy breakdown by model version stays a
   * truthful record of what actually differed.
   */
  modelVersion?: string;
  /** Whether a drawn result is a genuine outcome that must be modelled. */
  hasDraw: boolean;
  /** Whether a points handicap is a sensible selection for this sport. */
  supportsSpread: boolean;

  /**
   * Typical combined score, used as the prior a team's rates regress toward
   * when its own sample is thin.
   */
  baselineTotal: number;
  /** Home advantage, in points/goals added to the home side's expectation. */
  homeAdvantage: number;
  /**
   * Standard deviation of a single team's score, for the normal model.
   * Ignored by Poisson sports, where the variance is the mean.
   */
  scoreSd: number;

  /** Elo K-factor. Higher means ratings move faster per game. */
  eloK: number;
  /**
   * Points of expected margin per 100 Elo. Converts a rating gap into a
   * scoreline, so Elo can inform the margin rather than be a separate answer.
   */
  marginPerHundredElo: number;
  /**
   * How much the Elo-implied margin is blended with the scoring model's.
   * 0 ignores Elo; 1 would use it alone, which the brief rules out.
   */
  eloWeight: number;

  /** Half-life in games for recency weighting of results. */
  formHalfLife: number;
  /** Weight given to season-long form versus the recent window. */
  seasonWeight: number;
  /** Games below which a team's own rates are not trusted on their own. */
  minGames: number;
  /** Games at which data quality from history alone is considered full. */
  targetGames: number;

  /**
   * How far back to load completed results, in days.
   *
   * Set per sport from the shape of its calendar rather than one figure for
   * everything: an NFL team plays seventeen games across five months, so a
   * 200-day window in September holds barely one of them, while an NBA team
   * plays eighty in six.
   */
  historyDays: number;

  /**
   * Ratings pool this competition belongs to.
   *
   * Competitions sharing a pool are rated together. Football uses one pool so a
   * Champions League fixture is projected from the clubs' domestic results —
   * without it, a club's handful of European games is far below the minimum and
   * every cup tie reads "projection unavailable". The pooling is also sound:
   * these competitions are exactly where clubs from different leagues play each
   * other, so a shared Elo is meaningful rather than a category error.
   *
   * Null means the competition is rated on its own.
   */
  ratingPool: string | null;

  /** Days between games under which a side is treated as short-rested. */
  shortRestDays: number;
  /** Points removed from a short-rested side's expectation. */
  shortRestPenalty: number;
}

/*
 * Checked against five archived seasons, 2021-2025, and left alone.
 *
 * Fitted on 2021-2023 and reported on 2024 and 2025 held out. Every candidate
 * was scored on the fixtures every candidate projected, because changing
 * `historyDays` changes which teams clear `minGames` and so which fixtures are
 * projectable at all — comparing error rates across different fixture sets is
 * a statement about which games a variant skipped.
 *
 *   baselineTotal  measured 44.79 against 44. Moving it changed nothing at
 *                  all -- identical bias, error, Brier and accuracy in both
 *                  held-out seasons -- and the reason is that a backtest
 *                  cannot see this constant. It never enters expectedScores:
 *                  `leagueAverage` is the *measured* average of the games in
 *                  the window, and baselineTotal is only its fallback when
 *                  there are no games at all. What it does reach is the
 *                  confidence estimate and the wording of two factors. So the
 *                  measurement above is the evidence it is right, and the
 *                  unchanged backtest is not.
 *   homeAdvantage  held-out bias is already +0.47 and -1.61 in the two
 *                  seasons — it changes sign. Fitting the constant to zero the
 *                  bias on the fitting seasons pushed it to 3.6 and made
 *                  held-out bias worse, from 0.45 to 2.19. The edge is not
 *                  stable enough at this sample size to fit against.
 *   scoreSd        10 implies a margin SD of 14.14 (each side is sampled
 *                  independently, so the margin carries a factor of sqrt 2).
 *                  Measured margin SD is 14.07. Essentially exact.
 *   historyDays    anything below 300 costs a third of the season: 65%
 *                  coverage against 99.7%, and worse margin error on what it
 *                  does project. The comment below was right.
 *
 * Recorded so the next person does not re-run the same check blind. The method
 * is in docs/projection-engine.md; the harness is scripts/calibrate.
 */
const NFL: SportModelConfig = {
  scoring: 'normal',
  hasDraw: false,
  supportsSpread: true,
  // Measured 44.79 across 2021-2025. Left at 44: within a point, and this
  // constant reaches only the confidence estimate and two factor sentences --
  // never the expected score. See the note above.
  baselineTotal: 44,
  // Long the largest home edge in the major American leagues, though it has
  // shrunk in recent seasons. Confirmed measured, not assumed: see above.
  homeAdvantage: 1.8,
  // Per-team, so the implied margin SD is 10 * sqrt2 = 14.14 against a
  // measured 14.07.
  scoreSd: 10,
  eloK: 20,
  marginPerHundredElo: 2.8,
  eloWeight: 0.4,
  formHalfLife: 5,
  seasonWeight: 0.6,
  // A 17-game season means "a full sample" is small by any other sport's
  // standards, so the thresholds are correspondingly low.
  minGames: 4,
  targetGames: 12,
  // A full previous season plus the current one. Anything shorter leaves every
  // team below the minimum until October -- measured at 65% coverage against
  // 99.7%, for worse error on the fixtures it still managed.
  historyDays: 400,
  ratingPool: null,
  shortRestDays: 5,
  shortRestPenalty: 1.0,
};

/*
 * Fitted against five archived seasons, 2022-2026, held out on 2025 and 2026.
 *
 * One change, and it is the NCAA Football finding in mirror image. NCAAF's
 * stated width was too *narrow*; basketball's was too *wide*, and both
 * misprice every threshold market — one by pricing handicaps as more certain
 * than the model is, the other as less.
 *
 * Everything else measured as already correct: `baselineTotal` came out at
 * 225.61 against 226 -- a backtest cannot see that constant at all, so the
 * measurement is the evidence rather than the unchanged metrics -- and
 * `historyDays` below 250 costs coverage (88.5% against 99.7%) for worse error
 * on what it still projects. Recorded so the check is not re-run blind.
 */
const NBA: SportModelConfig = {
  // Bumped when scoreSd was refitted: an NBA projection made after it is not
  // comparable with one made before, and only NBA's changed.
  modelVersion: 'projection-v1-nba-width',
  scoring: 'normal',
  hasDraw: false,
  supportsSpread: true,
  // Measured 225.61. Left at 226: within half a point, and this constant
  // reaches only confidence and factor wording, never the expected score.
  baselineTotal: 226,
  homeAdvantage: 2.2,
  /*
   * Was 12, which implied a margin SD of 16.97 against a measured error spread
   * of 14.5 — seventeen per cent too wide, in both held-out seasons.
   *
   * Per-team, so the margin the model implies carries a factor of sqrt 2.
   * At 10.3 the implied width is 14.57 against measured 14.36 and 14.68: the
   * gap closes from +2.61 and +2.29 to +0.21 and -0.11. Brier and log loss
   * improve in both seasons over 2,660 fixtures.
   */
  scoreSd: 10.3,
  eloK: 20,
  marginPerHundredElo: 3.5,
  eloWeight: 0.4,
  formHalfLife: 8,
  seasonWeight: 0.6,
  minGames: 6,
  targetGames: 25,
  historyDays: 330,
  ratingPool: null,
  // Back-to-backs are the defining rest effect in basketball.
  shortRestDays: 1,
  shortRestPenalty: 1.5,
};

/*
 * Checked against five archived seasons, 2021-2025, held out on 2024 and 2025.
 * No constant changed. The finding that matters is not a constant.
 *
 * **Baseball is the one sport here that is not Poisson.** Measured across
 * 12,259 fixtures, the variance of a team's score is 2.27 times its mean,
 * where a Poisson process fixes that ratio at exactly 1. The observed margin
 * spread is 4.48 against the 3.01 a Poisson model can produce, and on the
 * held-out seasons the model's implied width came out 34% narrower than its
 * own error. Every total, run line and team total therefore prices as more
 * certain than the model actually is.
 *
 * No constant could fix that, because a Poisson draw takes its variance from
 * its mean — so the distribution itself was changed. `scoreDispersion` mixes
 * the rate through a Gamma before the count is drawn, which widens the spread
 * without moving the mean, and 2.3 was fitted by backtest rather than taken
 * from the raw 2.27: the observed ratio mixes the spread of a single fixture
 * with the variation between fixtures, and the model already reproduces the
 * second through its own varying expectations.
 *
 * Held out on 2024 and 2025 separately, 4,956 fixtures. Implied width against
 * measured error goes from -1.41 and -1.56 to +0.13 and -0.03. Brier falls
 * 0.2499 to 0.2464 and 0.2476 to 0.2442; log loss 0.6936 to 0.6858 and 0.6888
 * to 0.6813. Margin error and accuracy are unchanged to three decimals in both
 * seasons, which is the signature a width-only change should have — if they
 * had moved, the fix would have been quietly changing the projection itself.
 *
 * For contrast the same measurement puts ice hockey at 0.99 and the football
 * competitions between 1.01 and 1.15, so plain Poisson is right for them and
 * they set no dispersion at all.
 *
 * The constants themselves measured close and were left alone. `baselineTotal`
 * came out at 8.97 against 8.6 — and a backtest cannot see that constant, so
 * the measurement is the evidence rather than the metrics. `homeAdvantage` is
 * the interesting one: the raw home margin is only 0.046 runs, a quarter of
 * the configured 0.2, because a home side leading after eight and a half
 * innings does not bat again. But bias, Brier and log loss disagree about
 * where the optimum sits — bias favours 0.1, Brier and log loss favour 0.3 —
 * across a total Brier range of 0.0013. Nothing is identified well enough to
 * move, and tuning it against a Brier already distorted by the dispersion
 * problem above would be fitting a symptom.
 */
const MLB: SportModelConfig = {
  /*
   * Bumped when the starting-pitcher substitution landed: an MLB projection
   * made after it is not comparable with one made before, and only MLB's is
   * affected.
   */
  /*
   * Bumped again for the dispersion fit, not reused from the pitcher change.
   * A version stamp has to say which change a stored prediction was made
   * under, and these are two unrelated changes to the same competition.
   */
  modelVersion: 'projection-v1-mlb-sp-disp-wx-park',
  scoring: 'poisson',
  /*
   * Baseball scores in bursts, and plain Poisson cannot represent that: the
   * measured variance-to-mean ratio is 2.27 where the distribution assumes 1.
   * Fitted at 2.3 against two held-out seasons — see the note above.
   */
  scoreDispersion: 2.3,
  /*
   * Temperature, measured — not wind, which §4.5 proposed and the data
   * rejected.
   *
   * Across 3,645 open-air fixtures, wind speed correlated with the total at
   * -0.022 (t = -1.33) and precipitation at -0.023 (t = -1.41): both
   * indistinguishable from nothing. On reflection neither is a surprise. Raw
   * wind speed says nothing without a direction relative to the outfield, and
   * a gust blowing in cancels one blowing out. Baseball does not play through
   * meaningful rain, it waits.
   *
   * Temperature correlated at +0.084 (t = 5.08) and survived every confound:
   * +0.061 within a month, +0.078 within a venue, +0.063 within both at once.
   * So it is neither the calendar nor a park effect. Warm air is thinner and
   * the ball carries.
   *
   * The raw slope is 0.0596 runs per degree. 0.045 is used instead, because
   * the confound-controlled relationship is about three quarters of the raw
   * one and fitting the raw slope would bank a correlation partly owned by the
   * month. It also holds up better: on the held-out seasons it improves total
   * error at t = -2.65 against -2.29 for the raw slope, for a total MAE within
   * a thousandth of it.
   *
   * The cap matters as much as the slope. A modifier acting on a forecast with
   * no ceiling is a way to be confidently wrong about a fixture the model used
   * to say nothing about.
   */
  weather: { perDegreeC: 0.045, referenceC: 22.8, cap: 0.8 },
  /*
   * The ballpark, as the ratings fail to price it.
   *
   * `weight` was swept forward-chained — every fixture corrected using only
   * seasons before its own — over 7,483 held-out fixtures. Error is flat
   * across 0.25 to 0.35 and 0.3 is its nominal floor, but 0.25 is the value
   * that ships: it gives the same error to three ten-thousandths of a run
   * (-0.0109 against -0.0112), a slightly *better* per-ground bias, and a
   * materially firmer result (paired t -3.09 against -2.67). Where a curve is
   * flat, the better-established point on it is the one to stand on.
   *
   * Above 0.4 the correction overshoots and the gain collapses; at 1.0 error
   * gets worse outright. That is the direct evidence that the ratings already
   * carry most of the park and only a fraction of it is left to add — the same
   * conclusion the residual slope reached from the other direction.
   *
   * The cap binds on exactly one pairing, in either direction: Coors against
   * T-Mobile is a 4.18-run gap, which weights to 1.045 and is truncated to 1.
   * It was in place for the backtest that gated this, so the measured result is
   * the capped behaviour rather than an uncapped one bounded afterwards.
   */
  parks: { weight: 0.25, cap: 1, factors: MLB_PARK_FACTORS },
  hasDraw: false,
  supportsSpread: true,
  baselineTotal: 8.6,
  // The smallest home edge of these sports, and baseball is the noisiest:
  // single games carry little signal, which the model reflects rather than
  // hides.
  homeAdvantage: 0.2,
  /*
   * Inert for this sport, and kept only so the shape of a config does not
   * differ between scoring families. A Poisson draw takes its variance from
   * its mean, so the simulator never reads this — `model.ts` uses it in the
   * normal branch alone. Changing it changes nothing, which is worth knowing
   * before anyone tries to fit it.
   */
  scoreSd: 3,
  eloK: 6,
  marginPerHundredElo: 0.5,
  eloWeight: 0.3,
  formHalfLife: 15,
  seasonWeight: 0.7,
  minGames: 15,
  targetGames: 60,
  historyDays: 300,
  ratingPool: null,
  shortRestDays: 0,
  shortRestPenalty: 0,
};

/*
 * Checked against five archived seasons, 2022-2026, held out on 2025 and 2026.
 * Measured, and correct as it stands.
 *
 * The best-fitting config in the application, on every axis checked.
 * `baselineTotal` measured 6.28 against 6.2. The raw home margin measured
 * 0.257 against a configured 0.25. Residual bias on the held-out seasons is
 * +0.054, essentially zero. And the Poisson family genuinely fits: the
 * variance-to-mean ratio of a team's score is 0.99 where the distribution
 * assumes 1, and the model's implied width is within 5% of its own measured
 * error — against baseball's 34% gap.
 *
 * `historyDays` below 250 costs coverage (85.5% against 98.9%) for no gain in
 * error. Recorded so the check is not re-run blind.
 */
const NHL: SportModelConfig = {
  scoring: 'poisson',
  hasDraw: false,
  supportsSpread: true,
  baselineTotal: 6.2,
  homeAdvantage: 0.25,
  /*
   * Inert for this sport, and kept only so the shape of a config does not
   * differ between scoring families. A Poisson draw takes its variance from
   * its mean, so the simulator never reads this — `model.ts` uses it in the
   * normal branch alone. Changing it changes nothing, which is worth knowing
   * before anyone tries to fit it.
   */
  scoreSd: 2,
  eloK: 8,
  marginPerHundredElo: 0.45,
  eloWeight: 0.35,
  formHalfLife: 10,
  seasonWeight: 0.65,
  minGames: 10,
  targetGames: 35,
  historyDays: 330,
  ratingPool: null,
  shortRestDays: 1,
  shortRestPenalty: 0.15,
};

/*
 * Checked against five archived seasons of the whole rating pool, 2021-2025,
 * held out on 2024 and 2025 — 5,600 fixtures. Measured, and correct as it
 * stands.
 *
 * Calibrated across every competition in the pool rather than one of them,
 * because that is what `buildRatings` sees: rating Arsenal from their league
 * fixtures alone would measure a model this application does not run.
 *
 * `baselineTotal` measured 2.74 against 2.7. The raw home margin measured
 * 0.312 against a configured 0.3, and residual bias on the held-out seasons is
 * -0.021 — the closest to zero across the whole sweep, against -0.115 at 0.2,
 * -0.208 at 0.1, +0.074 at 0.4 and +0.179 at 0.5. The Poisson family fits
 * well: variance-to-mean between 1.01 and 1.15 across the member competitions,
 * and an implied width within 2% of the model's own measured error, which is
 * the closest match in the application.
 *
 * `historyDays` was the one candidate here and is declined. At 500 the pool
 * covers 91.4% of held-out fixtures against 400's 90.6%, at identical margin
 * error and a Brier difference of 0.0002 — inside noise, and bought by
 * reaching further into a previous season than any other config does. Squads
 * turn over between football seasons, which is the risk decision 5 of the v2
 * spec exists to guard, and 0.8 points of coverage is not a reason to take it.
 */
const FOOTBALL: SportModelConfig = {
  scoring: 'poisson',
  hasDraw: true,
  // A goal handicap on a 2.7-goal game is a different animal from an NFL
  // spread, and the model has no reliable way to price the half-goal lines
  // that would matter. Left out rather than guessed.
  supportsSpread: false,
  baselineTotal: 2.7,
  homeAdvantage: 0.3,
  /*
   * Inert for this sport, and kept only so the shape of a config does not
   * differ between scoring families. A Poisson draw takes its variance from
   * its mean, so the simulator never reads this — `model.ts` uses it in the
   * normal branch alone. Changing it changes nothing, which is worth knowing
   * before anyone tries to fit it.
   */
  scoreSd: 1.3,
  eloK: 20,
  marginPerHundredElo: 0.5,
  eloWeight: 0.35,
  formHalfLife: 6,
  seasonWeight: 0.6,
  minGames: 6,
  targetGames: 20,
  // A season runs August to May, so a year is needed to hold a full one.
  historyDays: 400,
  // Every football competition rates together, so European ties can draw on
  // the clubs' domestic form.
  ratingPool: 'football',
  shortRestDays: 3,
  shortRestPenalty: 0.1,
};

/**
 * Canadian football is not American football.
 *
 * Three downs instead of four, twelve players a side, a longer and wider field
 * and a deeper end zone. The game scores appreciably higher — a combined total
 * in the low fifties against the NFL's mid forties — so applying the NFL's
 * baseline would centre every projected scoreline several points low.
 *
 * The season is 18 games, one longer than the NFL's, so the sample thresholds
 * are near enough the same.
 */
const CFL: SportModelConfig = {
  ...NFL,
  baselineTotal: 52,
  scoreSd: 11,
  homeAdvantage: 1.6,
  marginPerHundredElo: 3.0,
  // A June-to-November season, so a year comfortably covers the last one.
  historyDays: 400,
};

/**
 * NCAA Football.
 *
 * Ran on the NFL's parameters until settled predictions said what that cost:
 * 14 correct from 25, against a model claiming 84%, with the projected margin
 * out by 21 points a game. Every other competition was calibrated; this one
 * alone dragged the headline figure down seven points.
 *
 * College football is not professional football played by students. Fitted
 * against 2,021 completed games across two seasons, replayed so that no
 * projection could see its own result:
 *
 *   baselineTotal   44 -> 53.6   measured. The real mean total is 53.59, so
 *                                the NFL's baseline centred every projected
 *                                scoreline nine points low.
 *   homeAdvantage   1.8 -> 4     fitted. Drives the residual bias from +2.85
 *                                to -0.28 across a season. The raw home margin
 *                                is 9.3 points, but the ratings already carry
 *                                most of that; 4 is what is left over, and
 *                                setting it to the raw figure would double-count.
 *   scoreSd         10 -> 11.6   read off the residuals rather than searched.
 *                                A margin SD of 14.1 against a real error
 *                                spread of 16.5 is a model that believes itself
 *                                more than the evidence allows — which is
 *                                precisely how a handicap it should price at
 *                                60% goes out at 84%.
 *
 * After fitting, the model's stated width is 16.40 against a measured 16.17.
 * It now knows how wrong it usually is.
 */
const NCAAF: SportModelConfig = {
  ...NFL,
  baselineTotal: 53.6,
  homeAdvantage: 4,
  scoreSd: 11.6,
  /*
   * The change that matters most, and the least obvious one.
   *
   * The NFL's 400 days reaches back through a whole previous season, which is
   * reasonable where a roster mostly persists. College rosters turn over, and
   * the model was treating last year's team as if it were this year's: at week
   * one it reported data quality 0.85 while missing the margin by 21 points.
   * Nothing downstream could filter that, because 0.85 clears every risk
   * profile comfortably.
   *
   * At 300 days a September fixture reaches back only into the tail of the
   * previous season, so a team with no games this year has too little history
   * to project and the fixture is skipped — which is the honest answer, and the
   * one this application gives everywhere else.
   *
   * It costs less than it looks. Replayed across the 2025 season, mid-season
   * coverage falls from 506 games to 423 with the margin error unchanged
   * (12.91 to 12.95), while the opening fortnight goes from 50 confident and
   * wrong projections to none.
   */
  historyDays: 300,
  /*
   * The sample this competition's own window can actually deliver.
   *
   * `targetGames` is where a side stops gaining data quality for playing more,
   * and the NFL's 12 was inherited without asking whether a 300-day window ever
   * reaches it. It does not until December: a college team holds four in-window
   * games in September, six in October and ten in November, because the
   * window's tail is bowl season rather than a full previous campaign.
   *
   * The effect was a competition that went dark for a third of its season. At
   * 12, quality tops out at 0.375 for a side with six games and 0.25 for one
   * with four — and 0.35 is the floor below which nothing is projected at all.
   * Replayed across 2025, that is 485 of 958 fixtures projected, with the first
   * five weekends producing nothing.
   *
   * Eight is the sample the window holds from late October onward, and the
   * fixtures it unlocks measure no worse than the ones already shipping.
   * Stratified by the weaker side's history over the same replay:
   *
   *   history   n     winner   Brier   margin error
   *   4 games   154   72.7%    0.185   14.7
   *   5 games   123   62.6%    0.228   14.2
   *   12+       55    65.5%    0.216   12.0
   *
   * So a projection resting on four games is not the weak one — it is a little
   * wider on the margin and no worse on the outcome. Coverage goes from 485 to
   * 761 of 958. Lower than eight was measured too and rejected: at six, a side
   * with six games reads "High" quality, which overstates what six college
   * games are worth however the fixtures happen to land.
   */
  targetGames: 8,
};

/**
 * The European competitions.
 *
 * Short summer seasons — a handful of games a team — and far less history than
 * any other competition here. The thresholds are correspondingly cautious:
 * `minGames` is the same as the NFL's but `targetGames` is much lower, so a
 * team reaches full rating trust on the sample the competition actually
 * provides rather than never reaching it at all.
 *
 * Scoring is closer to the NFL's than the CFL's, but is genuinely unverified —
 * see docs/data-providers.md. These sit on the baseline until settled
 * predictions say otherwise.
 */
const EURO_AMERICAN: SportModelConfig = {
  ...NFL,
  baselineTotal: 46,
  minGames: 4,
  targetGames: 8,
  formHalfLife: 3,
  historyDays: 400,
};

/**
 * Tennis has no configuration because it has no data.
 *
 * The shared SportId type still contains `tennis`, but the league catalogue
 * holds no tennis competition, so there are no fixtures, no results and no
 * ratings to build one from. A model here would have nothing to run on.
 */
const CONFIGS: Partial<Record<ConcreteSportId, SportModelConfig>> = {
  nfl: NFL,
  nba: NBA,
  mlb: MLB,
  nhl: NHL,
  football: FOOTBALL,
};

/**
 * Competitions whose model differs from their sport's default.
 *
 * Keyed by league id, checked before the sport. Several competitions share a
 * sport id — the CFL, the NFL and NCAA football are all `nfl` — and they do not
 * all score alike.
 */
const LEAGUE_CONFIGS: Record<string, SportModelConfig> = {
  ncaaf: NCAAF,
  cfl: CFL,
  afle: EURO_AMERICAN,
  efa: EURO_AMERICAN,
};

export function modelConfigFor(sport: ConcreteSportId): SportModelConfig | null {
  return CONFIGS[sport] ?? null;
}

/**
 * The model for a competition.
 *
 * Prefers a league-specific configuration, falling back to the sport's. Callers
 * that hold a league should use this; `modelConfigFor` remains for the places
 * that only know a sport.
 */
export function modelConfigForLeague(
  leagueId: string,
  sport: ConcreteSportId,
): SportModelConfig | null {
  return LEAGUE_CONFIGS[leagueId] ?? modelConfigFor(sport);
}

export function isSupportedSport(sport: ConcreteSportId): boolean {
  return modelConfigFor(sport) !== null;
}

// ---------------------------------------------------------------------------
// Risk profiles
// ---------------------------------------------------------------------------

export interface RiskProfile {
  /** Individual selection probability a candidate must fall within. */
  minProbability: number;
  maxProbability: number;
  /** Default number of legs; the reader may override. */
  defaultLegs: number;
  /** A candidate below this data quality is never used at this risk level. */
  minDataQuality: number;
  /** A candidate below this confidence is never used at this risk level. */
  minConfidence: number;
  /** Selection types permitted, most conservative first. */
  allowedTypes: readonly string[];
}

/**
 * Risk thresholds.
 *
 * Relative analytical categories, not promises. "Low risk" means the model
 * found high-probability, low-variance selections it can stand behind — it does
 * not mean the outcome is safe, and nothing in this system says otherwise.
 *
 * The upper bound on Low is deliberate: a 97% selection usually means the model
 * has a thin sample and an extreme rating gap, which is a data problem wearing
 * a confident face.
 */
export const RISK_PROFILES: Record<'low' | 'medium' | 'high', RiskProfile> = {
  low: {
    minProbability: 0.7,
    maxProbability: 0.95,
    defaultLegs: 3,
    minDataQuality: 0.6,
    minConfidence: 0.6,
    /*
     * Conservative shapes only: a generous handicap, a double chance, a low
     * team-total threshold — and in motorsport, a strong driver to finish in
     * the points or to beat one particular rival.
     *
     * The probability band does the real work of separating the levels. A
     * points finish for a leading driver clears 80%; a podium sits around
     * 60% and lands in Medium; a race win is nearer 30% and clears none of
     * them, which is the honest answer rather than a forced inclusion.
     */
    allowedTypes: [
      'double_chance',
      'spread',
      'team_total',
      'winner',
      'total',
      'both_teams_to_score',
      'finish_position',
      'head_to_head',
    ],
  },
  medium: {
    minProbability: 0.58,
    maxProbability: 0.78,
    defaultLegs: 4,
    minDataQuality: 0.5,
    minConfidence: 0.5,
    allowedTypes: [
      'winner',
      'spread',
      'total',
      'team_total',
      'double_chance',
      'both_teams_to_score',
      'finish_position',
      'head_to_head',
    ],
  },
  high: {
    minProbability: 0.45,
    maxProbability: 0.66,
    defaultLegs: 5,
    minDataQuality: 0.45,
    minConfidence: 0.45,
    allowedTypes: [
      'winner',
      'spread',
      'total',
      'team_total',
      'both_teams_to_score',
      'finish_position',
      'head_to_head',
    ],
  },
};

export const MIN_LEGS = 2;
export const MAX_LEGS = 6;
