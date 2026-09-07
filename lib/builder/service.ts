import { cached } from '../cache';
import { builderOddsConfig, oddsConfig } from '../config';
import { getJson } from '../http';
import { getGameDetail } from '../games/service';
import { isValidGameId } from '../games/normalise';
import { parseEspnGameId } from '../providers/espn/fixtures';
import { LEAGUES } from '../leagues/registry';
import { bootstrapProviders, withFallback } from '../providers';
import {
  matchOddsEvent,
  normaliseBuilderOdds,
  ODDS_SPORTS,
} from './odds-normalise.ts';
import type { RawOddsEvent } from './odds-normalise.ts';
import type {
  BuilderEvent,
  MarketResponse,
  OddsProvider,
  LegEvidence,
} from './types.ts';

function unavailable(
  message: string,
  event: BuilderEvent | null = null,
): MarketResponse {
  return {
    event,
    provider: 'the-odds-api',
    selections: [],
    fetchedAt: new Date().toISOString(),
    stale: false,
    message,
  };
}

const theOddsApi: OddsProvider = {
  id: 'the-odds-api',
  async markets(gameId) {
    const detail = await getGameDetail(gameId);
    if (detail.kind !== 'ok')
      return unavailable(
        detail.kind === 'not_found'
          ? 'Match not found.'
          : 'Match details are unavailable; odds cannot be matched reliably.',
      );
    const game = detail.game;
    const event: BuilderEvent = {
      id: game.id,
      providerEventId: '',
      sport: game.sport,
      competition: game.league ?? game.sport,
      name: `${game.away_team.name} v ${game.home_team.name}`,
      home: game.home_team.name,
      away: game.away_team.name,
      startTime: game.start_time,
      status:
        game.status === 'scheduled'
          ? 'prematch'
          : game.status === 'live'
            ? 'live'
            : game.status === 'unknown'
              ? 'unknown'
              : 'closed',
    };
    if (event.status === 'closed' || event.status === 'unknown')
      return unavailable(
        'This event is closed, postponed, or its status cannot be verified.',
        event,
      );
    // The core odds endpoint does not identify in-play quote status. Never relabel a pre-match price as live.
    if (
      event.status === 'live' ||
      Date.parse(event.startTime ?? '') <= Date.now()
    )
      return unavailable(
        'In-play odds are unavailable: this adapter cannot verify the live status of an individual quote.',
        event,
      );
    const leagueId =
      parseEspnGameId(gameId)?.leagueId ??
      LEAGUES.find(
        (l) =>
          l.sport === game.sport &&
          [l.label, l.shortLabel].includes(game.league ?? ''),
      )?.id;
    const sportKey = leagueId ? ODDS_SPORTS[leagueId] : undefined;
    if (!sportKey)
      return unavailable(
        'No supported odds competition mapping. Markets, including tennis and player props, are unavailable for this event.',
        event,
      );
    const { value } = await cached(
      `builder:odds:${sportKey}:${builderOddsConfig.region}`,
      builderOddsConfig.cacheTtlMs,
      async () => {
        const params = new URLSearchParams({
          apiKey: builderOddsConfig.apiKey,
          regions: builderOddsConfig.region,
          markets: 'h2h,spreads,totals',
          oddsFormat: 'decimal',
          dateFormat: 'iso',
        });
        const payload = await getJson<RawOddsEvent[]>(
          `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?${params}`,
          {
            timeoutMs: 8000,
            redactSecret: builderOddsConfig.apiKey,
          },
        );
        if (!Array.isArray(payload)) throw new Error('Invalid odds response');
        return { payload, fetchedAt: new Date().toISOString() };
      },
    );
    const stale =
      Date.now() - Date.parse(value.fetchedAt) >= builderOddsConfig.cacheTtlMs;
    const match = matchOddsEvent(event, value.payload, sportKey);
    if (!match)
      return {
        ...unavailable(
          'No unambiguous provider event match. Team names and start time must agree; no bets have been inferred.',
          event,
        ),
        fetchedAt: value.fetchedAt,
        stale,
      };
    const selections = normaliseBuilderOdds(
      match,
      event,
      value.fetchedAt,
      builderOddsConfig.maxAgeMs,
    );
    return {
      event: { ...event, providerEventId: match.id as string },
      provider: 'the-odds-api',
      selections,
      fetchedAt: value.fetchedAt,
      stale,
      message: stale
        ? 'Provider refresh failed. Cached odds are stale and cannot be used.'
        : selections.length
          ? 'Bookmaker settlement rules and combination acceptance must be checked with the bookmaker. In-play, props and extra markets are not supported by this adapter.'
          : 'No priced core markets currently returned by the provider.',
    };
  },
};

/** Explicit adapter dispatch: never call a different provider under a fallback descriptor. */
const adapters: Record<string, OddsProvider> = { 'the-odds-api': theOddsApi };

export async function getBuilderMarkets(
  gameId: string,
): Promise<MarketResponse> {
  if (!isValidGameId(gameId)) return unavailable('Invalid match identifier.');
  if (!oddsConfig.enabled)
    return unavailable('Odds are disabled by ODDS_ENABLED.');
  if (!builderOddsConfig.apiKey)
    return unavailable(
      'Builder markets unavailable. Configure BUILDER_ODDS_API_KEY on the server to connect The Odds API. The existing sports feed cannot verify current bet availability.',
    );
  bootstrapProviders();
  const result = await withFallback(
    'betting_markets',
    (descriptor) =>
      adapters[descriptor.id]?.markets(gameId) ?? Promise.resolve(null),
  );
  return (
    result?.value ??
    unavailable(
      'Odds provider unavailable or cooling down after a failed request. Retry later; no reference prices have been substituted.',
    )
  );
}

export async function getBuilderEvidence(gameId: string): Promise<LegEvidence> {
  const fetchedAt = new Date().toISOString();
  const gaps = [
    'Confirmed lineups are unavailable.',
    'Injury data and player prop statistics are unavailable.',
    'No calibrated probability model is connected to these exact provider selections.',
  ];
  const detail = await getGameDetail(gameId);
  if (detail.kind !== 'ok')
    return {
      gameId,
      facts: [],
      gaps: ['Team details could not be loaded.', ...gaps],
      fetchedAt,
    };
  const game = detail.game;
  const facts: string[] = [
    `Match status: ${game.status}. Information supplied by ${game._sources?.game ?? 'the sports provider'}; cached game details may lag live changes.`,
  ];
  for (const side of ['home', 'away'] as const) {
    const team = game[`${side}_team`];
    const standing = game.standings[side];
    if (standing?.played !== null && standing?.played !== undefined)
      facts.push(
        `${team.name}: ${standing.played} played, ${standing.wins ?? 'unknown'} wins, ${standing.losses ?? 'unknown'} losses${standing.draws === null ? '' : `, ${standing.draws} draws`}.`,
      );
    else gaps.push(`${team.name}: season record unavailable.`);
    const recent = game.recent_games[side]
      .filter((g) => g.team_score !== null && g.opponent_score !== null)
      .slice(0, 5);
    if (recent.length)
      facts.push(
        `${team.name}, last ${recent.length} available results: ${recent.map((g) => `${g.date ?? 'date unknown'} ${g.team_score}–${g.opponent_score} vs ${g.opponent}`).join('; ')}. Historical scores do not establish this market's settlement rules.`,
      );
    else gaps.push(`${team.name}: recent scored results unavailable.`);
  }
  return { gameId, facts, gaps, fetchedAt };
}
