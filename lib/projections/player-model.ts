/**
 * What one player is likely to do, from what they have actually done.
 *
 * The fourth engine, and the narrowest. The team model simulates a scoreline,
 * the race model a finishing order, the bout model a winner; this one answers
 * a single question about a single person — will they pass this number — and
 * it answers it from their own game-by-game record and nothing else.
 *
 * Two distributions, chosen per statistic rather than applied uniformly:
 *
 *   continuous  yardage, which is a sum of many plays and spreads roughly
 *               symmetrically about its mean. Normal, with the spread measured
 *               from the player's own games rather than assumed.
 *   count       receptions and touchdowns, which are small whole numbers and
 *               cannot be negative. Poisson on the measured rate.
 *
 * What this model does **not** know, and what therefore has to be stated
 * wherever it is shown:
 *
 *   - **Whether the player is playing.** There is no snap count, no depth
 *     chart and no expected-starter feed here. Recent appearances are the only
 *     evidence of a role, so a player who has missed games is excluded rather
 *     than projected at their old rate.
 *   - **Why a number moved.** A change of team, of quarterback or of scheme
 *     looks exactly like noise from here. Recency weighting softens it; it
 *     does not detect it.
 *   - **The opponent.** A team's defence is not in this estimate at all. That
 *     is a real omission and it is named rather than papered over.
 *
 * Pure: ratings in, probabilities out, reproducible from its inputs.
 */

import {
  boundProbability,
  clamp,
  decayWeights,
  normalAbove,
  poissonAtLeast,
  standardDeviation,
  weightedMean,
} from './math.ts';
import type { PlayerGame } from '../players/history';

/** Statistics this model can price. Deliberately a short, verified list. */
export type PlayerStatKey =
  | 'passing_yards'
  | 'passing_touchdowns'
  | 'rushing_yards'
  | 'receiving_yards'
  | 'receptions'
  | 'anytime_touchdown';

export interface PlayerStatConfig {
  key: PlayerStatKey;
  /** How a market names it, e.g. `Passing yards`. */
  label: string;
  /** How a sentence names it, e.g. `passing yards`. */
  noun: string;
  kind: 'continuous' | 'count';
  /**
   * The value for one game, or null when the player has no such line.
   *
   * Null is not zero. A quarterback with no rushing row did not rush for no
   * yards, he has no rushing row — and averaging the difference in would drag
   * every rate towards zero for everyone who ever sat a game out.
   */
  from(stats: Record<string, number>): number | null;
  /** Below this many games, the model says nothing about this statistic. */
  minGames: number;
  /** Where trust in the sample stops growing. */
  targetGames: number;
  /**
   * Floor on the spread, as a fraction of the mean.
   *
   * A player with three similar games has a measured spread near zero, and a
   * normal distribution that narrow returns a probability near 1. That is the
   * small-sample overconfidence the team model was recalibrated to remove, and
   * it is guarded here at the source rather than filtered downstream.
   */
  minSpread: number;
}

function sum(stats: Record<string, number>, keys: readonly string[]): number | null {
  let total = 0;
  let found = false;
  for (const key of keys) {
    const value = stats[key];
    if (typeof value === 'number') {
      total += value;
      found = true;
    }
  }
  return found ? total : null;
}

function only(stats: Record<string, number>, key: string): number | null {
  const value = stats[key];
  return typeof value === 'number' ? value : null;
}

/**
 * The NFL statistics, with the thresholds each one needs.
 *
 * Yardage gets a lower minimum than a touchdown rate does: a receiver's yards
 * are a sum of several catches and settle quickly, while touchdowns are rare
 * enough that four games of them say almost nothing about a fifth.
 */
