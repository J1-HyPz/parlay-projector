/**
 * Turning a bout estimate into a projection, and a projection into selections.
 *
 * The counterpart to `project.ts` for a fight or a tennis match — the same
 * relationship `race-selections.ts` has to motorsport. `bout-model.ts` answers
 * the one question its engine can answer, "how likely is the first-listed
 * competitor to win", as a bare number with the ratings behind it. This module
 * dresses that number in what a reader needs — names, records, evidence, a
 * model version — and turns it into `Selection`s, so a fight leg travels
 * through the optimiser, the store, settlement and the accuracy figures like
 * every other leg.
 *
 * **One market, and only one.** The winner. The price source also quotes a
 * game handicap and a total-games line on tennis, and sometimes a round total
 * on a fight; the model prices none of them, and a quote the model cannot put
 * a probability against is not turned into a selection. A market this
 * application offers is one it has an opinion on.
 *
 * **Both sides are produced where a book quotes both**, exactly as the scoring
 * model does: the model's job is to say which of the available bets it likes,
 * not to be shown only the one it already agrees with. Where nothing is quoted
 * it derives the favoured side alone and labels it as unverified.
 *
 * Pure.
 */

import { boundProbability, clamp } from './math.ts';
import { backingFor, orientFactors } from './factors.ts';
import type { ProjectionFactor } from './factors.ts';
import { projectBout } from './bout-model.ts';
import type { BoutEstimate, BoutModelConfig, BoutRatings, FighterRating } from './bout-model.ts';
import { edgeFor, marketContextFor, selectionScore } from './project.ts';
import { probabilityLabel, whatNeedsToHappen } from '../markets/explain.ts';
import type { FixtureNames } from '../markets/explain.ts';
import { quoteIsFresh } from '../markets/types.ts';
import type { GameMarkets, QuotedMarket } from '../markets/types.ts';
import { sidesOf } from '../home/types.ts';
import type { Game } from '../home/types';
import type { BoutProjection, BoutRecord, Selection } from './types.ts';

export interface BoutProjectOptions {
  now?: Date;
}

export interface BoutOutcome {
  projection: BoutProjection;
  estimate: BoutEstimate;
}

/** A winner rule on one of the two sides — the only rule this module makes. */
type WinnerRule = { kind: 'winner'; side: 'home' | 'away' };

const DAY_MS = 86_400_000;
/** Past this gap the stronger side is worth naming; below it the contest is close. */
const NOTABLE_EDGE = 25;
/** A competitor idle this long gets a stated caution, not a discounted number. */
const LAYOFF_DAYS = 365;

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/**
 * How reliable the estimate is, 0..1.
 *
 * The team model's own formula, with the one term that has no counterpart
 * here filled by that model's own default. `estimateConfidence` weights data
 * quality, sample, scoring steadiness and the balance between the two records
 * at 0.35, 0.35, 0.2 and 0.1. For a bout the sample *is* the data quality —
 * both are the thinner record against the target — so those two terms
 * collapse into 0.7 of it. Steadiness measures how erratically a side scores,
 * and a contest with no score has no such thing; the team model uses 0.7 when
 * a side's variability is unknown, and that is what is used here rather than
 * a number chosen to make fights look more or less certain than football.
 *
 * Nothing here was fitted, and nothing here changes a probability. Confidence
 * decides which risk level a selection may appear at and how it ranks; the
 * calibration the backtest measured is the calibration the reader gets.
 */
