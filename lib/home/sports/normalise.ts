/**
 * Pure normalisation of TheSportsDB payloads into the Parlay Projector `Game`
 * contract.
 *
 * No network, no config, no side effects — this is the layer that keeps
 * provider quirks out of the rest of the application, and it is directly
 * unit-testable.
 *
 * Only type-only imports are used here, so the module has no runtime imports.
 */

import type { ConcreteSportId, Game, GameStatus, Team, Venue } from '../types';

/** Shape TheSportsDB actually returns. Every field is treated as untrusted. */
export interface RawEvent {
  idEvent?: unknown;
  strSport?: unknown;
  strLeague?: unknown;
  strLeagueBadge?: unknown;
  strHomeTeam?: unknown;
  strAwayTeam?: unknown;
  idHomeTeam?: unknown;
  idAwayTeam?: unknown;
  strHomeTeamBadge?: unknown;
  strAwayTeamBadge?: unknown;
  strVenue?: unknown;
  strCountry?: unknown;
  strTimestamp?: unknown;
  dateEvent?: unknown;
  strTime?: unknown;
  strStatus?: unknown;
  strPostponed?: unknown;
  // Present on eventsday and lookupevent alike; used by game detail.
  idLeague?: unknown;
  strSeason?: unknown;
  intRound?: unknown;
  strCity?: unknown;
  intHomeScore?: unknown;
  intAwayScore?: unknown;
}

export interface RawEventsResponse {
  /** TheSportsDB returns `null` — not `[]` — when a day has no events. */
  events?: RawEvent[] | null;
}

/** Definition of one supported sport in provider terms. */
export interface SportDefinition {
  id: ConcreteSportId;
  /** `strSport` value used by the provider. */
  providerSport: string;
  /**
   * Optional `strLeague` filter. `nfl` means the NFL specifically, not every
   * American Football league the provider returns for the day.
   */
  leagueFilter?: string;
  label: string;
}

export const SPORT_DEFINITIONS: readonly SportDefinition[] = [
  { id: 'nfl', providerSport: 'American Football', leagueFilter: 'NFL', label: 'NFL' },
  { id: 'nba', providerSport: 'Basketball', leagueFilter: 'NBA', label: 'NBA' },
  { id: 'mlb', providerSport: 'Baseball', leagueFilter: 'MLB', label: 'MLB' },
  { id: 'nhl', providerSport: 'Ice Hockey', leagueFilter: 'NHL', label: 'NHL' },
  { id: 'football', providerSport: 'Soccer', label: 'Football' },
  // The provider exposes Tennis but currently returns no fixtures for it on
  // the configured tier. Kept so the filter is honest and data appears if the
  // provider starts publishing it.
  { id: 'tennis', providerSport: 'Tennis', label: 'Tennis' },
];

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Map a provider status string onto the internal status vocabulary.
 *
 * TheSportsDB uses short codes that differ per sport (`NS`, `FT`, `AOT`, `1H`,
 * `Q3`, ...). Anything unrecognised becomes `unknown` rather than being guessed
 * at, and the raw value is preserved on the game.
 */
export function normaliseStatus(
  rawStatus: unknown,
  postponed?: unknown,
): GameStatus {
  if (str(postponed)?.toLowerCase() === 'yes') return 'postponed';

  const status = str(rawStatus);
  if (!status) return 'scheduled';

  const value = status.toUpperCase();

  if (['NS', 'NOT STARTED', 'TBD', 'SCHEDULED'].includes(value)) return 'scheduled';
  if (['FT', 'AOT', 'AET', 'PEN', 'FINISHED', 'MATCH FINISHED', 'AP'].includes(value)) {
    return 'finished';
  }
  if (['PPD', 'POSTP', 'POSTPONED', 'MATCH POSTPONED'].includes(value)) return 'postponed';
  if (['CANC', 'CANCELLED', 'CANCELED', 'ABD', 'ABANDONED'].includes(value)) {
    return 'cancelled';
  }
  // `P` is a penalty shootout in progress on the live feed; `PEN` above is the
  // finished result after one.
  if (['HT', 'HALF TIME', 'LIVE', 'IN PLAY', 'BT', 'ET', 'P'].includes(value)) return 'live';

  // Period markers: 1H/2H (soccer), Q1-Q4 (NFL/NBA), P1-P3 (NHL), 1I-9I (MLB).
  if (/^(\d+H|Q\d|P\d|\d+(ST|ND|RD|TH)?I?)$/.test(value)) return 'live';

  return 'unknown';
}

