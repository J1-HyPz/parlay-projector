/**
 * Pure normalisation of ESPN's public scoreboard payloads.
 *
 * Two responsibilities beyond the usual shaping:
 *
 * 1. **Odds are stripped.** ESPN includes `odds`, `pickcenter` and `hasOdds`
 *    on every competition. Parlay Projector is a sports-information product,
 *    so those fields are dropped here at the boundary and never enter the
 *    application's models. There is a test asserting this.
 *
 * 2. **Nothing is fabricated.** A field ESPN omits stays null; it is never
 *    defaulted to 0, an empty record or a placeholder name.
 *
 * No network, no config — directly unit-testable.
 */

import type { FormResult } from '../../games/types';

/** Fields that must never survive normalisation. */
export const BETTING_FIELDS = ['odds', 'pickcenter', 'hasOdds', 'ticketsInfo'] as const;

export interface RawEspnCompetitor {
  homeAway?: unknown;
  team?: {
    id?: unknown;
    displayName?: unknown;
    shortDisplayName?: unknown;
    abbreviation?: unknown;
    logo?: unknown;
  };
  records?: { type?: unknown; summary?: unknown }[];
  form?: unknown;
  statistics?: unknown[];
}

export interface RawEspnEvent {
  id?: unknown;
  date?: unknown;
  name?: unknown;
  status?: { type?: { name?: unknown; completed?: unknown } };
  /**
   * Untrusted provider payload. The index signature is deliberate: real
   * responses carry `odds`, `pickcenter` and `hasOdds`, which `stripBetting`
   * removes here at the boundary.
   */
  competitions?: ({
    venue?: { fullName?: unknown; address?: { city?: unknown; country?: unknown } };
    broadcasts?: { names?: unknown[] }[];
    competitors?: RawEspnCompetitor[];
  } & Record<string, unknown>)[];
}

export interface RawEspnScoreboard {
  events?: RawEspnEvent[] | null;
}

function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Remove betting fields from any object before it enters the application.
 *
 * Applied at the adapter boundary so no downstream code can accidentally read
 * an odds field that "happened to be there".
 */
export function stripBetting<T extends Record<string, unknown>>(value: T): T {
  const clean: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if ((BETTING_FIELDS as readonly string[]).includes(key)) continue;
    clean[key] = entry;
  }
  return clean as T;
}

/** ESPN team side, normalised. */
export interface EspnTeamSide {
  id: string | null;
  name: string | null;
  abbreviation: string | null;
  logo: string | null;
  /** Season record summary, e.g. `11-2` or `1-0-1`. Null when absent. */
  record: string | null;
  /** Most recent results, newest first. Empty when absent. */
  form: FormResult[];
}

export interface EspnGame {
  id: string;
  /** ISO-8601 instant. */
  date: string | null;
  /** Calendar date (YYYY-MM-DD) in the given timezone, for matching. */
  matchDate: string | null;
  home: EspnTeamSide | null;
  away: EspnTeamSide | null;
  venue: { name: string | null; city: string | null; country: string | null };
  broadcast: string | null;
}

/** `LWWWD` -> `['L','W','W','W','D']`, ignoring anything unrecognised. */
export function parseForm(value: unknown): FormResult[] {
  const text = str(value);
  if (!text) return [];
  const results: FormResult[] = [];
  for (const character of text.toUpperCase()) {
    if (character === 'W' || character === 'D' || character === 'L') results.push(character);
  }
  return results;
}

/** Prefer the overall record; ESPN also ships home/away splits. */
export function overallRecord(records: RawEspnCompetitor['records']): string | null {
  if (!Array.isArray(records)) return null;
  const total = records.find((entry) => str(entry?.type) === 'total');
  return str(total?.summary) ?? str(records[0]?.summary);
}

function competitor(raw: RawEspnCompetitor | undefined): EspnTeamSide | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: str(raw.team?.id),
    name: str(raw.team?.displayName) ?? str(raw.team?.shortDisplayName),
    abbreviation: str(raw.team?.abbreviation),
    logo: str(raw.team?.logo),
    record: overallRecord(raw.records),
    form: parseForm(raw.form),
  };
}