export function boutConfidence(estimate: BoutEstimate): number {
  const { home, away } = estimate.ratings;
  const balance = clamp(
    Math.min(home.fights, away.fights) / Math.max(home.fights, away.fights, 1),
    0.4,
    1,
  );
  return clamp(0.7 * estimate.dataQuality + 0.2 * 0.7 + 0.1 * balance, 0, 0.95);
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

function recordOf(rating: FighterRating): BoutRecord {
  return {
    contests: rating.fights,
    wins: rating.wins,
    losses: rating.losses,
    draws: rating.draws,
    rating: Math.round(rating.elo),
    last_contest: rating.lastFought === null ? null : new Date(rating.lastFought).toISOString(),
    recent_form: [...rating.recentForm],
  };
}

function formText(form: readonly ('W' | 'D' | 'L')[]): string {
  return form.length > 0 ? form.join('') : 'no recent results';
}

function monthsSince(instant: number, now: number): number {
  return Math.floor((now - instant) / (30.44 * DAY_MS));
}

/**
 * What the estimate rests on, stated for both sides.
 *
 * Written the same way the scoring model's evidence is: each factor says what
 * it says and about whom, and which way it counts is decided per selection in
 * `factors.ts`. `direction` is relative to the model's own favoured side, for
 * the game page, which shows a projection rather than a selection.
 */
function buildFactors(
  estimate: BoutEstimate,
  names: { home: string; away: string },
  division: string | null,
  config: BoutModelConfig,
  now: number,
): ProjectionFactor[] {
  const factors: ProjectionFactor[] = [];
  const { contest, contests } = config.nouns;
  const favourite = estimate.home >= 0.5 ? names.home : names.away;
  const toward = (name: string, favourable: boolean): 'positive' | 'negative' =>
    (name === favourite) === favourable ? 'positive' : 'negative';

  const sides = [
    { name: names.home, rating: estimate.ratings.home, divisions: estimate.divisions.home },
    { name: names.away, rating: estimate.ratings.away, divisions: estimate.divisions.away },
  ] as const;

  // --- the gap, or the lack of one ---------------------------------------
  const gap = Math.abs(estimate.edge);
  if (gap > NOTABLE_EDGE) {
    const stronger = estimate.edge > 0 ? names.home : names.away;
    const weaker = estimate.edge > 0 ? names.away : names.home;
    factors.push({
      text: `${stronger} holds a ${Math.round(gap)}-point rating edge over ${weaker}${
        division ? ` at ${division}` : ''
      }.`,
      subject: { kind: 'team', team: stronger, favourable: true },
      direction: toward(stronger, true),
    });
  } else {
    factors.push({
      text: `The ratings separate these two by only ${Math.round(gap)} points, so the model projects a close ${contest}.`,
      subject: { kind: 'uncertainty' },
      direction: 'negative',
    });
  }

  // --- records, both sides -----------------------------------------------
  for (const side of sides) {
    const { wins, losses, draws, fights, recentForm } = side.rating;
    const good = wins > losses;
    factors.push({
      text: `${side.name} is ${wins}-${losses}${draws > 0 ? `-${draws}` : ''} across ${fights} ${
        fights === 1 ? contest : contests
      } in the window (${formText(recentForm)}, newest first).`,
      subject: { kind: 'team', team: side.name, favourable: good },
      direction: toward(side.name, good),
    });
  }

  // --- layoff ------------------------------------------------------------
  for (const side of sides) {
    const last = side.rating.lastFought;
    if (last === null || now - last < LAYOFF_DAYS * DAY_MS) continue;
    factors.push({
      text: `${side.name} has not ${config.nouns.contest === 'fight' ? 'fought' : 'played'} in ${monthsSince(
        last,
        now,
      )} months. The projection does not adjust for the layoff.`,
      subject: { kind: 'team', team: side.name, favourable: false },
      direction: toward(side.name, false),
    });
  }

  // --- a move between divisions ------------------------------------------
  for (const side of sides) {
    if (side.divisions <= 1) continue;
    factors.push({
      text: `${side.name} has competed in more than one division; only results${
        division ? ` at ${division}` : ' at this weight'
      } count here.`,
      subject: { kind: 'uncertainty' },
      direction: 'negative',
    });
  }

  // --- how thin the thinner record is ------------------------------------
  const weakest = Math.min(estimate.ratings.home.fights, estimate.ratings.away.fights);
  if (weakest < config.targetFights / 2) {
    factors.push({
      text: `Only ${weakest} completed ${weakest === 1 ? contest : contests} of history for the thinner record, so the estimate is provisional.`,
      subject: { kind: 'uncertainty' },
      direction: 'negative',
    });
  }

  return factors;
}

/** Why the data quality is what it is, in words. */
function qualityReasons(
  estimate: BoutEstimate,
  division: string | null,
  config: BoutModelConfig,
): string[] {
  const { contest, contests, competitor } = config.nouns;
  const years = Math.round(config.historyDays / 365);
  const reasons = [
    `Rated from ${estimate.ratings.home.fights} and ${estimate.ratings.away.fights} completed ${contests} inside a ${years}-year window${
      division ? ` at ${division}` : ''
    }.`,
  ];

  if (estimate.movedDivision) {
    reasons.push(
      `A ${competitor} who has competed in more than one division is rated at this one only, and starts it as a newcomer would.`,
    );
  }

  if (config.nouns.contest === 'fight') {
    reasons.push('Method of victory is not modelled; a decision and a finish count the same.');
  } else {
    reasons.push(
      'No playing surface is published for this competition, so hard, clay and grass results are rated together.',
    );
  }

  reasons.push(
    `No form, fitness or availability data exists for a ${contest}; the rating is the record alone.`,
  );

  return reasons;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * Project one contest, or return null when the model has nothing to say.
 *
 * Null is the honest answer for most of a fight card and a good share of a
 * qualifying draw — see `minFights` in `bout-model.ts`. "Projection
 * unavailable" is a better output than a percentage with nothing behind it.
 */
export function projectContest(
  game: Game,
  ratings: BoutRatings,
  config: BoutModelConfig,
  options: BoutProjectOptions = {},
): BoutOutcome | null {
  const kickoff = game.start_time ? Date.parse(game.start_time) : Number.NaN;
  if (!Number.isFinite(kickoff)) return null;

  const sides = sidesOf(game);
  if (!sides || !sides.home.id || !sides.away.id) return null;

  const estimate = projectBout(sides.home.id, sides.away.id, game.division, ratings, config);
  if (!estimate) return null;

  const now = options.now ?? new Date();
  const names = { home: sides.home.name, away: sides.away.name };
  const division = game.division ?? null;

  const projection: BoutProjection = {
    game_id: game.id,
    sport: game.sport,
    league: game.league,
    start_time: game.start_time,
    home_team: names.home,
    away_team: names.away,
    event: game.title ?? null,
    division,
    round: game.round ?? null,
    outcome: { home: round(estimate.home, 4), away: round(estimate.away, 4) },
    rating_edge: Math.round(estimate.edge),
    records: { home: recordOf(estimate.ratings.home), away: recordOf(estimate.ratings.away) },
    moved_division: estimate.movedDivision,
    confidence: round(boutConfidence(estimate), 3),
    data_quality: round(estimate.dataQuality, 3),
    quality_reasons: qualityReasons(estimate, division, config),
    factors: buildFactors(estimate, names, division, config, now.getTime()),
    model_version: config.modelVersion,
    generated_at: now.toISOString(),
  };

  return { projection, estimate };
}

// ---------------------------------------------------------------------------
// Selections
// ---------------------------------------------------------------------------

function makeSelection(
  game: Game,
  projection: BoutProjection,
  names: FixtureNames,
  rule: WinnerRule,
  quotes: GameMarkets | null,
  quote: QuotedMarket | null,
  now: number,
): Selection {
  const market = marketContextFor(rule, names, quotes, quote, now);
  const probability = round(
    boundProbability(rule.side === 'home' ? projection.outcome.home : projection.outcome.away),
    4,
  );
  const verified = market.availability === 'verified';

  return {
    // The same identity scheme as every other selection: the bet, not the
    // presentation, so a republished fight keeps its id.
    id: `${game.id}:winner:${market.selection}`,
    game_id: game.id,
    sport: game.sport,
    league: game.league,
    start_time: game.start_time,
    // First-listed first. A fight card and a draw are read in that order, and
    // there is no home side to put second.
    fixture: `${projection.home_team} v ${projection.away_team}`,

    type: 'winner',
    label: market.selection,
    market,
    explanation: whatNeedsToHappen(rule, names),
    probability_label: probabilityLabel(market.type),

    probability,
    edge: edgeFor(probability, market),
    confidence: projection.confidence,
    data_quality: projection.data_quality,
    score: selectionScore(probability, projection.confidence, projection.data_quality, verified),

    // One group per contest. Two selections on one fight are the two sides of
    // the same coin, and the optimiser takes at most one.
    correlation_group: game.id,
    settlement: rule,
    reasoning: orientFactors(
      projection.factors,
      backingFor(rule, { home: projection.home_team, away: projection.away_team }),
    ),
    bout: projection,
  };
}

/**
 * Every selection for one contest.
 *
 * Quoted winner prices first, both sides; the model's favoured side alone
 * when no book has quoted the winner. Nothing else, because the model prices
 * nothing else.
 */
export function boutSelections(
  game: Game,
  outcome: BoutOutcome,
  quotes: GameMarkets | null = null,
  now: number = Date.now(),
): Selection[] {
  // A stale block is treated as no block at all, exactly as the scoring
  // model treats one: better an unverified selection than an old price.
  const usable = quotes && quoteIsFresh(quotes.fetchedAt, now) ? quotes : null;
  const { projection } = outcome;
  const names: FixtureNames = {
    homeTeam: projection.home_team,
    awayTeam: projection.away_team,
    sport: game.sport,
  };

  const selections: Selection[] = [];
  const seen = new Set<string>();
  const add = (rule: WinnerRule, quote: QuotedMarket | null) => {
    const selection = makeSelection(game, projection, names, rule, usable, quote, now);
    if (seen.has(selection.id)) return;
    seen.add(selection.id);
    selections.push(selection);
  };

  let winnerQuoted = false;
  for (const quote of usable?.markets ?? []) {
    if (quote.settlement.kind !== 'winner') continue;
    // A drawn fight is a real outcome and some books price it. The model has
    // no draw probability, so it has no opinion to attach to that quote.
    if (quote.settlement.side === 'draw') continue;
    winnerQuoted = true;
    add({ kind: 'winner', side: quote.settlement.side }, quote);
  }

  if (!winnerQuoted) {
    add({ kind: 'winner', side: projection.outcome.home >= 0.5 ? 'home' : 'away' }, null);
  }

  return selections;
}
