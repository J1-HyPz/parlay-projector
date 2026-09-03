/**
 * Turning ratings into a projection, and a projection into candidate selections.
 *
 * Two things happen here, and keeping them apart is the point of the module.
 *
 * *Projection* is the model's view of the fixture: expected scores, a
 * distribution, outcome probabilities. It knows nothing about betting.
 *
 * *Selection* is a bet the model has an opinion on. Where a bookmaker's prices
 * are available, selections are built at **the lines that bookmaker is
 * actually offering**, and the model is run against those. Where they are not,
 * the model derives its own lines and every one of them is labelled as
 * unverified — analysis, not something anyone has confirmed can be backed.
 *
 * That distinction is the whole reason for the rewrite. The previous version
 * read a handicap off its own simulated quantiles, which routinely produced
 * lines like "+3.5" for a fixture where the only handicap on offer was 1.5. The
 * probability attached to it was perfectly sound and the bet did not exist.
 *
 * Pure. Everything is a function of the ratings, the fixture and the supplied
 * markets, so a projection can be reproduced exactly from its inputs — which is
 * what makes the backtest meaningful.
 */

import { boundProbability, clamp, seedFrom } from './math.ts';
import { dataQuality, estimateConfidence, qualityReasons } from './features.ts';
import type { RatingSet, TeamRating } from './features.ts';
import { backingFor, orientFactors } from './factors.ts';
import type { ProjectionFactor } from './factors.ts';
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
import type { EdgeAssessment, GameProjection, Selection, SelectionType } from './types.ts';
import type { SportModelConfig } from './config.ts';
import {
  marketLabel,
  probabilityLabel,
  selectionLabel,
  whatNeedsToHappen,
} from '../markets/explain.ts';
import { modelEdge } from '../markets/price.ts';
import { marketTypeOf, quoteIsFresh } from '../markets/types.ts';
import type {
  GameMarkets,
  MarketContext,
  QuotedMarket,
  SettlementRule,
} from '../markets/types.ts';
import { fairProbabilityFor } from '../odds/normalise.ts';
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