/**
 * Build an ISO-8601 UTC instant from the provider's fields.
 *
 * `strTimestamp` looks like `2026-09-01T00:15:00` with no zone designator, but
 * the provider documents it as UTC — so the `Z` is added explicitly rather than
 * letting the runtime apply local time.
 */
export function normaliseStartTime(event: RawEvent): string | null {
  const timestamp = str(event.strTimestamp);
  if (timestamp) {
    const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(timestamp)
      ? timestamp
      : `${timestamp}Z`;
    const parsed = new Date(withZone);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const date = str(event.dateEvent);
  if (date) {
    const time = str(event.strTime) ?? '00:00:00';
    const parsed = new Date(`${date}T${time}Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return null;
}

function team(name: unknown, id: unknown, badge: unknown): Team {
  return {
    id: str(id),
    name: str(name) ?? 'TBC',
    logo: str(badge),
  };
}

function venue(event: RawEvent): Venue {
  return {
    name: str(event.strVenue),
    // The day feed usually omits strCity, so country stands in for locality
    // rather than leaving the line blank.
    city: str(event.strCity) ?? str(event.strCountry),
    country: str(event.strCountry),
  };
}

/**
 * Normalise a single event. Returns null when the payload lacks the minimum
 * needed to be useful, so malformed provider rows are dropped rather than
 * surfacing as broken cards.
 */
export function normaliseEvent(
  event: RawEvent,
  sport: ConcreteSportId,
): Game | null {
  const id = str(event.idEvent);
  if (!id) return null;

  const home = str(event.strHomeTeam);
  const away = str(event.strAwayTeam);
  if (!home && !away) return null;

  return {
    id,
    sport,
    league: str(event.strLeague),
    league_badge: str(event.strLeagueBadge),
    season: str(event.strSeason),
    round: str(event.intRound),
    start_time: normaliseStartTime(event),
    status: normaliseStatus(event.strStatus, event.strPostponed),
    provider_status: str(event.strStatus),
    home_team: team(event.strHomeTeam, event.idHomeTeam, event.strHomeTeamBadge),
    away_team: team(event.strAwayTeam, event.idAwayTeam, event.strAwayTeamBadge),
    venue: venue(event),
    // TheSportsDB exposes no broadcast field; the contract keeps the slot so a
    // future provider can populate it without a frontend change.
    broadcast: null,
  };
}

/**
 * Normalise a full provider response for one sport.
 *
 * Tolerates `events: null`, a missing key, and a non-array value, all of which
 * mean the same thing: no games.
 */
export function normaliseEvents(
  payload: RawEventsResponse | null | undefined,
  definition: SportDefinition,
): Game[] {
  const events = payload?.events;
  if (!Array.isArray(events)) return [];

  const games: Game[] = [];
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;

    if (definition.leagueFilter) {
      const league = str(event.strLeague);
      if (!league || league.toUpperCase() !== definition.leagueFilter.toUpperCase()) {
        continue;
      }
    }

    const game = normaliseEvent(event, definition.id);
    if (game) games.push(game);
  }

  return games;
}

/** Sort by kick-off, with unknown times last, then by id for stability. */
export function sortGames(games: Game[]): Game[] {
  return [...games].sort((a, b) => {
    if (a.start_time && b.start_time) {
      const diff = a.start_time.localeCompare(b.start_time);
      if (diff !== 0) return diff;
    } else if (a.start_time) return -1;
    else if (b.start_time) return 1;
    return a.id.localeCompare(b.id);
  });
}

/** Number of distinct sports represented in a set of games. */
export function countActiveSports(games: Game[]): number {
  return new Set(games.map((game) => game.sport)).size;
}
