/**
 * Per-player statistics for one completed game.
 *
 * This is the only place the application learns what an individual did, and it
 * exists because the obvious source does not work. ESPN publishes an athlete
 * gamelog at `common/v3/.../athletes/<id>/gamelog`, which looks exactly right
 * and carries a single season — the *current* one. Asked for an earlier season
 * it returns nothing, so in September every player in the league has one game
 * on record, which is not a distribution and cannot be made into one.
 *
 * A finished game's summary carries the same numbers for everyone who played,
 * and the fixture history is already walked for the team model. So a player's
 * record is assembled from the games themselves rather than fetched per
 * player: one request per completed game, shared by every player in it,
 * against one request per player per season that would not answer anyway.
 *
 * Pure. Takes the payload, returns rows; the fetching and caching live in
 * `lib/players/history.ts`.
 */

import type { League } from '../../leagues/registry';

/** One athlete's line in one statistical group, as the provider sends it. */
interface RawAthleteLine {
  athlete?: {
    id?: unknown;
    displayName?: unknown;
    shortName?: unknown;
    position?: { abbreviation?: unknown } | null;
  } | null;
  stats?: unknown[];
}

interface RawStatGroup {
  name?: unknown;
  /** One canonical stat name per column, e.g. `receivingYards`. */
  keys?: unknown[];
  athletes?: RawAthleteLine[];
}

interface RawTeamPlayers {
  team?: { id?: unknown; displayName?: unknown } | null;
  statistics?: RawStatGroup[];
}

export interface RawBoxscoreResponse {
  boxscore?: { players?: RawTeamPlayers[] } | null;
  header?: { id?: unknown; competitions?: { date?: unknown }[] } | null;
}

/** Everything one athlete did in one game, by canonical stat name. */
export interface PlayerGameLine {
  athleteId: string;
  name: string;
  /** Provider team id, so a player who moved is still attributed correctly. */
  teamId: string | null;
  position: string | null;
  /** Only the statistics that parsed as numbers. */
  stats: Record<string, number>;
}

function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Split a column that carries two statistics at once.
 *
 * The provider pairs some of them: `completions/passingAttempts` arrives as
 * `"23/28"`, and `sacks-sackYardsLost` as `"4-23"`. The key names both, in
 * order, joined by the same separator the value uses — so the pair is split
 * rather than dropped, and a passing attempt is a stat the model can use.
 *
 * A key with no separator is one statistic and is returned as itself.
 */
export function splitStatColumn(key: string, value: string): [string, string][] {
  for (const separator of ['/', '-']) {
    if (!key.includes(separator)) continue;
    const names = key.split(separator);
    const values = value.split(separator);
    // Only when they genuinely correspond; anything else is left whole rather
    // than being paired up by guesswork.
    if (names.length !== values.length) break;
    return names.map((name, index) => [name, values[index] ?? '']);
  }
  return [[key, value]];
}

/**
 * A statistic, or nothing.
 *
 * The provider writes `-` for a column that does not apply to a player, and
 * percentages and averages arrive as decimals. Anything that is not a finite
 * number is absent rather than zero: a quarterback with no rushing line did
 * not rush for zero yards, he has no rushing line, and the difference matters
 * to a mean.
 */
function statValue(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '--') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Every player line in one game summary.
 *
 * A player appearing in several groups — a quarterback who also ran — is
 * merged into one row, because the model asks about a person rather than
 * about a statistical category.
 */
export function normaliseBoxscore(
  payload: RawBoxscoreResponse,
  _league?: League,
): PlayerGameLine[] {
  const byAthlete = new Map<string, PlayerGameLine>();

  for (const team of payload.boxscore?.players ?? []) {
    const teamId = str(team.team?.id);

    for (const group of team.statistics ?? []) {
      const keys = (group.keys ?? []).map((key) => str(key));

      for (const line of group.athletes ?? []) {
        const athleteId = str(line.athlete?.id);
        const name = str(line.athlete?.displayName) ?? str(line.athlete?.shortName);
        if (!athleteId || !name) continue;

        const existing = byAthlete.get(athleteId);
        const row: PlayerGameLine = existing ?? {
          athleteId,
          name,
          teamId,
          position: str(line.athlete?.position?.abbreviation),
          stats: {},
        };

        const values = line.stats ?? [];
        keys.forEach((key, index) => {
          const raw = str(values[index]);
          if (!key || raw === null) return;

          for (const [name_, value] of splitStatColumn(key, raw)) {
            const parsed = statValue(value);
            // A statistic already recorded is not overwritten: the same name
            // appearing in two groups would otherwise take whichever came
            // last for no reason.
            if (parsed !== null && !(name_ in row.stats)) row.stats[name_] = parsed;
          }
        });

        if (!existing) byAthlete.set(athleteId, row);
      }
    }
  }

  return [...byAthlete.values()];
}
