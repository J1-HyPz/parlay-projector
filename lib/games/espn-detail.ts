/**
 * Game detail for ESPN-sourced fixtures.
 *
 * Schedule and Home emit `espn-<leagueId>-<eventId>` ids, so those pages' links need a
 * detail path that resolves against ESPN rather than the primary provider.
 *
 * Uses the summary endpoint, which carries the header (teams, score, status,
 * venue), team records and form, and previous meetings — everything the detail
 * page renders, in one request.
 *
 * Betting fields are stripped: the summary includes `odds` and `pickcenter`,
 * and neither belongs in this application.
 */

import { cached } from '../cache';
import { espnConfig } from '../config';
import { logger } from '../logger';
import { fetchEspn } from '../providers/espn/client';
import { parseEspnGameId, statusFromEspn } from '../providers/espn/fixtures';
import { normaliseSeasonSeries, parseForm, overallRecord } from '../providers/espn/normalise';
import { meetingsToRecentGames, recordToStanding, standingFromForm } from '../providers/merge';
import { findLeague } from '../leagues/registry';
import { fixtureAvailability, probablesFromSummary } from './availability-normalise';
import type { RawAvailabilitySummary } from './availability-normalise';
import { leagueAvailability } from '../providers/espn/availability';
import { leagueHistory } from '../history/store';
import { meetingsBetween, summariseMeetings } from '../history/head-to-head';
import type { Meeting } from '../history/head-to-head';
import type { GameDetail, RecentGame, TeamStanding } from './types';

interface RawCompetitor {
  id?: unknown;
  homeAway?: unknown;
  score?: unknown;
  record?: { type?: unknown; summary?: unknown; displayValue?: unknown }[];
  team?: {
    id?: unknown;
    displayName?: unknown;
    abbreviation?: unknown;
    logo?: unknown;
    logos?: { href?: unknown }[];
    venue?: { fullName?: unknown };
    location?: unknown;
  };
  form?: unknown;
}

interface RawSummary {
  header?: {
    id?: unknown;
    season?: { year?: unknown };
    week?: unknown;
    league?: { slug?: unknown; name?: unknown };
    competitions?: {
      date?: unknown;
      status?: { type?: { name?: unknown; state?: unknown; completed?: unknown; shortDetail?: unknown } };
      competitors?: RawCompetitor[];
    }[];
  };
  gameInfo?: {
    venue?: { fullName?: unknown; address?: { city?: unknown; country?: unknown } };
  };
  broadcasts?: { media?: { shortName?: unknown } }[];
  seasonseries?: { events?: unknown[] }[];
  /*
   * The same response already carries the fixture's injury report, and for
   * baseball the probable starting pitchers on each competitor. Typed loosely
   * here and read by the availability normaliser, which owns their shape.
   */
  injuries?: unknown;
}

function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = str(value);
  if (text === null) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function standingFor(raw: RawCompetitor | undefined): TeamStanding | null {
  if (!raw) return null;
  const record = overallRecord(
    raw.record as { type?: unknown; summary?: unknown }[] | undefined,
  );
  const form = parseForm(raw.form);
  return recordToStanding(record, null) ?? standingFromForm(form);
}

/**
 * Identity of a meeting, across two sources that number it differently.
 *
 * The archive stores this application's own id — `espn-epl-740911` — while the
 * provider's season series returns the bare event id, `740911`. They are the
 * same fixture, and de-duplicating on the whole string silently showed every
 * recent meeting twice. The trailing segment is the provider's event id in
 * both forms.
 *
 * Deliberately not the date: two given sides cannot usually meet twice in a
 * day, but a baseball double-header is exactly that, and collapsing one would
 * lose a real result.
 */
function meetingKey(id: string): string {
  const parts = id.split('-');
  return parts[parts.length - 1] || id;
}

/**
 * The provider's meetings plus the archive's, newest first.
 *
 * The provider's entries win a tie: they are the same fixture, and its version
 * is the one the rest of this page was built from.
 */
