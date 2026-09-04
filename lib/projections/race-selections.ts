/**
 * Turning a race projection into candidate selections.
 *
 * The motorsport counterpart to `candidateSelections`. Same contract, same
 * `Selection` shape, so a race leg travels through the optimiser, the store,
 * settlement and the accuracy figures exactly like every other leg — which is
 * the whole point of doing it this way rather than building a second engine
 * beside the first.
 *
 * Every market comes off one set of simulated finishing orders, so they cannot
 * contradict one another: a driver's podium probability is necessarily at least
 * their win probability because the same simulations produced both.
 *
 * No prices exist. The data feed carries no motorsport markets at all, so every
 * selection here is `model_only` — analysis, clearly labelled, never presented
 * as a bet anyone has confirmed is available.
 *
 * Pure.
 */

import { boundProbability } from './math.ts';
import { backingFor, orientFactors } from './factors.ts';
import {
  RACE_CONFIG,
  RACE_MODEL_VERSION,
  finishProbability,
  headToHeadProbability,
  meanPosition,
  raceDataQuality,
  raceFactors,
  raceQualityReasons,
  raceSeed,
  simulateRace,
} from './race-model.ts';
import type { RaceDistribution, RaceRatings } from './race-model.ts';
import type { RaceEntrantProjection, RaceProjection, Selection, SelectionType } from './types.ts';
import { probabilityLabel, raceMarketLabel, selectionLabel, whatNeedsToHappen } from '../markets/explain.ts';
import { FINISH_MARKETS, marketTypeOf } from '../markets/types.ts';
import type { MarketContext, SettlementRule } from '../markets/types.ts';
import type { Game } from '../home/types';

/** Below this the field is not a race worth projecting. */
const MIN_FIELD = 6;
/** Below this the ratings are too thin to say anything useful. */
export const MIN_RACE_QUALITY = 0.3;

export interface RaceProjectOptions {
  simulations: number;
  /** Grid slots by driver, where qualifying has already been run. */
  grid?: ReadonlyMap<string, number> | null;
  now?: Date;
  seed?: number;
}