/** Value at a quantile of a set of numbers. Copies rather than sorting in place. */
function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[clamp(Math.floor(q * sorted.length), 0, sorted.length - 1)];
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * What the projection rests on, stated symmetrically.
 *
 * Deliberately produced for *both* sides rather than for whichever the model
 * favours. A selection may back either of them, and evidence written only from
 * the favourite's point of view leaves an underdog selection with nothing
 * relevant to say — which is how the previous version ended up filing a team's
 * good run of form as a risk factor on a bet backing that team.
 *
 * Each factor records what it says and about whom. Whether it counts for or
 * against is decided later, per selection, in `factors.ts`.
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
  const favouredHome = distribution.meanMargin >= 0;
  const favourite = favouredHome ? home : away;

  /** Polarity relative to the model's own favoured side, for the game page. */
  const towardFavourite = (team: TeamRating, favourable: boolean): 'positive' | 'negative' =>
    (team === favourite) === favourable ? 'positive' : 'negative';

  // --- scoring rates, both sides -----------------------------------------
  for (const team of [home, away]) {
    const strongAttack = team.adjustedAttack > set.leagueAverage;
    factors.push({
      text: `${team.team} average ${round(team.adjustedAttack)} scored and ${round(
        team.adjustedDefence,
      )} conceded per game, adjusted for opposition, against a league average of ${round(
        set.leagueAverage,
      )}.`,
      subject: {
        kind: 'team',
        team: team.team,
        favourable: strongAttack || team.adjustedDefence < set.leagueAverage,
        scoring: strongAttack ? 'high' : 'low',
      },
      direction: towardFavourite(team, strongAttack),
    });
  }

  // --- rating gap ---------------------------------------------------------
  const eloGap = Math.abs(expected.eloEdge);
  if (eloGap > 25) {
    const stronger = expected.eloEdge > 0 ? home : away;
    const weaker = expected.eloEdge > 0 ? away : home;
    factors.push({
      text: `${stronger.team} hold a ${Math.round(eloGap)}-point rating edge over ${weaker.team}.`,
      subject: { kind: 'team', team: stronger.team, favourable: true },
      direction: towardFavourite(stronger, true),
    });
  }

  // --- form, both sides ---------------------------------------------------
  for (const team of [home, away]) {
    if (team.recentForm.length < 3) continue;
    const wins = team.recentForm.filter((result) => result === 'W').length;
    // Judged against an even split, so "good form" is a claim about the record
    // rather than about which side the model happens to prefer.
    const good = wins * 2 > team.recentForm.length;
    factors.push({
      text: `${team.team} have won ${wins} of their last ${team.recentForm.length} (${formResult(
        team.recentForm,
      )}, newest first).`,
      subject: { kind: 'team', team: team.team, favourable: good },
      direction: towardFavourite(team, good),
    });
  }

  // --- rest ---------------------------------------------------------------
  if (expected.shortRested) {
    const side = expected.shortRested === 'home' ? home : away;
    const rest = expected.shortRested === 'home' ? expected.homeRest : expected.awayRest;
    factors.push({
      text: `${side.team} are on ${rest === 0 ? 'no' : rest} day${rest === 1 ? '' : 's'} rest, a short turnaround for this sport.`,
      subject: { kind: 'team', team: side.team, favourable: false },
      direction: towardFavourite(side, false),
    });
  }

  // --- how much scoring the game should contain --------------------------
  const expectedTotal = distribution.meanTotal;
  const difference = expectedTotal - config.baselineTotal;
  if (Math.abs(difference) > config.baselineTotal * 0.08) {
    const high = difference > 0;
    factors.push({
      text: `The model projects ${round(expectedTotal)} combined, ${high ? 'above' : 'below'} this competition's typical ${round(config.baselineTotal)}.`,
      subject: { kind: 'scoring', lean: high ? 'high' : 'low' },
      direction: 'positive',
    });
  }

  // --- how close the model expects it to be ------------------------------
  const margin = Math.abs(distribution.meanMargin);
  if (margin < config.baselineTotal * 0.05) {
    factors.push({
      text: `The model separates these sides by only ${round(margin)}, so it projects a close contest.`,
      subject: { kind: 'uncertainty' },
      direction: 'negative',
    });
  }

  // --- caveats about the estimate itself ---------------------------------
  const weakest = Math.min(home.games, away.games);
  if (weakest < config.targetGames / 2) {
    factors.push({
      text: `Only ${weakest} completed games of history for the thinner side, so the estimate is provisional.`,
      subject: { kind: 'uncertainty' },
      direction: 'negative',
    });
  }

  return factors;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

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

  const extras = {
    hasStandings: options.hasStandings ?? false,
    hasHeadToHead: options.hasHeadToHead ?? false,
  };

  const quality = dataQuality(home, away, config, extras);
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
    typical_score: {
      home: Math.round(quantile(distribution.homeScores, 0.5)),
      away: Math.round(quantile(distribution.awayScores, 0.5)),
    },
    likely_home_range: [
      Math.round(quantile(distribution.homeScores, 0.25)),
      Math.round(quantile(distribution.homeScores, 0.75)),
    ],
    likely_away_range: [
      Math.round(quantile(distribution.awayScores, 0.25)),
      Math.round(quantile(distribution.awayScores, 0.75)),
    ],
    quality_reasons: qualityReasons(home, away, config, extras),
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
 *
 * A selection at a line a bookmaker is genuinely offering is worth more than
 * an equally strong one at a line nobody has confirmed exists, so a verified
 * market carries a modest premium. Modest deliberately: it breaks ties in
 * favour of the placeable bet without letting availability outrank the
 * model's actual view.
 */
export function selectionScore(
  probability: number,
  confidence: number,
  quality: number,
  verified = false,
): number {
  return round(probability * confidence * quality * (verified ? 1.1 : 1), 4);
}

/** Half-point lines, so a model-derived selection can never end in a push. */
function halfLine(value: number): number {
  return Math.round(value * 2) / 2 + (Math.round(value * 2) % 2 === 0 ? 0.5 : 0);
}

/**
 * The model's probability for any settlement rule.
 *
 * One entry point for every market type, so a probability can never be read
 * from a different distribution than the one the projection published.
 */
export function probabilityFor(
  distribution: Distribution,
  projection: GameProjection,
  rule: SettlementRule,
): number {
  switch (rule.kind) {
    case 'winner':
      return rule.side === 'home'
        ? projection.outcome.home
        : rule.side === 'away'
          ? projection.outcome.away
          : (projection.outcome.draw ?? 0);

    case 'double_chance':
      return rule.sides.reduce((sum, side) => {
        if (side === 'home') return sum + projection.outcome.home;
        if (side === 'away') return sum + projection.outcome.away;
        return sum + (projection.outcome.draw ?? 0);
      }, 0);

    case 'spread':
      return spreadProbability(distribution, rule.side, rule.line);

    case 'total':
      return totalProbability(distribution, rule.direction, rule.line);

    case 'team_total':
      return teamTotalProbability(distribution, rule.side, rule.direction, rule.line);
  }
}

