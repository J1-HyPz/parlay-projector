/**
 * Feature builder: completed games in, team ratings out.
 *
 * Pure. Takes the normalised `Game` records the application already fetches —
 * the same objects Schedule and the hubs render — and derives everything the
 * sport models need. No provider calls, no I/O, so every rating is reproducible
 * from its inputs and directly testable.
 *
 * Only games that had finished *before* a given cut-off are ever used, which is
 * what keeps backtests honest: see `buildRatings`, which takes an explicit
 * `asOf`. A projection can never see a result that had not happened yet.
 *
 * What is deliberately absent: player statistics, injuries, lineups, expected
 * starters, xG, EPA and pace. None of those exist in this application's data
 * layer, and inventing them would make every number downstream fiction.
 */

import {
  clamp,
  decayWeights,
  eloUpdate,
  standardDeviation,
  weightedMean,
} from './math.ts';
import type { SportModelConfig } from './config.ts';
import type { Game } from '../home/types';

/** A completed game reduced to what the ratings need. */
export interface ResultRecord {
  date: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

export const STARTING_ELO = 1500;

/**
 * Completed games with usable scores, oldest first.
 *
 * `asOf` is the hard boundary: a game is only included if it kicked off before
 * that instant. Passing the projected game's own start time is what prevents
 * look-ahead bias, in production and in backtests alike.
 */
export function toResults(games: readonly Game[], asOf: number): ResultRecord[] {
  const results: ResultRecord[] = [];

  for (const game of games) {
    if (game.status !== 'finished') continue;
    if (!game.start_time) continue;

    const date = Date.parse(game.start_time);
    if (!Number.isFinite(date) || date >= asOf) continue;

    const home = game.score?.home;
    const away = game.score?.away;
    if (typeof home !== 'number' || typeof away !== 'number') continue;

    results.push({
      date,
      homeTeam: game.home_team.name,
      awayTeam: game.away_team.name,
      homeScore: home,
      awayScore: away,
    });
  }

  return results.sort((a, b) => a.date - b.date);
}

/** One team's derived profile. */
export interface TeamRating {
  team: string;
  games: number;
  elo: number;
  /** Mean scored and conceded per game, recency-weighted. */
  attack: number;
  defence: number;
  /** The same rates adjusted for the quality of opposition faced. */
  adjustedAttack: number;
  adjustedDefence: number;
  /** Volatility of this team's scoring, for the confidence estimate. */
  scoreVariability: number | null;
  /** Home and away splits, null until a team has played enough of each. */
  homeAttack: number | null;
  awayAttack: number | null;
  /** Most recent kick-off, for the rest calculation. */
  lastPlayed: number | null;
  /** Recent results, newest first, for the explanation text. */
  recentForm: ('W' | 'D' | 'L')[];
}

export interface RatingSet {
  ratings: Map<string, TeamRating>;
  /** League-average score per team per game, the prior everything regresses to. */
  leagueAverage: number;
  /** Number of completed games the ratings were built from. */
  sample: number;
}

interface Appearance {
  date: number;
  scored: number;
  conceded: number;
  opponent: string;
  home: boolean;
  result: 'W' | 'D' | 'L';
}

/**
 * Build ratings from completed results.
 *
 * Two passes, both ordinary and inspectable:
 *
 *   1. Elo is walked forward chronologically, so each update uses only the
 *      ratings as they stood before that game.
 *   2. Scoring rates are recency-weighted means, then adjusted once for the
 *      strength of the opposition each team actually faced. A side racking up
 *      goals against the bottom of the table is not treated like one doing it
 *      against the top.
 */
export function buildRatings(
  results: readonly ResultRecord[],
  config: SportModelConfig,
): RatingSet {
  const appearances = new Map<string, Appearance[]>();
  const elo = new Map<string, number>();

  let scoreTotal = 0;
  let scoreCount = 0;

  const push = (team: string, appearance: Appearance) => {
    const list = appearances.get(team);
    if (list) list.push(appearance);
    else appearances.set(team, [appearance]);
  };

  // Chronological, so Elo never sees a future game.
  for (const result of results) {
    const homeElo = elo.get(result.homeTeam) ?? STARTING_ELO;
    const awayElo = elo.get(result.awayTeam) ?? STARTING_ELO;

    const margin = result.homeScore - result.awayScore;
    const homeOutcome: 1 | 0.5 | 0 = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;

    // Home advantage is applied to the *expectation*, so a home win against
    // the run of play moves the rating less than an away one.
    const eloEdge = config.homeAdvantage * (100 / Math.max(config.marginPerHundredElo, 0.01));

    elo.set(
      result.homeTeam,
      eloUpdate(homeElo, awayElo + eloEdge, homeOutcome, margin, config.eloK),
    );
    elo.set(
      result.awayTeam,
      eloUpdate(
        awayElo,
        homeElo + eloEdge,
        homeOutcome === 1 ? 0 : homeOutcome === 0 ? 1 : 0.5,
        margin,
        config.eloK,
      ),
    );

    push(result.homeTeam, {
      date: result.date,
      scored: result.homeScore,
      conceded: result.awayScore,
      opponent: result.awayTeam,
      home: true,
      result: margin > 0 ? 'W' : margin < 0 ? 'L' : 'D',
    });
    push(result.awayTeam, {
      date: result.date,
      scored: result.awayScore,
      conceded: result.homeScore,
      opponent: result.homeTeam,
      home: false,
      result: margin < 0 ? 'W' : margin > 0 ? 'L' : 'D',
    });

    scoreTotal += result.homeScore + result.awayScore;
    scoreCount += 2;
  }

  const leagueAverage =
    scoreCount > 0 ? scoreTotal / scoreCount : config.baselineTotal / 2;

  // --- pass one: unadjusted, recency-weighted rates -----------------------
  const base = new Map<string, { attack: number; defence: number }>();

  for (const [team, list] of appearances) {
    const newestFirst = [...list].sort((a, b) => b.date - a.date);
    const weights = decayWeights(newestFirst.length, config.formHalfLife);

    const attack = weightedMean(newestFirst.map((a) => a.scored), weights) ?? leagueAverage;
    const defence = weightedMean(newestFirst.map((a) => a.conceded), weights) ?? leagueAverage;

    // Regress toward the league average until a team has a real sample. With
    // four games played, most of what looks like form is noise.
    const trust = clamp(list.length / config.targetGames, 0, 1);
    base.set(team, {
      attack: leagueAverage + (attack - leagueAverage) * trust,
      defence: leagueAverage + (defence - leagueAverage) * trust,
    });
  }

  // --- pass two: adjust for the opposition actually faced ------------------
  const ratings = new Map<string, TeamRating>();

  for (const [team, list] of appearances) {
    const newestFirst = [...list].sort((a, b) => b.date - a.date);
    const weights = decayWeights(newestFirst.length, config.formHalfLife);
    const own = base.get(team) ?? { attack: leagueAverage, defence: leagueAverage };

    /*
     * Opponent adjustment.
     *
     * A goal scored against a defence that concedes half the league average is
     * worth more than one against a leaky defence, so each result is divided by
     * the opponent's own rate before being averaged. The ratio is clamped: an
     * extreme opponent rating early in a season would otherwise swing a team's
     * whole profile.
     */
    const adjustedScored = newestFirst.map((appearance) => {
      const opponent = base.get(appearance.opponent);
      const factor = opponent ? clamp(leagueAverage / Math.max(opponent.defence, 0.05), 0.5, 2) : 1;
      return appearance.scored * factor;
    });
    const adjustedConceded = newestFirst.map((appearance) => {
      const opponent = base.get(appearance.opponent);
      const factor = opponent ? clamp(leagueAverage / Math.max(opponent.attack, 0.05), 0.5, 2) : 1;
      return appearance.conceded * factor;
    });

    const trust = clamp(list.length / config.targetGames, 0, 1);
    const adjAttack = weightedMean(adjustedScored, weights) ?? leagueAverage;
    const adjDefence = weightedMean(adjustedConceded, weights) ?? leagueAverage;

    const homeGames = list.filter((a) => a.home);
    const awayGames = list.filter((a) => !a.home);
    // A split needs its own sample; three home games says nothing.
    const SPLIT_MINIMUM = 4;

    ratings.set(team, {
      team,
      games: list.length,
      elo: elo.get(team) ?? STARTING_ELO,
      attack: own.attack,
      defence: own.defence,
      adjustedAttack: leagueAverage + (adjAttack - leagueAverage) * trust,
      adjustedDefence: leagueAverage + (adjDefence - leagueAverage) * trust,
      scoreVariability: standardDeviation(list.map((a) => a.scored)),
      homeAttack:
        homeGames.length >= SPLIT_MINIMUM
          ? homeGames.reduce((sum, a) => sum + a.scored, 0) / homeGames.length
          : null,
      awayAttack:
        awayGames.length >= SPLIT_MINIMUM
          ? awayGames.reduce((sum, a) => sum + a.scored, 0) / awayGames.length
          : null,
      lastPlayed: newestFirst[0]?.date ?? null,
      recentForm: newestFirst.slice(0, 6).map((a) => a.result),
    });
  }

  return { ratings, leagueAverage, sample: results.length };
}

/** Whole days between a team's previous game and this one; null if unknown. */
export function restDays(rating: TeamRating | undefined, kickoff: number): number | null {
  if (!rating?.lastPlayed) return null;
  const days = (kickoff - rating.lastPlayed) / 86_400_000;
  return days >= 0 ? Math.floor(days) : null;
}

/**
 * How much the projection actually knows, 0..1.
 *
 * Driven by the weakest side rather than the average: a fixture where one team
 * has thirty games of history and the other has three is a thin projection, and
 * averaging would disguise that.
 */
export function dataQuality(
  home: TeamRating | undefined,
  away: TeamRating | undefined,
  config: SportModelConfig,
  extras: { hasStandings: boolean; hasHeadToHead: boolean },
): number {
  if (!home || !away) return 0;

  const weakest = Math.min(home.games, away.games);
  if (weakest < config.minGames) return 0;

  // History is the bulk of it; standings and a head-to-head record add a
  // little, because they corroborate rather than replace the results.
  const history = clamp(weakest / config.targetGames, 0, 1) * 0.75;
  const bothSplits =
    home.homeAttack !== null && away.awayAttack !== null ? 0.1 : 0;
  const standings = extras.hasStandings ? 0.1 : 0;
  const h2h = extras.hasHeadToHead ? 0.05 : 0;

  return clamp(history + bothSplits + standings + h2h, 0, 1);
}

/**
 * How reliable the probability estimate is, 0..1.
 *
 * Distinct from the probability itself. A model can be quite sure a team wins
 * 80% of the time and still be working from a small, volatile sample — that is
 * a high probability with low confidence, and the two are reported separately.
 *
 * Falls with: thin samples, unusually volatile scoring, and the two sides
 * having very different amounts of history.
 */
export function estimateConfidence(
  home: TeamRating | undefined,
  away: TeamRating | undefined,
  quality: number,
  config: SportModelConfig,
): number {
  if (!home || !away) return 0;

  const sample = clamp(Math.min(home.games, away.games) / config.targetGames, 0, 1);

  // Scoring far more erratic than the sport's norm means the same rating
  // supports a wider range of outcomes.
  const typical = config.scoring === 'poisson' ? Math.sqrt(config.baselineTotal / 2) : config.scoreSd;
  const volatility = [home.scoreVariability, away.scoreVariability]
    .filter((value): value is number => value !== null)
    .map((value) => clamp(value / Math.max(typical, 0.01), 0.5, 2));
  const steadiness =
    volatility.length > 0
      ? clamp(2 - volatility.reduce((a, b) => a + b, 0) / volatility.length, 0.3, 1)
      : 0.7;

  // A lopsided pair of samples is less trustworthy than two even ones.
  const balance = clamp(
    Math.min(home.games, away.games) / Math.max(home.games, away.games, 1),
    0.4,
    1,
  );

  return clamp(0.35 * quality + 0.35 * sample + 0.2 * steadiness + 0.1 * balance, 0, 0.95);
}
