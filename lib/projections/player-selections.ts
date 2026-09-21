/**
 * Turning a player's record into projections and, where a book has quoted
 * one, into a bet.
 *
 * The rule this module exists to respect is one the application already had,
 * written down long before there were any player markets:
 *
 *   > **No alternate lines beyond what is quoted.** Generating a ladder of
 *   > handicaps the model can price but nobody offers is the exact failure
 *   > this work set out to fix.
 *
 * A player market is the easiest place in the whole system to break that.
 * Nothing stops this model pricing "over 62.5 receiving yards", and the number
 * would look exactly like a real one — so the line has to come from a book,
 * not from the model's own mean.
 *
 * Two things therefore come out of here, and they are not the same thing:
 *
 *   **A projection.** What the model expects this player to do, with the range
 *   it expects it in. Always produced where the record supports it. It is
 *   analysis, it is shown on the fixture's page, and it is not a bet.
 *
 *   **A selection.** A bet at a line a bookmaker is actually offering, which
 *   can be verified, scored and parlayed like any other. Produced only against
 *   a quote — with one exception, below.
 *
 * The exception is the anytime touchdown, whose line is 0.5 everywhere and
 * always: "did he score" has one threshold and the model does not get to
 * choose it. That is a natural threshold rather than an invented rung, the
 * same way a podium is three and a points finish is ten in motorsport.
 *
 * Pure.
 */

import { boundProbability } from './math.ts';
import { orientFactors } from './factors.ts';
import { edgeFor, marketContextFor, selectionScore } from './project.ts';
import {
  NFL_PLAYER_STATS,
  PLAYER_MODEL_VERSION,
  playerDataQuality,
  playerQualityReasons,
  probabilityOver,
} from './player-model.ts';
import type {
  PlayerProfile,
  PlayerRatings,
  PlayerStatConfig,
  PlayerStatKey,
} from './player-model.ts';
import { probabilityLabel, whatNeedsToHappen } from '../markets/explain.ts';
import type { FixtureNames } from '../markets/explain.ts';
import { quoteIsFresh } from '../markets/types.ts';
import type { GameMarkets, QuotedMarket, SettlementRule } from '../markets/types.ts';
import { sidesOf } from '../home/types.ts';
import type { Game } from '../home/types';
import type { PlayerProjection, Selection } from './types.ts';

/**
 * How long a player may go unseen before the model stops projecting them.
 *
 * There is no lineup feed, no depth chart and no inactive list here, so an
 * appearance is the only evidence that a player still has a role. Five weeks
 * covers a bye and a short injury; past it the record describes somebody
 * else's job.
 */
const MAX_ABSENCE_DAYS = 35;

/** Projections kept per fixture, so a box score does not become a phone book. */
const MAX_PROJECTIONS = 12;

/**
 * Derived selections kept per fixture.
 *
 * Only the anytime touchdown is derived, and an NFL squad supplies twenty-odd
 * of them — enough to bury the handful of markets a bookmaker has actually
 * quoted under a list nobody asked for. A quoted market is never dropped by
 * this: it is a bet that exists, and the cap applies to the ones the model
 * proposed itself.
 */
const MAX_DERIVED = 8;

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** The two provider team ids this fixture is between. */
function fixtureTeams(game: Game): { home: string | null; away: string | null } {
  const sides = sidesOf(game);
  return { home: sides?.home.id ?? null, away: sides?.away.id ?? null };
}

/**
 * Players from this fixture's two teams, recently enough seen to have a role.
 *
 * Attribution is by the provider's team id rather than by name: a player is
 * assigned to whichever team they last recorded a statistic for, which also
 * means somebody who changed clubs is projected for the right one.
 */
export function squadFor(
  game: Game,
  ratings: PlayerRatings,
  asOf: number,
): PlayerProfile[] {
  const teams = fixtureTeams(game);
  if (!teams.home && !teams.away) return [];

  return [...ratings.players.values()].filter((profile) => {
    if (profile.teamId !== teams.home && profile.teamId !== teams.away) return false;
    if (profile.lastPlayed === null) return false;
    return (asOf - profile.lastPlayed) / 86_400_000 <= MAX_ABSENCE_DAYS;
  });
}