/** The selection type matching a settlement rule. */
function selectionTypeOf(rule: SettlementRule): SelectionType {
  switch (rule.kind) {
    case 'winner':
      return 'winner';
    case 'double_chance':
      return 'double_chance';
    case 'spread':
      return 'spread';
    case 'total':
      return 'total';
    case 'team_total':
      return 'team_total';
  }
}

interface BuildContext {
  game: Game;
  outcome: ProjectionOutcome;
  /** The bookmaker markets for this fixture, if any were available. */
  quotes: GameMarkets | null;
  now: number;
}

/**
 * Everything about the *bet* side of a selection.
 *
 * A quote only counts as verified while it is fresh. A price read half an hour
 * ago is not evidence that a market is available now, and presenting it as
 * such would be the same failure the redesign exists to fix, one step removed.
 */
function marketContextFor(
  rule: SettlementRule,
  context: BuildContext,
  quote: QuotedMarket | null,
): MarketContext {
  const { game } = context;
  const type = marketTypeOf(rule);
  const names = {
    homeTeam: game.home_team.name,
    awayTeam: game.away_team.name,
    sport: game.sport,
  };

  const base = {
    type,
    period: 'full_game' as const,
    label: marketLabel(type, game.sport),
    selection: selectionLabel(rule, names),
    line: 'line' in rule ? rule.line : null,
  };

  if (!quote || !context.quotes || !quoteIsFresh(quote.fetchedAt, context.now)) {
    return {
      ...base,
      availability: 'model_only',
      price: null,
      source: null,
      fetchedAt: null,
      fairProbability: null,
      margin: null,
    };
  }

  const fair = fairProbabilityFor(context.quotes, quote);

  return {
    ...base,
    availability: 'verified',
    price: quote.price,
    source: quote.source,
    fetchedAt: quote.fetchedAt,
    fairProbability: fair?.fair ?? null,
    margin: fair?.margin ?? null,
  };
}

/** The model set against the price, where one exists. */
function edgeFor(probability: number, market: MarketContext): EdgeAssessment | null {
  if (!market.price) return null;
  return {
    implied: market.price.implied,
    fair: market.fairProbability,
    edge: modelEdge(probability, market.price.implied),
    fair_edge:
      market.fairProbability === null ? null : modelEdge(probability, market.fairProbability),
  };
}

function makeSelection(
  context: BuildContext,
  rule: SettlementRule,
  quote: QuotedMarket | null,
): Selection {
  const { game, outcome } = context;
  const { projection, distribution } = outcome;

  const names = {
    homeTeam: game.home_team.name,
    awayTeam: game.away_team.name,
    sport: game.sport,
  };

  const type = selectionTypeOf(rule);
  const market = marketContextFor(rule, context, quote);
  const probability = boundProbability(probabilityFor(distribution, projection, rule));
  const verified = market.availability === 'verified';

  return {
    /*
     * Identity is the bet, not the presentation.
     *
     * Built from the settlement rule so the same bet keeps the same id across
     * refreshes — which is what makes publishing idempotent and settlement
     * able to find its target. A moved line is a genuinely different bet and
     * correctly gets a different id.
     */
    id: `${game.id}:${type}:${market.selection}`,
    game_id: game.id,
    sport: game.sport,
    league: game.league,
    start_time: game.start_time,
    fixture: `${game.away_team.name} v ${game.home_team.name}`,

    type,
    label: market.selection,
    market,
    explanation: whatNeedsToHappen(rule, names),
    probability_label: probabilityLabel(market.type),

    probability: round(probability, 4),
    edge: edgeFor(round(probability, 4), market),
    confidence: projection.confidence,
    data_quality: projection.data_quality,
    score: selectionScore(probability, projection.confidence, projection.data_quality, verified),

    // One group per game: the multi-game optimiser uses this to take at most
    // one selection from any fixture, which is what keeps its legs
    // independent. Same-game lines deliberately ignore it and measure the
    // dependence instead.
    correlation_group: game.id,
    settlement: rule,
    reasoning: orientFactors(
      projection.factors,
      backingFor(rule, { home: game.home_team.name, away: game.away_team.name }),
    ),
    projection,
  };
}

