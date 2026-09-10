/**
 * Squad availability for a whole competition, in one request.
 *
 * The game page reads availability out of the fixture summary it already
 * fetches, which is free but per-fixture. The projection pipeline needs the
 * opposite shape: it projects a whole slate at once, and a summary call per
 * fixture would turn one page of projections into fifty requests. This is the
 * bulk half — `<league>/injuries`, one call per competition, cached, indexed by
 * the provider's own team id.
 *
 * Both halves normalise through `playersFrom`, so the projection and the game
 * page cannot disagree about whether a player is out.
 *
 * Coverage is decided by the payload, never assumed — and this feed decides it
 * differently from the fixture summary, which is worth knowing before editing
 * either. The summary *omits* its `injuries` key for an uncovered competition.
 * This feed always sends the key and sends `[]` instead: the Premier League,
 * La Liga, Serie A, the Bundesliga and the Champions League every one return
 * an empty array rather than nothing at all.
 *
 * So an empty report is read here as "no report", not as "nobody is injured".
 * A covered competition never returns zero teams — the NFL lists 32 and MLB
 * 30 — and the two possible errors are not symmetric. Reading football's empty
 * array as a clean bill of health tells a reader both squads are fully fit,
 * which is false. Reading a genuinely injury-free competition as uncovered
 * says only that this application cannot say, which is merely conservative.
 */

import { cached } from '../../cache';
import { espnConfig } from '../../config';
import { logger } from '../../logger';
import { fetchEspn } from './client';
import { playersFrom } from '../../games/availability-normalise';
import type { PlayerAvailability } from '../../games/availability-normalise';
import { supportsEditorialData } from '../../leagues/registry';
import type { League } from '../../leagues/registry';

/**
 * Measured ceiling for this endpoint.
 *
 * The NFL's feed is 8.9 MB decompressed — over the shared 8 MiB default, which
 * exists to stop an *unbounded* response rather than to reject a large known
 * one. 16 MiB leaves headroom for the feed to grow without reopening the
 * question, and the guard stays at its default for every other caller.
 */
const MAX_BYTES = 16 * 1024 * 1024;

/**
 * Injuries change on the order of hours, not seconds.
 *
 * Shorter than the enrichment default, because a status resolving from
 * questionable to out on the morning of a fixture is exactly the change worth
 * catching, and longer than a live feed, because this is a report rather than
 * a scoreboard.
 */
const TTL_MS = 15 * 60_000;

/**
 * One team's block.
 *
 * The id sits at the top level here (`{ id, displayName, injuries }`), where
 * the fixture summary nests it under `team`. Both are read, because the two
 * feeds genuinely differ and a wrong guess here silently matches no team at
 * all — which looks exactly like a competition with nobody injured.
 */
interface RawTeamBlock {
  id?: unknown;
  team?: { id?: unknown };
  injuries?: unknown;
}

interface RawLeagueInjuries {
  injuries?: RawTeamBlock[];
}

/**
 * Availability for one competition, keyed by provider team id.
 *
 * Null means the provider publishes nothing for this competition — which is a
 * different statement from an empty map, meaning it publishes a report and
 * nobody is on it.
 */
export type LeagueAvailability = ReadonlyMap<string, PlayerAvailability[]> | null;

async function fetchLeague(espnPath: string): Promise<LeagueAvailability> {
  const payload = await fetchEspn<RawLeagueInjuries>(
    `${espnPath}/injuries`,
    '',
    'site',
    MAX_BYTES,
  );

  // Zero teams is no report at all — see the note at the top of this file for
  // why that is read as "cannot say" rather than "nobody is injured".
  if (!payload || !Array.isArray(payload.injuries) || payload.injuries.length === 0) {
    return null;
  }

  const byTeam = new Map<string, PlayerAvailability[]>();
  for (const block of payload.injuries) {
    const id = typeof block?.id === 'string' ? block.id : block?.team?.id;
    const teamId = typeof id === 'string' && id.length > 0 ? id : null;
    if (!teamId) continue;
    byTeam.set(teamId, playersFrom(block.injuries));
  }

  // Every block unusable means the shape has moved under us. Null rather than
  // an empty map, which downstream would report as two intact squads.
  return byTeam.size > 0 ? byTeam : null;
}

/**
 * Availability for a competition, or null where the provider has none.
 *
 * A failed request also yields null, and deliberately: the alternative is an
 * empty map, which this application would then present as "no absences
 * reported" — a claim about the squads made on the strength of a network
 * error. Reporting nothing is the only honest response to knowing nothing.
 */
export async function leagueAvailability(league: League): Promise<LeagueAvailability> {
  const espnPath = league.espnPath;
  if (!espnConfig.enabled || !espnPath) return null;

  /*
   * Only where the fixtures themselves come from ESPN.
   *
   * This map is keyed by ESPN's team ids, and a fixture served by the other
   * provider carries that provider's ids instead. Two unrelated id spaces of
   * bare digits will eventually collide, and the failure mode is showing one
   * club another club's injuries — worse than showing none. The CFL is exactly
   * this case: ESPN holds its teams but publishes no fixtures for it, so its
   * games arrive with TheSportsDB ids.
   */
  if (!supportsEditorialData(league)) return null;

  try {
    const { value } = await cached(`espn:availability:${league.id}`, TTL_MS, () =>
      fetchLeague(espnPath),
    );
    return value;
  } catch (error) {
    logger.warn('espn_availability_failed', {
      league: league.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}