/**
 * What the model expects, for one player and one statistic.
 *
 * The range is one spread either side of the mean, which for the normal
 * statistics is about two games in three — stated on the projection rather
 * than left for a reader to assume it means something tighter.
 */
function projectionFor(
  game: Game,
  profile: PlayerProfile,
  config: PlayerStatConfig,
  asOf: number,
): PlayerProjection | null {
  const rating = profile.stats.get(config.key);
  if (!rating) return null;

  const quality = playerDataQuality(profile, rating, config, asOf);

  return {
    game_id: game.id,
    athlete_id: profile.athleteId,
    player: profile.name,
    team_id: profile.teamId,
    position: profile.position,
    stat: config.key,
    stat_label: config.label,
    expected: rating.mean,
    // Never below zero: nobody runs for minus forty yards over a game, and a
    // normal distribution does not know that.
    likely_range: [
      Math.max(0, round(rating.mean - rating.spread, 1)),
      round(rating.mean + rating.spread, 1),
    ],
    games: rating.games,
    recent: [...rating.recent],
    data_quality: round(quality, 3),
    quality_reasons: playerQualityReasons(profile, rating, config, asOf),
    model_version: PLAYER_MODEL_VERSION,
    generated_at: new Date(asOf).toISOString(),
  };
}

/**
 * Every player projection for a fixture, strongest evidence first.
 *
 * Ordered by how much stands behind the estimate rather than by how large the
 * number is: a reader scanning this should meet the estimates the model can
 * most defend, not the biggest totals.
 */
export function playerProjections(
  game: Game,
  ratings: PlayerRatings,
  asOf: number = Date.now(),
  stats: readonly PlayerStatConfig[] = NFL_PLAYER_STATS,
): PlayerProjection[] {
  const out: PlayerProjection[] = [];

  for (const profile of squadFor(game, ratings, asOf)) {
    for (const config of stats) {
      const projection = projectionFor(game, profile, config, asOf);
      if (projection) out.push(projection);
    }
  }

  return out
    .sort((a, b) => b.data_quality - a.data_quality || b.expected - a.expected)
    .slice(0, MAX_PROJECTIONS);
}

// ---------------------------------------------------------------------------
// Selections
// ---------------------------------------------------------------------------

const BY_KEY = new Map(NFL_PLAYER_STATS.map((config) => [config.key, config]));

/** The statistic a quoted player market is about, if this model knows it. */
function configFor(key: string): PlayerStatConfig | null {
  return BY_KEY.get(key as PlayerStatKey) ?? null;
}

function makeSelection(
  game: Game,
  profile: PlayerProfile,
  config: PlayerStatConfig,
  rule: Extract<SettlementRule, { kind: 'player_stat' }>,
  names: FixtureNames,
  quotes: GameMarkets | null,
  quote: QuotedMarket | null,
  asOf: number,
): Selection | null {
  const rating = profile.stats.get(config.key);
  if (!rating) return null;

  const over = probabilityOver(rating, config, rule.line);
  const probability = round(
    boundProbability(rule.direction === 'over' ? over : 1 - over),
    4,
  );

  const market = marketContextFor(rule, names, quotes, quote, asOf);
  const verified = market.availability === 'verified';
  const quality = playerDataQuality(profile, rating, config, asOf);
  /*
   * Confidence is not the probability.
   *
   * How reliable the estimate is, which for a player market is mostly how
   * many games it rests on and how recently they were played — the same two
   * things the data quality is built from, deliberately, because there is no
   * third source of evidence here to separate them with.
   */
  const confidence = round(Math.min(quality, 0.8), 3);

  return {
    id: `${game.id}:player:${profile.athleteId}:${config.key}:${rule.direction}:${rule.line}`,
    game_id: game.id,
    sport: game.sport,
    league: game.league,
    start_time: game.start_time,
    fixture: `${names.awayTeam} v ${names.homeTeam}`,

    type: 'player_performance',
    label: market.selection,
    market,
    explanation: whatNeedsToHappen(rule, names),
    probability_label: probabilityLabel(market.type),

    probability,
    edge: edgeFor(probability, market),
    confidence,
    data_quality: round(quality, 3),
    score: selectionScore(probability, confidence, quality, verified),

    /*
     * One group per player, not per fixture.
     *
     * Two markets on the same person move together — a receiver going over his
     * yards has usually gone over his receptions — so the optimiser must treat
     * them as one choice. Two *different* players in the same game are far
     * less related than two team markets are, but they are not independent
     * either, and the same-game counter cannot measure that because the team
     * simulations contain no people. Grouping per player is the conservative
     * half of that: it prevents the obvious double-count and does not pretend
     * to price the subtle one.
     */
    correlation_group: `${game.id}:${profile.athleteId}`,
    settlement: rule,
    reasoning: orientFactors(
      // Every one of these is a caveat about the estimate rather than a
      // statement about a side, which is what `uncertainty` is for.
      playerQualityReasons(profile, rating, config, asOf).map((text) => ({
        text,
        subject: { kind: 'uncertainty' as const },
        direction: 'negative' as const,
      })),
      { team: null, opponent: null, lean: null },
    ),
  };
}

