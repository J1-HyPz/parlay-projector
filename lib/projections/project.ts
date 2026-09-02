/**
 * Turning ratings into a projection, and a projection into candidate selections.
 *
 * Pure. Everything here is a function of the ratings and the fixture, so a
 * projection can be reproduced exactly from its inputs — which is what makes
 * the backtest meaningful.
 */

import { boundProbability, clamp, seedFrom } from './math.ts';
import { dataQuality, estimateConfidence } from './features.ts';
import type { RatingSet, TeamRating } from './features.ts';
import {
  expectedScores,
  modelSpread,
  outcomeProbabilities,
  simulate,
  spreadProbability,
  teamTotalProbability,
  totalProbability,
} from './model.ts';
import type { Distribution, ExpectedScores } from './model.ts';
import { MIN_DATA_QUALITY, MODEL_VERSION } from './types.ts';
import type {
  GameProjection,
  ProjectionFactor,
  Selection,
  SelectionType,
  SettlementRule,
} from './types.ts';
import type { SportModelConfig } from './config.ts';
import type { Game } from '../home/types';

export interface ProjectOptions {
  simulations: number;
  /** Fixed in tests; derived from the game id otherwise. */
  seed?: number;
  hasStandings?: boolean;
  hasHeadToHead?: boolean;
  now?: Date;
}

export interface ProjectionOutcome {
  projection: GameProjection;
  distribution: Distribution;
  expected: ExpectedScores;
}