export const NFL_PLAYER_STATS: readonly PlayerStatConfig[] = [
  {
    key: 'passing_yards',
    label: 'Passing yards',
    noun: 'passing yards',
    kind: 'continuous',
    from: (stats) => only(stats, 'passingYards'),
    minGames: 4,
    targetGames: 10,
    minSpread: 0.2,
  },
  {
    key: 'rushing_yards',
    label: 'Rushing yards',
    noun: 'rushing yards',
    kind: 'continuous',
    from: (stats) => only(stats, 'rushingYards'),
    minGames: 4,
    targetGames: 10,
    minSpread: 0.3,
  },
  {
    key: 'receiving_yards',
    label: 'Receiving yards',
    noun: 'receiving yards',
    kind: 'continuous',
    from: (stats) => only(stats, 'receivingYards'),
    minGames: 4,
    targetGames: 10,
    minSpread: 0.35,
  },
  {
    key: 'receptions',
    label: 'Receptions',
    noun: 'receptions',
    kind: 'count',
    from: (stats) => only(stats, 'receptions'),
    minGames: 4,
    targetGames: 10,
    minSpread: 0,
  },
  {
    key: 'passing_touchdowns',
    label: 'Passing touchdowns',
    noun: 'passing touchdowns',
    kind: 'count',
    from: (stats) => only(stats, 'passingTouchdowns'),
    minGames: 6,
    targetGames: 12,
    minSpread: 0,
  },
  {
    key: 'anytime_touchdown',
    label: 'Anytime touchdown',
    noun: 'touchdowns',
    kind: 'count',
    // Rushing and receiving, which is what "anytime" means for a player who is
    // not the quarterback. A passing touchdown is thrown, not scored.
    from: (stats) => sum(stats, ['rushingTouchdowns', 'receivingTouchdowns']),
    minGames: 6,
    targetGames: 12,
    minSpread: 0,
  },
];

export const PLAYER_MODEL_VERSION = 'player-v1-nfl';

/** One statistic's rating for one player. */
export interface PlayerStatRating {
  key: PlayerStatKey;
  /** Games in which the player recorded this statistic at all. */
  games: number;
  /** Recency-weighted mean per game. */
  mean: number;
  /** Spread used by the distribution, after the floor is applied. */
  spread: number;
  /** The measured spread before the floor, for the explanation. Null if one game. */
  measuredSpread: number | null;
  /** Most recent values, newest first, for the explanation. */
  recent: number[];
}

export interface PlayerProfile {
  athleteId: string;
  name: string;
  teamId: string | null;
  position: string | null;
  /** Games the player appeared in at all, however they were used. */
  appearances: number;
  /** Most recent appearance, as epoch milliseconds. */
  lastPlayed: number | null;
  stats: Map<PlayerStatKey, PlayerStatRating>;
}

export interface PlayerRatings {
  players: Map<string, PlayerProfile>;
  /** Games the ratings were built from. */
  sample: number;
}

/**
 * How quickly a player's older games stop counting.
 *
 * Shorter than the team model's, deliberately. A team is an institution and
 * changes slowly; a player's role can change in a week, and the only signal
 * this model has that it did is that the recent numbers look different.
 */
const FORM_HALF_LIFE = 5;

/** Build per-player ratings from game lines. */
export function buildPlayerRatings(
  lines: readonly PlayerGame[],
  stats: readonly PlayerStatConfig[] = NFL_PLAYER_STATS,
): PlayerRatings {
  const byPlayer = new Map<string, PlayerGame[]>();
  for (const line of lines) {
    const list = byPlayer.get(line.athleteId);
    if (list) list.push(line);
    else byPlayer.set(line.athleteId, [line]);
  }

  const players = new Map<string, PlayerProfile>();

  for (const [athleteId, games] of byPlayer) {
    // Newest first, which is the order the decay weights expect.
    const ordered = [...games].sort((a, b) => b.date - a.date);
    const newest = ordered[0];

    const profile: PlayerProfile = {
      athleteId,
      name: newest.name,
      teamId: newest.teamId,
      position: newest.position,
      appearances: ordered.length,
      lastPlayed: newest.date,
      stats: new Map(),
    };

    for (const config of stats) {
      // Only the games where the player recorded this statistic. A receiver
      // who did not play has no row, and no row is not a zero.
      const values: number[] = [];
      for (const game of ordered) {
        const value = config.from(game.stats);
        if (value !== null) values.push(value);
      }
      if (values.length < config.minGames) continue;

      const weights = decayWeights(values.length, FORM_HALF_LIFE);
      const mean = weightedMean(values, weights) ?? 0;
      const measured = standardDeviation(values);

      const floor = Math.max(config.minSpread * Math.abs(mean), 0.5);
      const spread = Math.max(measured ?? 0, floor);

      profile.stats.set(config.key, {
        key: config.key,
        games: values.length,
        mean: Number(mean.toFixed(2)),
        spread: Number(spread.toFixed(2)),
        measuredSpread: measured === null ? null : Number(measured.toFixed(2)),
        recent: values.slice(0, 6),
      });
    }

    if (profile.stats.size > 0) players.set(athleteId, profile);
  }

  return { players, sample: new Set(lines.map((line) => line.gameId)).size };
}

