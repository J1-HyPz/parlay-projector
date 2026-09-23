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
 *   count       strikeouts, receptions and touchdowns, which are small whole
 *               numbers and cannot be negative. Poisson on the measured rate —
 *               unless a statistic has been *measured* to vary more than
 *               Poisson allows, in which case `dispersion` widens it without
 *               moving the mean. Absent means unmeasured, and unmeasured means
 *               Poisson.
 *
 * What this model does **not** know, and what therefore has to be stated
 * wherever it is shown:
 *
 *   - **Whether the player is playing** — except where the provider actually
 *     announces them, which is baseball's starting pitcher and ice hockey's
 *     goalie and nobody else. Everywhere else a recent appearance is the only
 *     evidence of a role, and that is evidence about the role rather than about
 *     selection. `Participation` carries which of the two a given estimate
 *     rests on, and it is the largest single term in the data quality.
 *   - **Why a number moved.** A change of team, of role or of scheme looks
 *     exactly like noise from here. Recency weighting softens it; it does not
 *     detect it.
 *   - **The opponent.** The opposition is not in this estimate at all. That is
 *     a real omission, it is named rather than papered over, and it is why no
 *     amount of sample buys a perfect data quality.
 *
 * Pure: ratings in, probabilities out, reproducible from its inputs.
 */

import {
  boundProbability,
  clamp,
  decayWeights,
  normalAbove,
  overdispersedAtLeast,
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
  | 'anytime_touchdown'
  /** Baseball's starting pitcher, which is the pilot market. */
  | 'pitcher_strikeouts';

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
  /**
   * How much more this count varies than a Poisson process allows.
   *
   * Absent means unmeasured, and unmeasured means Poisson — the same
   * convention `SportModelConfig.scoreDispersion` uses, and for the same
   * reason: a value nobody has measured must not quietly widen a distribution.
   * A count whose spread is inherited from something else varying — a
   * pitcher's strikeouts from how long he lasts — is exactly where this is
   * expected to bite, and §7.6 of the spec is where it gets fitted.
   */
  dispersion?: number;
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

/**
 * Baseball's starting pitcher — the pilot, and deliberately one statistic.
 *
 * Strikeouts and nothing else, for a reason that is about evidence rather than
 * about effort. A pitcher is the only individual in any sport here whom the
 * provider *announces* before the fixture: measured across a full slate, every
 * baseball fixture had at least one named starter, against none at all for
 * fourteen American football fixtures. A player market needs to know the person
 * will take part, and this is the one place that is published rather than
 * presumed.
 *
 * The thresholds are higher than football's because they can be. A gamelog
 * serves ten seasons for a pitcher at roughly thirty starts each, so twenty
 * starts is an ordinary sample here where it would be two seasons of a
 * receiver's career.
 *
 * `dispersion` is deliberately absent, which means Poisson until it is
 * measured. It is the value most likely to need changing: a pitcher's
 * strikeouts inherit variance from how long he lasts, and a distribution that
 * cannot widen would price both tails as more certain than the record supports
 * — the failure baseball's own scoring model already had once.
 */
export const MLB_PITCHER_STATS: readonly PlayerStatConfig[] = [
  {
    key: 'pitcher_strikeouts',
    label: 'Strikeouts',
    noun: 'strikeouts',
    kind: 'count',
    from: (stats) => only(stats, 'strikeouts'),
    minGames: 8,
    targetGames: 20,
    minSpread: 0,
  },
];

export const PLAYER_MODEL_VERSION = 'player-v1-nfl';

/** The pilot carries its own version, since it is a different model family. */
export const PITCHER_MODEL_VERSION = 'player-v1-mlb-k';

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
    return boundProbability(
      overdispersedAtLeast(atLeast, countRate(rating), config.dispersion ?? 1),
    );
  }
  return boundProbability(normalAbove(line, rating.mean, Math.max(rating.spread, 0.5)));
}

/**
 * What is actually known about whether this player will take part.
 *
 *   announced           the provider names this individual as a starter. Only
 *                       baseball's pitcher and ice hockey's goalie are ever
 *                       announced; measured, every surveyed baseball fixture
 *                       had at least one and all eleven hockey fixtures had
 *                       both.
 *   recent_appearance   he played recently, so he presumably still has a role.
 *                       That is evidence about the *role*, not about selection,
 *                       and the two are not interchangeable.
 */
export type Participation = 'announced' | 'recent_appearance';

