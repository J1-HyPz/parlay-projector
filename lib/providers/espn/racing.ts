/**
 * Motorsport fixtures.
 *
 * A Grand Prix is not a fixture between two sides. It is a weekend of sessions
 * — three practices, qualifying, the race — each contested by the whole field,
 * finishing in order. None of that fits `home_team` against `away_team`, so
 * none of it is forced into that shape: these produce `Game` records carrying
 * `entrants` and a `session` instead, which the shared domain now allows.
 *
 * One `Game` per session rather than one per weekend. Sessions run on different
 * days and have their own start times and statuses, so a day-based schedule
 * needs them separately — and a reader looking at a Saturday wants to see
 * qualifying, not a race two days away.
 *
 * Identity is the *session*, not the weekend, for the same reason. ESPN's
 * competition ids are unique and numeric, which is what the shared game-id
 * parser requires.
 *
 * Pure: no network, no configuration, directly unit-testable.
 */

import { espnGameId, statusFromEspn } from './fixture-normalise.ts';
import type { League } from '../../leagues/registry';
import type { Entrant, Game } from '../../home/types';

function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function positiveInt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }
  if (typeof value !== 'string') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// ---------------------------------------------------------------------------
// The untrusted payload
// ---------------------------------------------------------------------------

interface RawAthlete {
  id?: unknown;
  displayName?: unknown;
  fullName?: unknown;
  shortName?: unknown;
  flag?: { href?: unknown } | null;
}

interface RawRacer {
  id?: unknown;
  order?: unknown;
  winner?: unknown;
  athlete?: RawAthlete | null;
  team?: { displayName?: unknown; name?: unknown } | null;
}

interface RawSession {
  id?: unknown;
  date?: unknown;
  startDate?: unknown;
  type?: { abbreviation?: unknown; text?: unknown } | null;
  status?: { type?: { name?: unknown; state?: unknown; completed?: unknown; shortDetail?: unknown } } | null;
  competitors?: RawRacer[] | null;
  broadcasts?: { names?: unknown[] }[] | null;
  venue?: { fullName?: unknown; address?: { city?: unknown; country?: unknown } } | null;
}

export interface RawRaceEvent {
  id?: unknown;
  date?: unknown;
  name?: unknown;
  shortName?: unknown;
  season?: { year?: unknown } | null;
  circuit?: {
    fullName?: unknown;
    address?: { city?: unknown; country?: unknown };
  } | null;
  competitions?: RawSession[] | null;
  status?: { type?: { name?: unknown; state?: unknown; completed?: unknown } } | null;
}

export interface RawRaceResponse {
  events?: RawRaceEvent[] | null;
}

// ---------------------------------------------------------------------------
// Session naming
// ---------------------------------------------------------------------------

/**
 * Readable session names.
 *
 * The provider abbreviates. `FP1` is clear to someone who follows the sport and
 * opaque to someone who does not, and this application is meant to be readable
 * by both.
 */
const SESSION_NAMES: Record<string, string> = {
  FP1: 'Practice 1',
  FP2: 'Practice 2',
  FP3: 'Practice 3',
  Qual: 'Qualifying',
  SS: 'Sprint Shootout',
  Sprint: 'Sprint',
  Race: 'Race',
};

export function sessionName(abbreviation: string | null, fallback: string | null): string | null {
  if (abbreviation && SESSION_NAMES[abbreviation]) return SESSION_NAMES[abbreviation];
  return fallback ?? abbreviation;
}

/** Whether this session is the Grand Prix itself, as opposed to a support session. */
export function isRaceSession(abbreviation: string | null): boolean {
  return abbreviation === 'Race';
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function toEntrant(racer: RawRacer): Entrant | null {
  const athlete = racer.athlete;
  const name = str(athlete?.displayName) ?? str(athlete?.fullName) ?? str(athlete?.shortName);
  if (!name) return null;

  return {
    id: str(athlete?.id) ?? str(racer.id),
    name,
    // The provider names a constructor on some payloads and not others. Absent
    // rather than guessed.
    affiliation: str(racer.team?.displayName) ?? str(racer.team?.name),
    position: positiveInt(racer.order),
    logo: str(athlete?.flag?.href),
  };
}

/**
 * One session, as a `Game`.
 *
 * Returns null when the session has no readable identity or no field — an
 * empty session is not a fixture, and inventing entrants for one would be
 * fabrication.
 */
export function normaliseSession(
  event: RawRaceEvent,
  session: RawSession,
  league: League,
): Game | null {
  const sessionId = str(session.id);
  if (!sessionId) return null;

  const title = str(event.name) ?? str(event.shortName);
  if (!title) return null;

  const abbreviation = str(session.type?.abbreviation);
  const date = str(session.date) ?? str(session.startDate) ?? str(event.date);
  const startTime = date ? new Date(date) : null;

  const entrants = (session.competitors ?? [])
    .map(toEntrant)
    .filter((entrant): entrant is Entrant => entrant !== null);

  const status = statusFromEspn(session.status?.type ?? undefined);

  const broadcast = (session.broadcasts ?? [])
    .flatMap((entry) => (Array.isArray(entry?.names) ? entry.names : []))
    .map((name) => str(name))
    .find((name): name is string => name !== null);

  const circuit = event.circuit;

  return {
    id: espnGameId(league.id, sessionId),
    sport: league.sport,
    // The catalogue label, not the provider's, so the UI is consistent.
    league: league.label,
    league_badge: null,
    season: str(event.season?.year),
    round: null,
    start_time: startTime && !Number.isNaN(startTime.getTime()) ? startTime.toISOString() : null,
    status,
    provider_status: str(session.status?.type?.shortDetail) ?? str(session.status?.type?.name),
    // No sides, deliberately. A race has a field, and the shared domain now
    // says so rather than nominating two of the twenty.
    entrants,
    session: sessionName(abbreviation, str(session.type?.text)),
    title,
    venue: {
      name: str(circuit?.fullName) ?? str(session.venue?.fullName),
      city: str(circuit?.address?.city) ?? str(session.venue?.address?.city),
      country: str(circuit?.address?.country) ?? str(session.venue?.address?.country),
    },
    broadcast: broadcast ?? null,
  };
}

/** Every session across every event in a scoreboard payload. */
export function normaliseRaceFixtures(payload: RawRaceResponse, league: League): Game[] {
  const games: Game[] = [];

  for (const event of payload.events ?? []) {
    for (const session of event.competitions ?? []) {
      const game = normaliseSession(event, session, league);
      if (game) games.push(game);
    }
  }

  return games;
}

/**
 * The Grand Prix itself, one per weekend.
 *
 * Used where practice and qualifying would be noise — the projection engine
 * only has an opinion about the race, and a homepage list of today's sport does
 * not want three practice sessions.
 */
export function raceSessionsOnly(payload: RawRaceResponse, league: League): Game[] {
  const games: Game[] = [];

  for (const event of payload.events ?? []) {
    for (const session of event.competitions ?? []) {
      if (!isRaceSession(str(session.type?.abbreviation))) continue;
      const game = normaliseSession(event, session, league);
      if (game) games.push(game);
    }
  }

  return games;
}