/**
 * The rate a count statistic is priced at.
 *
 * Not simply the observed mean, because "it has not happened yet" is not the
 * same claim as "it cannot happen". A receiver with eight games and no
 * touchdown has an observed rate of zero, and pricing that literally says he
 * will certainly not score — which is a stronger statement than eight games
 * can support, and the mirror of the overconfidence the spread floor guards
 * against for yardage.
 *
 * So a floor of half an event across the sample, which is the usual Jeffreys
 * correction for exactly this: eight blank games become a rate of 0.056 and a
 * chance of about one in eighteen, and a player who does score is unaffected
 * because his own rate is far above the floor.
 */
function countRate(rating: PlayerStatRating): number {
  return Math.max(rating.mean, 0.5 / (rating.games + 1));
}

/**
 * The chance this player goes over the line.
 *
 * Half-lines only, which is what a book quotes and what leaves no push to
 * adjudicate. An integer line is treated as "more than", so 1 means two or
 * more — stated here because the alternative reading would settle a push as a
 * loss.
 */
export function probabilityOver(
  rating: PlayerStatRating,
  config: PlayerStatConfig,
  line: number,
): number {
  if (config.kind === 'count') {
    // Over 0.5 is "at least one"; over 1.5 is "at least two".
    const atLeast = Math.floor(line) + 1;
    return boundProbability(poissonAtLeast(atLeast, countRate(rating)));
  }
  return boundProbability(normalAbove(line, rating.mean, Math.max(rating.spread, 0.5)));
}

/**
 * How much the estimate rests on.
 *
 * Games recorded, tempered by how recently the player appeared. A player last
 * seen a month ago is either injured or no longer used, and this model cannot
 * tell which — so the sample is discounted rather than trusted at face value.
 */
export function playerDataQuality(
  profile: PlayerProfile,
  rating: PlayerStatRating,
  config: PlayerStatConfig,
  asOf: number,
): number {
  const sample = clamp(rating.games / config.targetGames, 0, 1);

  const days =
    profile.lastPlayed === null ? Infinity : (asOf - profile.lastPlayed) / 86_400_000;
  // A fortnight covers a bye week; beyond a month the role is in doubt.
  const fresh = days <= 14 ? 1 : days <= 30 ? 0.7 : 0.3;

  return clamp(sample * 0.8 * fresh + 0.2 * fresh, 0, 1);
}

/** Why the estimate is as strong or as weak as it is. */
export function playerQualityReasons(
  profile: PlayerProfile,
  rating: PlayerStatRating,
  config: PlayerStatConfig,
  asOf: number,
): string[] {
  const reasons: string[] = [];

  if (rating.games < config.targetGames) {
    reasons.push(
      `${profile.name} has ${rating.games} game${rating.games === 1 ? '' : 's'} of ` +
        `${config.noun} on record; ${config.targetGames} is where this estimate stops ` +
        'gaining from a longer sample.',
    );
  }

  const days =
    profile.lastPlayed === null ? Infinity : (asOf - profile.lastPlayed) / 86_400_000;
  if (Number.isFinite(days) && days > 14) {
    reasons.push(
      `${profile.name} last recorded a statistic ${Math.round(days)} days ago, so their ` +
        'current role is uncertain — no lineup or expected-starter data is published here.',
    );
  }

  if (rating.measuredSpread !== null && rating.spread > rating.measuredSpread) {
    reasons.push(
      `Their game-to-game spread measured ${rating.measuredSpread}, which is narrow for ` +
        `this sample, so ${rating.spread} is used instead rather than reporting more ` +
        'certainty than a short record supports.',
    );
  }

  reasons.push(
    'The opponent is not in this estimate: it is built from this player’s own games ' +
      'and carries no view of the defence they face.',
  );

  return reasons;
}