export interface RaceOutcome {
  projection: RaceProjection;
  distribution: RaceDistribution;
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Project one race.
 *
 * Returns null rather than a weak answer when there is too little to work with,
 * exactly as the scoring model does. "Projection unavailable" is a better
 * output than a percentage with nothing behind it.
 */
export function projectRace(
  game: Game,
  ratings: RaceRatings,
  options: RaceProjectOptions,
): RaceOutcome | null {
  const entrants = (game.entrants ?? []).map((entrant) => entrant.name);
  if (entrants.length < MIN_FIELD) return null;

  const grid = options.grid ?? null;
  const hasGrid = grid !== null && grid.size > 0;

  const quality = raceDataQuality(entrants, ratings, hasGrid);
  if (quality < MIN_RACE_QUALITY) return null;

  const distribution = simulateRace(entrants, ratings, {
    simulations: options.simulations,
    // Seeded from the session id, so the same race reproduces the same
    // projection rather than wobbling between page loads.
    seed: options.seed ?? raceSeed(game.id),
    noise: game.session === 'Qualifying' ? RACE_CONFIG.qualifyingNoise : RACE_CONFIG.raceNoise,
    grid,
  });

  const projected: RaceEntrantProjection[] = entrants.map((driver) => ({
    driver,
    win: round(finishProbability(distribution, driver, 1)),
    podium: round(finishProbability(distribution, driver, 3)),
    top_five: round(finishProbability(distribution, driver, 5)),
    points: round(finishProbability(distribution, driver, 10)),
    mean_position: meanPosition(distribution, driver),
    grid: grid?.get(driver) ?? null,
  }));

  projected.sort((a, b) => b.win - a.win);

  /*
   * Confidence is about how much the estimate can be relied on, not how likely
   * anything is. It follows the data quality and the size of the rated field —
   * a race where half the entrants have never been seen is one the model
   * should not be confident about however decisive its numbers look.
   */
  const rated = entrants.filter((driver) => ratings.drivers.has(driver)).length;
  const confidence = round(
    Math.min(quality, 0.4 + 0.6 * (rated / Math.max(entrants.length, 1))),
    3,
  );

  const projection: RaceProjection = {
    game_id: game.id,
    event: game.title ?? game.league ?? 'Race',
    session: game.session ?? null,
    start_time: game.start_time,
    field_size: entrants.length,
    entrants: projected,
    confidence,
    data_quality: round(quality, 3),
    quality_reasons: raceQualityReasons(entrants, ratings, hasGrid),
    model_version: RACE_MODEL_VERSION,
    // Evidence for the field's strongest driver, which is what a fixture-level
    // panel shows. A selection re-derives it for whichever driver it backs.
    factors: raceFactors(projected[0].driver, ratings, distribution, projected[0].grid),
    generated_at: (options.now ?? new Date()).toISOString(),
    after_qualifying: hasGrid,
  };

  return { projection, distribution };
}

// ---------------------------------------------------------------------------
// Selections
// ---------------------------------------------------------------------------

/**
 * Ranking score, matching the two-sided engine's.
 *
 * Probability tempered by how much the model can be trusted here. No verified
 * premium is applied because no motorsport market is ever verified — there are
 * no prices to check against.
 */
function score(probability: number, confidence: number, quality: number): number {
  return round(probability * confidence * quality);
}

function marketFor(rule: SettlementRule): MarketContext {
  return {
    type: marketTypeOf(rule),
    period: 'full_game',
    label: raceMarketLabel(rule),
    selection: selectionLabel(rule, { homeTeam: '', awayTeam: '', sport: 'f1' }),
    line: rule.kind === 'finish_position' ? rule.within : null,
    // No bookmaker publishes motorsport markets on this feed, so nothing here
    // can be confirmed as available. Said plainly rather than left implied.
    availability: 'model_only',
    price: null,
    source: null,
    fetchedAt: null,
    fairProbability: null,
    margin: null,
  };
}

function selectionTypeOf(rule: SettlementRule): SelectionType {
  return rule.kind === 'head_to_head' ? 'head_to_head' : 'finish_position';
}

function makeSelection(
  game: Game,
  outcome: RaceOutcome,
  ratings: RaceRatings,
  rule: SettlementRule,
  probability: number,
  driver: string,
): Selection {
  const { projection, distribution } = outcome;
  const market = marketFor(rule);
  const bounded = boundProbability(probability);

  const entrant = projection.entrants.find((entry) => entry.driver === driver);

  return {
    id: `${game.id}:${selectionTypeOf(rule)}:${market.selection}`,
    game_id: game.id,
    sport: game.sport,
    league: game.league,
    start_time: game.start_time,
    fixture: projection.session
      ? `${projection.event} — ${projection.session}`
      : projection.event,

    type: selectionTypeOf(rule),
    label: market.selection,
    market,
    explanation: whatNeedsToHappen(rule, { homeTeam: '', awayTeam: '', sport: 'f1' }),
    probability_label: probabilityLabel(market.type),

    probability: round(bounded),
    // Nothing to disagree with: no price exists for any motorsport market.
    edge: null,
    confidence: projection.confidence,
    data_quality: projection.data_quality,
    score: score(bounded, projection.confidence, projection.data_quality),

    // One group per session, so the optimiser takes at most one leg from a
    // race. Two markets on one Grand Prix are strongly related — a driver
    // winning and the same driver on the podium are nearly the same bet.
    correlation_group: game.id,
    settlement: rule,
    reasoning: orientFactors(
      raceFactors(driver, ratings, distribution, entrant?.grid ?? null),
      backingFor(rule, { home: '', away: '' }),
    ),
    race: projection,
  };
}

/**
 * Every model-backed selection for one race.
 *
 * Finishing markets for the drivers the model rates most highly, plus a
 * head-to-head between the two closest of them — which is the market where a
 * finishing-order model has the most to say, because it turns on the gap
 * between two drivers rather than on the whole field.
 */
export function raceSelections(
  game: Game,
  outcome: RaceOutcome,
  ratings: RaceRatings,
): Selection[] {
  const { projection, distribution } = outcome;
  const selections: Selection[] = [];

  // The strongest handful. Generating a top-ten market for the slowest car on
  // the grid is arithmetically easy and of no interest to anybody.
  const contenders = projection.entrants.slice(0, 8);

  for (const entrant of contenders) {
    for (const market of FINISH_MARKETS) {
      // A market covering more places than the field has is meaningless.
      if (market.within >= projection.field_size) continue;

      const rule: SettlementRule = {
        kind: 'finish_position',
        entrant: entrant.driver,
        within: market.within,
      };
      selections.push(
        makeSelection(
          game,
          outcome,
          ratings,
          rule,
          finishProbability(distribution, entrant.driver, market.within),
          entrant.driver,
        ),
      );
    }
  }

  /*
   * Head-to-heads between adjacent contenders.
   *
   * Adjacent in the model's own ranking, so the pairing is genuinely close
   * rather than a formality — a match-up the model rates 95/5 tells a reader
   * nothing they could not already see.
   */
  for (let i = 0; i < Math.min(contenders.length - 1, 5); i += 1) {
    const driver = contenders[i].driver;
    const rival = contenders[i + 1].driver;
    const rule: SettlementRule = { kind: 'head_to_head', entrant: driver, over: rival };

    selections.push(
      makeSelection(
        game,
        outcome,
        ratings,
        rule,
        headToHeadProbability(distribution, driver, rival),
        driver,
      ),
    );
  }

  return selections;
}

/**
 * The starting grid, from a completed qualifying session.
 *
 * Returns null when qualifying has not been run. That is the look-ahead
 * guard: a projection generated before qualifying must not be handed a grid
 * that did not exist yet, and the caller decides what it can see by which
 * sessions it passes in.
 */
export function gridFrom(sessions: readonly Game[], asOf: number): Map<string, number> | null {
  const qualifying = sessions.find(
    (session) =>
      session.session === 'Qualifying' &&
      session.status === 'finished' &&
      session.start_time !== null &&
      Date.parse(session.start_time) < asOf,
  );
  if (!qualifying) return null;

  const grid = new Map<string, number>();
  for (const entrant of qualifying.entrants ?? []) {
    if (entrant.position !== null) grid.set(entrant.name, entrant.position);
  }

  return grid.size > 0 ? grid : null;
}
