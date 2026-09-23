/**
 * Per-player statistics for one completed game.
 *
 * One of two sources, and the one that answers about *breadth*: a single
 * request carries every player who appeared, about fifty of them, so rating a
 * whole squad costs one request per game rather than one per person. The other
 * is `gamelog.ts`, which answers about depth for one named player and reaches
 * back several seasons. Which is cheaper depends entirely on how many players
 * the market is about.
 *
 * This file used to claim the gamelog "carries a single season — the current
 * one. Asked for an earlier season it returns nothing." **That was wrong**, and
 * measured to be wrong: `?season=YYYY` serves nine seasons for an NFL
 * quarterback and ten for a pitcher. The claim survived because nobody asked.
 *
 * Four things about this payload were also assumed and are not true, each now
 * handled below and each with a fixture behind it:
 *
 *   - Football athletes carry **no position and no `shortName`** — zero of 84
 *     NFL and zero of 81 NCAAF lines. Baseball carries the position on the
 *     athlete's line instead of on the athlete, so that is read too.
 *   - Baseball's innings column is `fullInnings.partInnings`, separated by a
 *     **dot**. Left unsplit, `"6.1"` reads as 6.1 innings rather than six and a
 *     third — the exact error `parseInnings` exists to prevent.
 *   - NCAA football injects **team pseudo-athletes** with negative ids and a
 *     display name of `" Team"`, carrying the team's own totals. Admitted, they
 *     would become a player who out-produces everyone.
 *   - The provider was said to write `-` for a statistic that does not apply.
 *     Not reproduced on any of 2,243 athlete lines: a player who recorded
 *     nothing is simply absent from that group. The guard stays, because
 *     `"--"` does appear in one column, but the real mechanism is absence.
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
  /**
   * Baseball puts the position here rather than on the athlete.
   *
   * Read as a fallback because football puts it in neither place, so a single
   * lookup would silently return null for the one sport already implemented.
   */
  position?: { abbreviation?: unknown } | null;
  /** Basketball marks a player who was available but not used. */
  didNotPlay?: unknown;
  stats?: unknown[];
}

interface RawStatGroup {
  name?: unknown;
  /** Baseball identifies its groups by `type` rather than by `name`. */
  type?: unknown;
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
  /*
   * The dot is the one that matters most and was missing.
   *
   * Baseball writes innings as `fullInnings.partInnings` over `"6.1"`, which is
   * six innings and one out — not 6.1 innings. Split, the two halves are whole
   * numbers a caller can combine correctly; unsplit, every fractional start is
   * understated and any rate built on it is overstated. It is safe to add
   * because only the *key* is tested for a separator, and no other key observed
   * on any competition contains a dot.
   */
  for (const separator of ['/', '-', '.']) {
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
      /*
       * Which group a statistic came from, where the provider says.
       *
       * Baseball puts `strikeouts` in **both** its groups, meaning opposite
       * things: batters a pitcher struck out, and times a batter struck out. A
       * position player finishing a blowout on the mound appears in both, and
       * whichever group happened to be read first would win — settling a
       * strikeout market against the wrong number, silently. So every statistic
       * is also written under `<group>.<name>`, and a caller that cares which it
       * meant can ask for it unambiguously.
       */
      const groupKey = str(group.type) ?? str(group.name);

      for (const line of group.athletes ?? []) {
        const athleteId = str(line.athlete?.id);
        const name = str(line.athlete?.displayName) ?? str(line.athlete?.shortName);
        if (!athleteId || !name) continue;

        /*
         * A team is not a player.
         *
         * NCAA football injects `{"id":"-6315","displayName":" Team"}` carrying
         * the side's own totals into the passing and fumbles groups. A negative
         * id is the provider's own marker for that, and it is a far safer test
         * than the display name, which is a leading space away from a real one.
         */
        if (athleteId.startsWith('-')) continue;

        const existing = byAthlete.get(athleteId);
        const row: PlayerGameLine = existing ?? {
          athleteId,
          name,
          teamId,
          // Football carries it in neither place and gets null, which is honest.
          position:
            str(line.athlete?.position?.abbreviation) ?? str(line.position?.abbreviation),
          stats: {},
        };

        const values = line.stats ?? [];
        keys.forEach((key, index) => {
          const raw = str(values[index]);
          if (!key || raw === null) return;

          for (const [name_, value] of splitStatColumn(key, raw)) {
            const parsed = statValue(value);
            if (parsed === null) continue;
            // A statistic already recorded is not overwritten: the same name
            // appearing in two groups would otherwise take whichever came
            // last for no reason.
            if (!(name_ in row.stats)) row.stats[name_] = parsed;
            // The qualified name never collides, so it is always written.
            if (groupKey) row.stats[`${groupKey}.${name_}`] = parsed;
          }
        });

        if (!existing) byAthlete.set(athleteId, row);
      }
    }
  }

  return [...byAthlete.values()];
}
