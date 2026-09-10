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
import { sidesOf } from '../home/types.ts';
import type { SportModelConfig } from './config.ts';
import type { Game } from '../home/types';
import { isAbsent, isInDoubt } from '../games/availability-normalise.ts';
import type { PlayerAvailability } from '../games/availability-normalise.ts';

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

    /*
     * Two sides and a score, or it is not a result this model can learn from.
     * A race finishes in an order rather than a scoreline, and rating drivers
     * needs a different model — see lib/projections/racing.ts.
     */
    const sides = sidesOf(game);
    if (!sides) continue;

    results.push({
      date,
      homeTeam: sides.home.name,
      awayTeam: sides.away.name,
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
  /**
   * Home and away scoring rates, null until a team has played enough of each.
   *
   * **These deliberately do not feed the expected score, and the reason is a
   * measurement rather than an oversight.** §4.7 of the v2 spec proposed
   * blending them in. Across thirteen competitions and 1,443 team-seasons a
   * team's home/away split has no reliability worth the name: the spread of
   * observed splits sits at or below what sampling noise alone produces in
   * twelve of them, and no direct test of persistence — odd/even halves within
   * a season, or season to season — reaches significance outside baseball.
   * Baseball's split is real and turned out to be the ballpark rather than the
   * team, which is handled in `parks.ts` and belongs to the ground, not here.
   *
   * What they are still good for is what they are still used for: knowing a
   * team has played a real sample of both is evidence about how much the
   * projection knows, which is `dataQuality`'s job and not the model's.
   */
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
    /*
     * A split needs its own sample; three home games says nothing.
     *
     * Four is enough for the data-quality signal these feed, and would be far
     * too few for a scoring rate — which is moot, because the splits were
     * measured and carry no predictive signal at any sample size. See the
     * field documentation on `TeamRating`.
     */
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
 * Why the data quality came out where it did.
 *
 * A rating on its own is not useful: "Medium" tells a reader that something is
 * missing without saying what, and leaves them unable to judge whether it
 * matters to them. These are the specific gaps, in the order they cost the
 * most.
 *
 * Only shortfalls are listed. A projection standing on everything available
 * returns an empty list, and the interface says so rather than manufacturing a
 * caveat to fill the space.
 */
/**
 * What the provider says about the two squads.
 *
 * Absent or null means it says nothing at all for this competition, which is
 * not the same as saying nobody is missing — see `leagueAvailability`.
 */
export interface SquadNews {
  home: readonly PlayerAvailability[];
  away: readonly PlayerAvailability[];
}

/** Absences and doubts on one side. */
export function squadCount(players: readonly PlayerAvailability[]): {
  out: number;
  doubt: number;
} {
  let out = 0;
  let doubt = 0;
  for (const player of players) {
    if (isAbsent(player.status)) out += 1;
    else if (isInDoubt(player.status)) doubt += 1;
  }
  return { out, doubt };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** One side's news, as a phrase, or null when there is none to report. */
function sidePhrase(team: string, tally: { out: number; doubt: number }): string | null {
  const parts: string[] = [];
  if (tally.out > 0) parts.push(`${plural(tally.out, 'player')} out`);
  if (tally.doubt > 0) parts.push(`${plural(tally.doubt, 'more')} in doubt`);
  if (parts.length === 0) return null;
  return `${team} have ${parts.join(' and ')}`;
}

/**
 * The squad news as a stated limitation.
 *
 * Deliberately a count and never a valuation. The model has no basis to say
 * what a specific absence is worth — that needs the player's own performance
 * history, which this application does not hold — so this reports who the
 * provider lists and states plainly that the rating cannot account for it.
 * Anything more precise would be the fabrication this file exists to avoid.
 */
export function squadNewsReason(
  homeTeam: string,
  awayTeam: string,
  news: SquadNews,
): string | null {
  const phrases = [
    sidePhrase(homeTeam, squadCount(news.home)),
    sidePhrase(awayTeam, squadCount(news.away)),
  ].filter((phrase): phrase is string => phrase !== null);

  if (phrases.length === 0) return null;
  return `${phrases.join('; ')}. The ratings are built from completed games and cannot account for who is missing.`;
}

export function qualityReasons(
  home: TeamRating | undefined,
  away: TeamRating | undefined,
  config: SportModelConfig,
  extras: {
    hasStandings: boolean;
    hasHeadToHead: boolean;
    /** Null or absent where the provider publishes nothing for the competition. */
    availability?: SquadNews | null;
  },
): string[] {
  const reasons: string[] = [];
  if (!home || !away) return ['No rating could be built for one of the sides.'];

  const thinner = home.games <= away.games ? home : away;

  if (thinner.games < config.minGames) {
    reasons.push(
      `${thinner.team} have only ${thinner.games} completed games on record, below the ${config.minGames} this sport needs.`,
    );
  } else if (thinner.games < config.targetGames) {
    reasons.push(
      `${thinner.team} have ${thinner.games} completed games on record; ${config.targetGames} is where this sport's ratings settle.`,
    );
  }

  // A large imbalance matters on its own: the projection is only as good as
  // the weaker of the two ratings, whatever the stronger one says.
  const gap = Math.abs(home.games - away.games);
  if (gap >= config.targetGames / 2) {
    reasons.push(
      `The two sides have very different amounts of history (${home.games} against ${away.games}), so the comparison is uneven.`,
    );
  }

  if (home.homeAttack === null || away.awayAttack === null) {
    reasons.push('Home and away splits are not yet separable, so venue is modelled from the sport average.');
  }

  if (!extras.hasStandings) {
    reasons.push('No standings table was available to corroborate the ratings.');
  }

  /*
   * Availability, stated as specifically as the provider allows.
   *
   * This line used to be unconditional — "no player-availability data exists
   * for any competition here" — and became untrue the moment injury reporting
   * shipped for the American sports. Three outcomes now, and they are three
   * different claims:
   *
   *   The provider publishes nothing for this competition. The original
   *   sentence, narrowed to the competition it is actually true of.
   *
   *   It publishes a report and lists nobody. No caveat at all: inventing one
   *   to fill the space is what the rest of this function exists not to do.
   *
   *   It lists players. Say who and how many, and say plainly that the rating
   *   cannot account for them.
   */
  if (!extras.availability) {
    reasons.push(
      'No lineup, injury or player-availability data is published for this competition.',
    );
  } else {
    const news = squadNewsReason(home.team, away.team, extras.availability);
    if (news) reasons.push(news);
  }

  return reasons;
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