/**
 * Selections for one fixture's players.
 *
 * A quoted line becomes a bet at exactly that line. An unquoted statistic
 * becomes nothing at all — except the anytime touchdown, whose threshold is
 * not the model's to choose.
 */
export function playerSelections(
  game: Game,
  ratings: PlayerRatings,
  quotes: GameMarkets | null = null,
  asOf: number = Date.now(),
): Selection[] {
  const sides = sidesOf(game);
  if (!sides) return [];

  const names: FixtureNames = {
    homeTeam: sides.home.name,
    awayTeam: sides.away.name,
    sport: game.sport,
  };

  // A stale block is treated as no block at all, exactly as every other engine
  // treats one: better an absent selection than an old price.
  const usable = quotes && quoteIsFresh(quotes.fetchedAt, asOf) ? quotes : null;
  const squad = squadFor(game, ratings, asOf);
  const byId = new Map(squad.map((profile) => [profile.athleteId, profile]));

  const selections: Selection[] = [];
  const seen = new Set<string>();

  const add = (
    profile: PlayerProfile,
    config: PlayerStatConfig,
    rule: Extract<SettlementRule, { kind: 'player_stat' }>,
    quote: QuotedMarket | null,
  ) => {
    const selection = makeSelection(
      game,
      profile,
      config,
      rule,
      names,
      usable,
      quote,
      asOf,
    );
    if (!selection || seen.has(selection.id)) return;
    seen.add(selection.id);
    selections.push(selection);
  };

  // Quoted lines first: these are the bets that actually exist.
  for (const quote of usable?.markets ?? []) {
    const rule = quote.settlement;
    if (rule.kind !== 'player_stat') continue;

    const profile = byId.get(rule.athleteId);
    const config = configFor(rule.stat);
    // A market on somebody this model has no record for is left alone rather
    // than answered with a guess.
    if (!profile || !config) continue;

    add(profile, config, rule, quote);
  }

  /*
   * The one derived line, and why it is allowed.
   *
   * "Anytime touchdown" has a single threshold everywhere — half a
   * touchdown — because the question is whether he scored at all. The model
   * is not choosing a rung on a ladder, and there is exactly one market to
   * state an opinion about.
   */
  const anytime = BY_KEY.get('anytime_touchdown');
  const derived: Selection[] = [];
  if (anytime) {
    const before = selections.length;
    for (const profile of squad) {
      if (!profile.stats.has(anytime.key)) continue;
      add(
        profile,
        anytime,
        {
          kind: 'player_stat',
          athleteId: profile.athleteId,
          player: profile.name,
          stat: anytime.key,
          statLabel: anytime.label,
          direction: 'over',
          line: 0.5,
        },
        null,
      );
    }
    derived.push(...selections.splice(before));
  }

  const quoted = selections;
  derived.sort((a, b) => b.score - a.score);

  return [...quoted, ...derived.slice(0, MAX_DERIVED)].sort((a, b) => b.score - a.score);
}