/** Calendar date for an ISO instant, in the given timezone. */
export function calendarDate(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function normaliseEvent(raw: RawEspnEvent, timeZone: string): EspnGame | null {
  if (!raw || typeof raw !== 'object') return null;

  const id = str(raw.id);
  if (!id) return null;

  // Drop betting fields before reading anything else out of the competition.
  const rawCompetition = Array.isArray(raw.competitions) ? raw.competitions[0] : undefined;
  const competition = rawCompetition
    ? stripBetting(rawCompetition as unknown as Record<string, unknown>)
    : undefined;

  const competitors = (competition?.competitors as RawEspnCompetitor[] | undefined) ?? [];
  const home = competitor(competitors.find((c) => str(c?.homeAway) === 'home'));
  const away = competitor(competitors.find((c) => str(c?.homeAway) === 'away'));
  if (!home && !away) return null;

  const date = str(raw.date);
  // `competition` is a plain record after stripping, so the shape is asserted
  // once here; every field read from it is still null-guarded by `str`.
  const venue = competition?.venue as
    | { fullName?: unknown; address?: { city?: unknown; country?: unknown } }
    | undefined;

  const broadcasts = (competition?.broadcasts as { names?: unknown[] }[] | undefined) ?? [];
  const broadcastName = broadcasts
    .flatMap((entry) => (Array.isArray(entry?.names) ? entry.names : []))
    .map((name) => str(name))
    .find((name): name is string => name !== null);

  return {
    id,
    date,
    matchDate: calendarDate(date, timeZone),
    home,
    away,
    venue: {
      name: str(venue?.fullName),
      city: str(venue?.address?.city),
      country: str(venue?.address?.country),
    },
    broadcast: broadcastName ?? null,
  };
}

export function normaliseScoreboard(
  payload: RawEspnScoreboard | null | undefined,
  timeZone: string,
): EspnGame[] {
  const events = payload?.events;
  if (!Array.isArray(events)) return [];

  const games: EspnGame[] = [];
  for (const event of events) {
    const game = normaliseEvent(event, timeZone);
    if (game) games.push(game);
  }
  return games;
}

// ---------------------------------------------------------------------------
// Head to head, from the summary endpoint
// ---------------------------------------------------------------------------

export interface RawSeasonSeriesEvent {
  id?: unknown;
  date?: unknown;
  competitors?: { team?: { displayName?: unknown }; score?: unknown; homeAway?: unknown }[];
}

export interface EspnMeeting {
  id: string;
  date: string | null;
  home: string | null;
  away: string | null;
  homeScore: number | null;
  awayScore: number | null;
}

function int(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = str(value);
  if (text === null) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Previous meetings from `seasonseries`.
 *
 * ESPN nests these a few levels deep and the shape varies by sport, so
 * anything that does not parse cleanly is dropped rather than half-rendered.
 */
export function normaliseSeasonSeries(
  payload: { seasonseries?: { events?: RawSeasonSeriesEvent[] }[] } | null | undefined,
  limit = 5,
): EspnMeeting[] {
  const series = payload?.seasonseries;
  if (!Array.isArray(series)) return [];

  const meetings: EspnMeeting[] = [];
  for (const entry of series) {
    const events = Array.isArray(entry?.events) ? entry.events : [];
    for (const event of events) {
      const id = str(event?.id);
      if (!id) continue;

      const competitors = Array.isArray(event?.competitors) ? event.competitors : [];
      const home = competitors.find((c) => str(c?.homeAway) === 'home');
      const away = competitors.find((c) => str(c?.homeAway) === 'away');

      meetings.push({
        id,
        date: str(event?.date),
        home: str(home?.team?.displayName),
        away: str(away?.team?.displayName),
        homeScore: int(home?.score),
        awayScore: int(away?.score),
      });

      if (meetings.length >= limit) return meetings;
    }
  }
  return meetings;
}