function formResult(form: readonly ('W' | 'D' | 'L')[]): string {
  return form.length > 0 ? form.join('') : 'no recent results';
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Explanations, drawn from the values that actually moved the projection.
 *
 * Both directions, always: a one-sided case reads like advocacy rather than
 * analysis, and the risk factors are the part a reader most needs.
 */
function buildFactors(
  home: TeamRating,
  away: TeamRating,
  expected: ExpectedScores,
  set: RatingSet,
  config: SportModelConfig,
  distribution: Distribution,
): ProjectionFactor[] {
  const factors: ProjectionFactor[] = [];
  const favourite = distribution.meanMargin >= 0 ? home : away;
  const underdog = distribution.meanMargin >= 0 ? away : home;

  factors.push({
    direction: 'positive',
    text: `${favourite.team} average ${round(favourite.adjustedAttack)} scored and ${round(
      favourite.adjustedDefence,
    )} conceded per game, opponent-adjusted, against a league average of ${round(
      set.leagueAverage,
    )}.`,
  });

  const eloGap = Math.abs(expected.eloEdge);
  if (eloGap > 25) {
    factors.push({
      direction: 'positive',
      text: `${expected.eloEdge > 0 ? home.team : away.team} hold a ${Math.round(
        eloGap,
      )}-point rating edge over ${expected.eloEdge > 0 ? away.team : home.team}.`,
    });
  }

  if (favourite.recentForm.length >= 3) {
    factors.push({
      direction: 'positive',
      text: `${favourite.team} recent form: ${formResult(favourite.recentForm)} (newest first).`,
    });
  }

  if (expected.shortRested) {
    const side = expected.shortRested === 'home' ? home : away;
    const rest = expected.shortRested === 'home' ? expected.homeRest : expected.awayRest;
    factors.push({
      direction: 'negative',
      text: `${side.team} are on ${rest === 0 ? 'no' : rest} day${rest === 1 ? '' : 's'} rest, a short turnaround for this sport.`,
    });
  }

  // The case against, stated plainly.
  if (underdog.recentForm.filter((r) => r === 'W').length >= 3) {
    factors.push({
      direction: 'negative',
      text: `${underdog.team} have won ${underdog.recentForm.filter((r) => r === 'W').length} of their last ${underdog.recentForm.length}.`,
    });
  }

  if (underdog.adjustedAttack > favourite.adjustedAttack) {
    factors.push({
      direction: 'negative',
      text: `${underdog.team} actually score more per game (${round(
        underdog.adjustedAttack,
      )} against ${round(favourite.adjustedAttack)}); the projection rests on defence.`,
    });
  }

  const weakest = Math.min(home.games, away.games);
  if (weakest < config.targetGames / 2) {
    factors.push({
      direction: 'negative',
      text: `Only ${weakest} completed games of history for the thinner side, so the estimate is provisional.`,
    });
  }

  return factors;
}

/**
 * Project one fixture.
 *
 * Returns null rather than a weak answer when there is not enough to work with.
 * "Projection unavailable" is a better output than a fabricated percentage.
 */
export function projectGame(
  game: Game,
  set: RatingSet,
  config: SportModelConfig,
  options: ProjectOptions,
): ProjectionOutcome | null {
  const kickoff = game.start_time ? Date.parse(game.start_time) : Number.NaN;
  if (!Number.isFinite(kickoff)) return null;

  const home = set.ratings.get(game.home_team.name);
  const away = set.ratings.get(game.away_team.name);
  if (!home || !away) return null;

  const quality = dataQuality(home, away, config, {
    hasStandings: options.hasStandings ?? false,
    hasHeadToHead: options.hasHeadToHead ?? false,
  });
  if (quality < MIN_DATA_QUALITY) return null;

  const expected = expectedScores(
    game.home_team.name,
    game.away_team.name,
    set,
    config,
    kickoff,
  );
  if (!expected) return null;

  const distribution = simulate(expected, config, {
    simulations: options.simulations,
    // Seeded from the game id, so the same fixture reproduces the same
    // projection rather than wobbling between page loads.
    seed: options.seed ?? seedFrom(game.id),
  });

  const confidence = estimateConfidence(home, away, quality, config);

  const projection: GameProjection = {
    game_id: game.id,
    sport: game.sport,
    league: game.league,
    start_time: game.start_time,
    home_team: game.home_team.name,
    away_team: game.away_team.name,
    outcome: outcomeProbabilities(distribution, config.hasDraw),
    expected_home_score: round(distribution.meanHome, 2),
    expected_away_score: round(distribution.meanAway, 2),
    expected_margin: round(distribution.meanMargin, 2),
    expected_total: round(distribution.meanTotal, 2),
    model_spread: modelSpread(distribution),
    confidence: round(confidence, 3),
    data_quality: round(quality, 3),
    model_version: MODEL_VERSION,
    factors: buildFactors(home, away, expected, set, config, distribution),
    generated_at: (options.now ?? new Date()).toISOString(),
  };

  return { projection, distribution, expected };
}

// ---------------------------------------------------------------------------
// Candidate selections
// ---------------------------------------------------------------------------

/**
 * Selection quality.
 *
 * Probability alone is a poor ranking: an 85% call from six games of history is
 * worse than a 72% one from a full season. Multiplying by confidence and data
 * quality expresses that directly, and keeps the ordering interpretable —
 * unlike a weighted sum, where a high probability can mask everything else.
 */
export function selectionScore(
  probability: number,
  confidence: number,
  quality: number,
): number {
  return round(probability * confidence * quality, 4);
}

/** Half-point lines, so a selection can never end in a push. */
function halfLine(value: number): number {
  return Math.round(value * 2) / 2 + (Math.round(value * 2) % 2 === 0 ? 0.5 : 0);
}

function makeSelection(
  game: Game,
  outcome: ProjectionOutcome,
  type: SelectionType,
  label: string,
  probability: number,
  settlement: SettlementRule,
  extra: ProjectionFactor[] = [],
): Selection {
  const { projection } = outcome;
  return {
    id: `${game.id}:${type}:${label}`,
    game_id: game.id,
    sport: game.sport,
    league: game.league,
    start_time: game.start_time,
    fixture: `${game.away_team.name} v ${game.home_team.name}`,
    type,
    label,
    probability: round(boundProbability(probability), 4),
    confidence: projection.confidence,
    data_quality: projection.data_quality,
    score: selectionScore(probability, projection.confidence, projection.data_quality),
    // One group per game: the optimiser uses this to take at most one
    // selection from any fixture, which is what keeps the legs independent.
    correlation_group: game.id,
    settlement,
    factors: [...projection.factors, ...extra],
    projection,
  };
}

/**
 * Every model-backed selection for one fixture.
 *
 * Lines are read off the model's own distribution rather than picked because
 * they look familiar: the spread comes from the simulated margin quantiles, the
 * total from the simulated totals. A line nobody modelled is a line nobody can
 * justify.
 *
 * The optimiser chooses among these; not all are used.
 */
export function candidateSelections(
  game: Game,
  outcome: ProjectionOutcome,
  config: SportModelConfig,
): Selection[] {
  const { projection, distribution } = outcome;
  const selections: Selection[] = [];

  const homeName = game.home_team.name;
  const awayName = game.away_team.name;
  const favouredHome = projection.expected_margin >= 0;
  const favourite = favouredHome ? homeName : awayName;
  const side: 'home' | 'away' = favouredHome ? 'home' : 'away';

  // --- winner -------------------------------------------------------------
  const winnerProbability = favouredHome ? projection.outcome.home : projection.outcome.away;
  selections.push(
    makeSelection(
      game,
      outcome,
      'winner',
      `${favourite} to win`,
      winnerProbability,
      { kind: 'winner', side },
    ),
  );

  // --- double chance, football only ---------------------------------------
  if (config.hasDraw && projection.outcome.draw !== undefined) {
    const drawProbability = projection.outcome.draw;
    selections.push(
      makeSelection(
        game,
        outcome,
        'double_chance',
        `${favourite} or draw`,
        winnerProbability + drawProbability,
        { kind: 'double_chance', sides: [side, 'draw'] },
      ),
    );
  }

  // --- spread -------------------------------------------------------------
  if (config.supportsSpread) {
    /*
     * Two lines, from the simulated margin distribution:
     *
     *   a conservative handicap for the underdog, taken from the lower tail so
     *   it clears in roughly four of five simulations; and
     *   the model's own line, which by construction sits near a coin flip.
     */
    const sorted = distribution.margins;
    const quantile = (q: number) => sorted[clamp(Math.floor(q * sorted.length), 0, sorted.length - 1)];

    // Underdog +points: the margin the favourite fails to exceed 80% of the time.
    const generous = halfLine(Math.abs(quantile(favouredHome ? 0.8 : 0.2)));
    const underdog = favouredHome ? awayName : homeName;
    const underdogSide: 'home' | 'away' = favouredHome ? 'away' : 'home';

    selections.push(
      makeSelection(
        game,
        outcome,
        'spread',
        `${underdog} +${generous}`,
        spreadProbability(distribution, underdogSide, generous),
        { kind: 'spread', side: underdogSide, line: generous },
      ),
    );

    const modelLine = halfLine(Math.abs(projection.expected_margin));
    if (modelLine > 0.5) {
      selections.push(
        makeSelection(
          game,
          outcome,
          'spread',
          `${favourite} -${modelLine}`,
          spreadProbability(distribution, side, -modelLine),
          { kind: 'spread', side, line: -modelLine },
        ),
      );
    }
  }

  // --- totals -------------------------------------------------------------
  const totals = distribution.totals;
  const totalAt = (q: number) => totals[clamp(Math.floor(q * totals.length), 0, totals.length - 1)];

  // A line in the lower tail: clears in most simulations, so it is a
  // conservative shape rather than a coin flip on the model's own centre.
  const safeOver = halfLine(totalAt(0.2));
  selections.push(
    makeSelection(
      game,
      outcome,
      'total',
      `Over ${safeOver} total ${config.scoring === 'poisson' ? 'goals' : 'points'}`,
      totalProbability(distribution, 'over', safeOver),
      { kind: 'total', direction: 'over', line: safeOver },
    ),
  );

  const centralTotal = halfLine(distribution.meanTotal);
  selections.push(
    makeSelection(
      game,
      outcome,
      'total',
      `Under ${halfLine(totalAt(0.8))} total ${config.scoring === 'poisson' ? 'goals' : 'points'}`,
      totalProbability(distribution, 'under', halfLine(totalAt(0.8))),
      { kind: 'total', direction: 'under', line: halfLine(totalAt(0.8)) },
    ),
  );
  void centralTotal;

  // --- team totals --------------------------------------------------------
  for (const team of ['home', 'away'] as const) {
    const scores = team === 'home' ? distribution.homeScores : distribution.awayScores;
    const name = team === 'home' ? homeName : awayName;
    const sorted = [...scores].sort((a, b) => a - b);
    const line = halfLine(sorted[Math.floor(0.2 * sorted.length)]);

    selections.push(
      makeSelection(
        game,
        outcome,
        'team_total',
        config.scoring === 'poisson' && line < 1
          ? `${name} to score`
          : `${name} over ${line} ${config.scoring === 'poisson' ? 'goals' : 'points'}`,
        teamTotalProbability(distribution, team, 'over', line),
        { kind: 'team_total', side: team, direction: 'over', line },
      ),
    );
  }

  /*
   * Player performance selections are not generated.
   *
   * The application's roster data carries no statistics — name, jersey,
   * position, height, weight, age — and there is no injury, lineup or expected
   * starter feed. A player projection needs a usage estimate and a credible
   * expectation that the player features; neither is available, so producing
   * one would be invention rather than modelling.
   */

  return selections;
}