/**
 * Selections built from the lines a bookmaker is actually offering.
 *
 * The model is run against the book's line rather than the book's line being
 * compared with a line the model chose for itself. Both sides of every market
 * are produced — the model's job is to say which of the available bets it
 * likes, not to be shown only the ones it already agrees with.
 */
function quotedSelections(context: BuildContext): Selection[] {
  const quotes = context.quotes;
  if (!quotes) return [];

  const selections: Selection[] = [];
  const seen = new Set<string>();

  for (const quote of quotes.markets) {
    const selection = makeSelection(context, quote.settlement, quote);
    // A feed can list the same market twice across books; the first wins.
    if (seen.has(selection.id)) continue;
    seen.add(selection.id);
    selections.push(selection);
  }

  return selections;
}

/**
 * Selections the model derives itself.
 *
 * Used for markets the price feed does not carry, and for every market when it
 * carries nothing at all. Lines are read off the simulated distribution rather
 * than chosen because they look familiar — but nobody has confirmed a
 * bookmaker offers them, and every one is labelled accordingly.
 */
function derivedSelections(context: BuildContext, config: SportModelConfig): Selection[] {
  const { projection, distribution } = context.outcome;
  const selections: Selection[] = [];

  const favouredHome = projection.expected_margin >= 0;
  const side: 'home' | 'away' = favouredHome ? 'home' : 'away';

  /** Market types the feed already covered; the model does not duplicate them. */
  const covered = new Set(context.quotes?.markets.map((quote) => quote.market) ?? []);

  const add = (rule: SettlementRule) => {
    selections.push(makeSelection(context, rule, null));
  };

  // --- winner -------------------------------------------------------------
  if (!covered.has('moneyline')) {
    add({ kind: 'winner', side });
  }

  // --- double chance ------------------------------------------------------
  // Never quoted by the price feed, so it is always model-derived. Only
  // meaningful where a draw is a real outcome.
  if (config.hasDraw && projection.outcome.draw !== undefined) {
    add({ kind: 'double_chance', sides: [side, 'draw'] });
  }

  // --- spread -------------------------------------------------------------
  if (config.supportsSpread && !covered.has('spread')) {
    /*
     * A conservative handicap for the underdog, from the lower tail of the
     * simulated margins, plus the model's own line — which by construction
     * sits near a coin flip.
     */
    const generous = halfLine(Math.abs(quantile(distribution.margins, favouredHome ? 0.8 : 0.2)));
    const underdogSide: 'home' | 'away' = favouredHome ? 'away' : 'home';
    add({ kind: 'spread', side: underdogSide, line: generous });

    const modelLine = halfLine(Math.abs(projection.expected_margin));
    if (modelLine > 0.5) add({ kind: 'spread', side, line: -modelLine });
  }

  // --- totals -------------------------------------------------------------
  if (!covered.has('total')) {
    add({
      kind: 'total',
      direction: 'over',
      line: halfLine(quantile(distribution.totals, 0.2)),
    });
    add({
      kind: 'total',
      direction: 'under',
      line: halfLine(quantile(distribution.totals, 0.8)),
    });
  }

  // --- team totals --------------------------------------------------------
  // Not carried by the price feed for any competition, so always model-derived.
  for (const team of ['home', 'away'] as const) {
    const scores = team === 'home' ? distribution.homeScores : distribution.awayScores;
    add({
      kind: 'team_total',
      side: team,
      direction: 'over',
      line: halfLine(quantile(scores, 0.2)),
    });
  }

  /*
   * Player performance selections are not generated.
   *
   * The application's roster data carries no statistics — name, jersey,
   * position, height, weight, age — and there is no injury, lineup or expected
   * starter feed. The price feed carries no player markets either, so there is
   * nothing to model and nothing to verify against. Producing them would be
   * invention on both counts.
   */

  return selections;
}

/**
 * Every selection for one fixture.
 *
 * Bookmaker-quoted markets first, then the model's own for anything the feed
 * does not cover. The optimiser chooses among these; not all are used.
 */
export function candidateSelections(
  game: Game,
  outcome: ProjectionOutcome,
  config: SportModelConfig,
  quotes: GameMarkets | null = null,
  now: number = Date.now(),
): Selection[] {
  // A stale block is treated as no block at all, so a fixture falls back to
  // model-derived selections rather than being described with old prices.
  const usable = quotes && quoteIsFresh(quotes.fetchedAt, now) ? quotes : null;
  const context: BuildContext = { game, outcome, quotes: usable, now };

  return [...quotedSelections(context), ...derivedSelections(context, config)];
}