function mergeMeetings(
  provider: RecentGame[],
  archivedMeetings: readonly Meeting[],
  homeName: string | null,
): RecentGame[] {
  if (!homeName) return provider;
  const byId = new Map(provider.map((game) => [meetingKey(game.id), game]));

  for (const meeting of archivedMeetings) {
    if (byId.has(meetingKey(meeting.id))) continue;
    const atHome = meeting.home.toLowerCase() === homeName.toLowerCase();
    const own = atHome ? meeting.home_score : meeting.away_score;
    const other = atHome ? meeting.away_score : meeting.home_score;

    byId.set(meetingKey(meeting.id), {
      id: meeting.id,
      date: meeting.date,
      opponent: atHome ? meeting.away : meeting.home,
      home: atHome,
      team_score: own,
      opponent_score: other,
      result: own > other ? 'W' : own < other ? 'L' : 'D',
    });
  }

  return [...byId.values()].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

/** Detail for one ESPN fixture. Returns null when ESPN has no such event. */
export async function espnGameDetail(gameId: string): Promise<GameDetail | null> {
  if (!espnConfig.enabled) return null;

  const parsed = parseEspnGameId(gameId);
  if (!parsed) return null;

  const league = findLeague(parsed.leagueId);
  // An `espn-` prefixed id can only belong to an ESPN-served competition, but
  // the path is checked rather than assumed.
  const espnPath = league?.espnPath;
  if (!league || !espnPath) return null;

  const { value } = await cached(
    `espn:detail:${league.id}:${parsed.eventId}`,
    // Do not pin upcoming/live state for six hours inside the outer status cache.
    (summary: RawSummary | null) => {
      const state = statusFromEspn(summary?.header?.competitions?.[0]?.status?.type);
      return state === 'finished' ? 6 * 60 * 60_000 : 60_000;
    },
    async () => {
      const summary = await fetchEspn<RawSummary>(
        `${espnPath}/summary`,
        `event=${encodeURIComponent(parsed.eventId)}`,
      );
      return summary?.header?.id ? summary : null;
    },
  );

  if (!value) {
    logger.info('espn_detail_not_found', { league: league.id, event: parsed.eventId });
    return null;
  }

  /*
   * Cached for fifteen minutes per competition and shared with the projection
   * pipeline, which reads the same report — so on a warm cache this is free,
   * and on a cold one it is a single request rather than one per fixture.
   */
  const [report, archived] = await Promise.all([
    leagueAvailability(league),
    // Files already on disk; no provider call. Empty until a backfill has run
    // for this competition.
    leagueHistory(league.id),
  ]);

  const summary = value;
  const header = summary.header;
  const competition = Array.isArray(header?.competitions) ? header.competitions[0] : undefined;
  const competitors = competition?.competitors ?? [];

  const home = competitors.find((c) => str(c?.homeAway) === 'home');
  const away = competitors.find((c) => str(c?.homeAway) === 'away');

  const homeName = str(home?.team?.displayName);
  const awayName = str(away?.team?.displayName);
  if (!homeName && !awayName) return null;

  const status = statusFromEspn(competition?.status?.type);
  const started = status === 'live' || status === 'finished';

  const date = str(competition?.date);
  const startTime = date ? new Date(date) : null;

  const meetings = normaliseSeasonSeries(summary as never);

  /*
   * Previous meetings, as deep as the archive goes.
   *
   * The provider's own `seasonseries` covers the *current season only* — one
   * to four games, and in August often none at all. The archive answers the
   * same question across every season it holds, for no provider call, because
   * the files are already there.
   *
   * The two sources are merged rather than one replacing the other: the
   * provider still knows about a meeting from this season that a backfill run
   * last month cannot. De-duplicated on fixture id, which both sources carry.
   */
  const homeRef = { id: str(home?.team?.id), name: homeName ?? '' };
  const awayRef = { id: str(away?.team?.id), name: awayName ?? '' };
  const archivedMeetings =
    homeRef.name && awayRef.name ? meetingsBetween(archived, homeRef, awayRef) : [];
  const venue = summary.gameInfo?.venue;
  const broadcast = (summary.broadcasts ?? [])
    .map((entry) => str(entry?.media?.shortName))
    .find((name): name is string => name !== null);

  return {
    id: gameId,
    sport: league.sport,
    league: league.label,
    league_badge: null,
    season: str(header?.season?.year),
    round: str(header?.week),
    start_time:
      startTime && !Number.isNaN(startTime.getTime()) ? startTime.toISOString() : null,
    status,
    provider_status: str(competition?.status?.type?.shortDetail),
    home_team: {
      id: str(home?.team?.id),
      name: homeName ?? 'TBC',
      abbreviation: str(home?.team?.abbreviation),
      logo: str(home?.team?.logo) ?? str(home?.team?.logos?.[0]?.href),
      stadium: str(home?.team?.venue?.fullName),
      location: str(home?.team?.location),
      formed_year: null,
    },
    away_team: {
      id: str(away?.team?.id),
      name: awayName ?? 'TBC',
      abbreviation: str(away?.team?.abbreviation),
      logo: str(away?.team?.logo) ?? str(away?.team?.logos?.[0]?.href),
      stadium: str(away?.team?.venue?.fullName),
      location: str(away?.team?.location),
      formed_year: null,
    },
    venue: {
      name: str(venue?.fullName),
      city: str(venue?.address?.city),
      country: str(venue?.address?.country),
    },
    // A scheduled fixture never shows a score.
    score: started ? { home: num(home?.score), away: num(away?.score) } : null,
    game_state: status === 'live' ? str(competition?.status?.type?.shortDetail) : null,
    broadcast: broadcast ?? null,
    standings: { home: standingFor(home), away: standingFor(away) },
    recent_games: { home: [], away: [] },
    head_to_head: mergeMeetings(meetingsToRecentGames(meetings, homeName), archivedMeetings, homeName),
    head_to_head_record:
      archivedMeetings.length > 0 || archived.length > 0
        ? summariseMeetings(archivedMeetings, homeRef)
        : null,
    /*
     * Injuries from the competition-wide report, starters from the payload
     * above — see `fixtureAvailability` for why they come from different
     * places. Attribution is by the provider's own team ids, taken from the
     * same competitors the header was read from, so an absence cannot land on
     * the wrong side of the fixture.
     */
    availability: fixtureAvailability(
      report,
      probablesFromSummary(summary as RawAvailabilitySummary),
      str(home?.team?.id),
      str(away?.team?.id),
    ),
    _sources: { game: 'espn' },
  };
}
