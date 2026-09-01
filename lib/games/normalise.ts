/**
 * Pure normalisation for game detail payloads.
 *
 * Status and start-time normalisation are imported from the Home page sports
 * module rather than reimplemented — there is one status vocabulary in this
 * codebase and it lives there.
 *
 * No network, no config, no side effects. Runtime imports are limited to that
 * one shared pure module, so this file is directly unit-testable.
 */

import {
  SPORT_DEFINITIONS,
  normaliseStartTime,
  normaliseStatus,
} from '../home/sports/normalise';
import type { RawEvent } from '../home/sports/normalise';
import type { ConcreteSportId } from '../home/types';
import type {
  FormResult,
  GameDetail,
  RecentGame,
  ScoreLine,
  TeamDetail,
  TeamStanding,
} from './types';

export interface RawTeam {
  idTeam?: unknown;
  strTeam?: unknown;
  strTeamShort?: unknown;
  strBadge?: unknown;
  strStadium?: unknown;
  strLocation?: unknown;
  intFormedYear?: unknown;
}

export interface RawStanding {
  idTeam?: unknown;
  intRank?: unknown;
  intPlayed?: unknown;
  intWin?: unknown;
  intDraw?: unknown;
  intLoss?: unknown;
  intGoalsFor?: unknown;
  intGoalsAgainst?: unknown;
  intGoalDifference?: unknown;
  intPoints?: unknown;
  strForm?: unknown;
  strGroup?: unknown;
}

export function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse an integer field.
 *
 * The provider sends numbers as strings and uses `""` for "no value", so an
 * empty string must become null rather than 0 — a fabricated zero is exactly
 * what the UI must never show.
 */
export function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = str(value);
  if (text === null) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Map the provider's `strSport` onto an internal sport id. */
export function sportFromProvider(rawSport: unknown): ConcreteSportId | null {
  const sport = str(rawSport)?.toLowerCase();
  if (!sport) return null;
  const match = SPORT_DEFINITIONS.find(
    (definition) => definition.providerSport.toLowerCase() === sport,
  );
  return match ? match.id : null;
}

export function normaliseTeam(raw: RawTeam | null | undefined, fallbackName: string): TeamDetail {
  return {
    id: str(raw?.idTeam),
    name: str(raw?.strTeam) ?? fallbackName,
    abbreviation: str(raw?.strTeamShort),
    logo: str(raw?.strBadge),
    stadium: str(raw?.strStadium),
    location: str(raw?.strLocation),
    formed_year: num(raw?.intFormedYear),
  };
}

/** `"DLWLL"` -> `['D','L','W','L','L']`, ignoring anything unrecognised. */
export function parseForm(value: unknown): FormResult[] {
  const text = str(value);
  if (!text) return [];
  const results: FormResult[] = [];
  for (const character of text.toUpperCase()) {
    if (character === 'W' || character === 'D' || character === 'L') {
      results.push(character);
    }
  }
  return results;
}

export function normaliseStanding(raw: RawStanding | null | undefined): TeamStanding | null {
  if (!raw || typeof raw !== 'object') return null;

  const standing: TeamStanding = {
    rank: num(raw.intRank),
    played: num(raw.intPlayed),
    wins: num(raw.intWin),
    draws: num(raw.intDraw),
    losses: num(raw.intLoss),
    goals_for: num(raw.intGoalsFor),
    goals_against: num(raw.intGoalsAgainst),
    goal_difference: num(raw.intGoalDifference),
    points: num(raw.intPoints),
    form: parseForm(raw.strForm),
    group: str(raw.strGroup),
  };

  // A row where nothing parsed is worse than no row: it would render as a
  // table of dashes implying data we do not have.
  const hasAnything =
    standing.rank !== null ||
    standing.played !== null ||
    standing.wins !== null ||
    standing.form.length > 0;

  return hasAnything ? standing : null;
}

/** Find one team's row in a league table. */
export function findStanding(
  table: readonly RawStanding[] | null | undefined,
  teamId: string | null,
): TeamStanding | null {
  if (!Array.isArray(table) || !teamId) return null;
  const row = table.find((entry) => str(entry?.idTeam) === teamId);
  return row ? normaliseStanding(row) : null;
}

/**
 * Score for the game.
 *
 * Returns null unless the game has actually started, so a scheduled game can
 * never display 0-0.
 */
export function normaliseScore(event: RawEvent, status: string): ScoreLine | null {
  if (status !== 'live' && status !== 'finished') return null;

  const home = num(event.intHomeScore);
  const away = num(event.intAwayScore);
  if (home === null && away === null) return null;

  return { home, away };
}