/**
 * The most this model may claim, by what kind of evidence it holds.
 *
 * **Neither reaches 1.** Data quality in this application means how much
 * information went in, and a player estimate is missing whole categories of it
 * that a team estimate is not: the opposition is not in the number at all, and
 * nothing here knows why a figure moved — a change of team, of quarterback or
 * of role looks exactly like noise. Those absences do not shrink as the sample
 * grows, so no number of games should buy a perfect score.
 *
 * This was the bug. Ten games of one statistic scored **1.000**, where a team
 * reaches that only with a full season plus standings plus a settled
 * head-to-head record. Since the optimiser ranks on
 * `probability × confidence × data_quality`, a ten-game player leg outranked a
 * full-season team leg — while the model's own `quality_reasons` listed three
 * things it did not know.
 *
 * The gap between the two ceilings is the participation evidence, and it is
 * deliberately large enough to matter: an unannounced player cannot reach the
 * low-risk profile's 0.60 floor however long his record is.
 */
const QUALITY_CEILING: Readonly<Record<Participation, number>> = {
  announced: 0.8,
  recent_appearance: 0.55,
};

/**
 * How much the estimate rests on.
 *
 * Three things multiplied rather than added, because each is a reason to
 * believe less and none of them substitutes for another: how much of the
 * sample the model wanted it actually has, how recently the player was seen,
 * and the ceiling above.
 */
export function playerDataQuality(
  profile: PlayerProfile,
  rating: PlayerStatRating,
  config: PlayerStatConfig,
  asOf: number,
  participation: Participation = 'recent_appearance',
): number {
  const sample = clamp(rating.games / config.targetGames, 0, 1);

  const days =
    profile.lastPlayed === null ? Infinity : (asOf - profile.lastPlayed) / 86_400_000;
  // A fortnight covers a bye week; beyond a month the role is in doubt.
  const fresh = days <= 14 ? 1 : days <= 30 ? 0.7 : 0.3;

  // A floor of 0.2 on the sample term, so a short record is thin rather than
  // worthless — it is still this player's own record.
  const evidence = 0.2 + 0.8 * sample;

  return clamp(evidence * fresh * QUALITY_CEILING[participation], 0, 1);
}

/** Why the estimate is as strong or as weak as it is. */
export function playerQualityReasons(
  profile: PlayerProfile,
  rating: PlayerStatRating,
  config: PlayerStatConfig,
  asOf: number,
  participation: Participation = 'recent_appearance',
): string[] {
  const reasons: string[] = [];

  if (rating.games < config.targetGames) {
    reasons.push(
      `${profile.name} has ${rating.games} game${rating.games === 1 ? '' : 's'} of ` +
        `${config.noun} on record; ${config.targetGames} is where this estimate stops ` +
        'gaining from a longer sample.',
    );
  }

  /*
   * What is known about taking part, which differs entirely by sport.
   *
   * An announced starter is a published fact and the caveat would be false.
   * Everybody else rests on having appeared recently, which is evidence about
   * their role rather than about selection — and saying so is the whole point,
   * since it is also the largest single term in the quality above.
   */
  const days =
    profile.lastPlayed === null ? Infinity : (asOf - profile.lastPlayed) / 86_400_000;

  if (participation === 'announced') {
    reasons.push(
      `${profile.name} is the announced starter, which is published rather than ` +
        'inferred. If that changes before the start, this is void rather than lost.',
    );
  } else {
    reasons.push(
      `Nothing here confirms ${profile.name} will be selected: no lineup, depth chart ` +
        'or inactive list is published to this application. A recent appearance is ' +
        'evidence of a role, not of selection.',
    );
    if (Number.isFinite(days) && days > 14) {
      reasons.push(
        `${profile.name} last recorded a statistic ${Math.round(days)} days ago, so even ` +
          'their role is in doubt.',
      );
    }
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

// ---------------------------------------------------------------------------
// Matching a bookmaker's spelling to a player
// ---------------------------------------------------------------------------

/**
 * A name reduced to what two sources can be expected to agree on.
 *
 * Books and the statistics provider disagree about punctuation and suffixes —
 * "Tyrone Tracy Jr." against "Tyrone Tracy", "A.J. Brown" against "AJ Brown" —
 * and none of that difference is about who the player is.
 */
export function normalisePlayerName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    // Strip accents, so "Peñа" and "Pena" are one person.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Look a player up by the name a bookmaker used.
 *
 * Exact on the normalised name and nothing looser. A near match is not
 * resolved and not guessed at: pricing the wrong person would settle a bet
 * against a record the model never had an opinion about, and nothing
 * downstream could detect it. Two players who normalise to the same name
 * resolve to neither, for the same reason.
 */
export function playerResolver(ratings: PlayerRatings): (name: string) => string | null {
  const byName = new Map<string, string | null>();

  for (const profile of ratings.players.values()) {
    const key = normalisePlayerName(profile.name);
    if (!key) continue;
    // Null marks a name two players share, which must stay unresolvable.
    byName.set(key, byName.has(key) ? null : profile.athleteId);
  }

  return (name: string) => byName.get(normalisePlayerName(name)) ?? null;
}
