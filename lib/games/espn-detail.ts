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
import type { GameDetail, TeamStanding } from './types';

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
    // Matches the finished-game TTL used elsewhere; a settled result is stable.
    6 * 60 * 60_000,
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
    head_to_head: meetingsToRecentGames(meetings, homeName),
    _sources: { game: 'espn' },
  };
}