/** Result of a finished game from one team's point of view. */
export function resultFor(
  teamScore: number | null,
  opponentScore: number | null,
): FormResult | null {
  if (teamScore === null || opponentScore === null) return null;
  if (teamScore > opponentScore) return 'W';
  if (teamScore < opponentScore) return 'L';
  return 'D';
}

/**
 * Normalise a team's recent games, from that team's perspective.
 *
 * `limit` keeps this a summary rather than a results archive.
 */
export function normaliseRecentGames(
  events: readonly RawEvent[] | null | undefined,
  teamId: string | null,
  limit = 5,
): RecentGame[] {
  if (!Array.isArray(events) || !teamId) return [];

  const games: RecentGame[] = [];
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;

    const id = str(event.idEvent);
    if (!id) continue;

    const homeId = str(event.idHomeTeam);
    const awayId = str(event.idAwayTeam);
    if (homeId !== teamId && awayId !== teamId) continue;

    const isHome = homeId === teamId;
    const homeScore = num(event.intHomeScore);
    const awayScore = num(event.intAwayScore);

    const teamScore = isHome ? homeScore : awayScore;
    const opponentScore = isHome ? awayScore : homeScore;
    const opponent = isHome ? str(event.strAwayTeam) : str(event.strHomeTeam);

    games.push({
      id,
      date: str(event.dateEvent),
      opponent: opponent ?? 'Unknown',
      home: isHome,
      team_score: teamScore,
      opponent_score: opponentScore,
      result: resultFor(teamScore, opponentScore),
    });

    if (games.length >= limit) break;
  }

  return games;
}

/**
 * Live clock / period text.
 *
 * The provider has no dedicated live-clock field, so the raw status code is
 * surfaced only while a game is actually live. Nothing is invented.
 */
export function normaliseGameState(status: string, providerStatus: string | null): string | null {
  return status === 'live' ? providerStatus : null;
}

export interface GameDetailInput {
  event: RawEvent;
  homeTeam?: RawTeam | null;
  awayTeam?: RawTeam | null;
  table?: readonly RawStanding[] | null;
  homeRecent?: readonly RawEvent[] | null;
  awayRecent?: readonly RawEvent[] | null;
}

/**
 * Assemble the full game detail from the provider payloads.
 *
 * Returns null when the event lacks the minimum to be a real game, which is how
 * an unknown id becomes a 404 rather than a page of blanks.
 */
export function normaliseGameDetail(input: GameDetailInput): GameDetail | null {
  const { event } = input;

  const id = str(event.idEvent);
  if (!id) return null;

  const homeName = str(event.strHomeTeam);
  const awayName = str(event.strAwayTeam);
  if (!homeName && !awayName) return null;

  const sport = sportFromProvider(event.strSport);
  if (!sport) return null;

  const status = normaliseStatus(event.strStatus, event.strPostponed);
  const providerStatus = str(event.strStatus);

  const homeTeam = normaliseTeam(input.homeTeam, homeName ?? 'TBC');
  const awayTeam = normaliseTeam(input.awayTeam, awayName ?? 'TBC');

  // The event payload carries the authoritative ids; team lookups may fail.
  homeTeam.id = str(event.idHomeTeam) ?? homeTeam.id;
  awayTeam.id = str(event.idAwayTeam) ?? awayTeam.id;
  homeTeam.logo = homeTeam.logo ?? str(event.strHomeTeamBadge);
  awayTeam.logo = awayTeam.logo ?? str(event.strAwayTeamBadge);

  return {
    id,
    sport,
    league: str(event.strLeague),
    league_badge: str(event.strLeagueBadge),
    season: str(event.strSeason),
    round: str(event.intRound),
    start_time: normaliseStartTime(event),
    status,
    provider_status: providerStatus,
    home_team: homeTeam,
    away_team: awayTeam,
    venue: {
      name: str(event.strVenue),
      city: str(event.strCity) ?? str(event.strCountry),
    },
    score: normaliseScore(event, status),
    game_state: normaliseGameState(status, providerStatus),
    broadcast: null,
    standings: {
      home: findStanding(input.table, homeTeam.id),
      away: findStanding(input.table, awayTeam.id),
    },
    recent_games: {
      home: normaliseRecentGames(input.homeRecent, homeTeam.id),
      away: normaliseRecentGames(input.awayRecent, awayTeam.id),
    },
    head_to_head: [],
  };
}

/** Provider ids are digit strings; reject anything else before making a call. */
export function isValidGameId(raw: string | null | undefined): boolean {
  if (typeof raw !== 'string') return false;
  return /^[0-9]{1,20}$/.test(raw.trim());
}
