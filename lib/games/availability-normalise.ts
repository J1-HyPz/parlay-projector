/**
 * Player availability, from the ESPN fixture summary.
 *
 * Pure. Given the raw summary payload in, normalised availability out — no
 * request, no clock, no filesystem, so every rule below is testable without a
 * network.
 *
 * This reads a payload the application **already downloads**: `espnGameDetail`
 * fetches `<league>/summary?event=<id>` for the header, records and previous
 * meetings, and the same response carries the fixture's injury report and, for
 * baseball, the probable starting pitchers. So availability costs no extra
 * request and inherits the freshness of the call it rides on.
 *
 * Three findings from checking the provider live, recorded because each one
 * contradicts a reasonable assumption:
 *
 *   The per-team endpoint `teams/<id>/injuries` returns `{}` for every league
 *   tried. The league-wide `<league>/injuries` does work, but the NFL's is 8.9
 *   MB decompressed — past this application's own response cap — where the
 *   fixture summary carries the same information for the two teams that
 *   actually matter.
 *
 *   `status` is free text and inconsistent between leagues: baseball reports
 *   `"suspension"`, hockey reports `"Suspension"`. `type.name` is a stable
 *   machine enum in every league checked, so the mapping keys on that and
 *   keeps the provider's own wording for display rather than for logic.
 *
 *   Football carries no availability data at all — not an empty list, but no
 *   `injuries` key on the payload whatsoever. That absence is preserved rather
 *   than flattened into "no absences reported", because they are different
 *   claims and a reader must not take the second for the first.
 */

/**
 * How available a player is, as the provider reports it.
 *
 * `available` is not a contradiction: a provider lists a player who is
 * carrying a knock but is expected to play, and in the NFL that is the
 * *majority* of the injury report. Folding those into the absences would
 * overstate every team's problems.
 *
 * `listed` is the honest fallback for a status this application does not
 * recognise. Guessing between "out" and "available" would be inventing the one
 * fact the reader needs, so the entry keeps its place in the list and shows
 * the provider's own label instead.
 */
export type AvailabilityStatus =
  | 'out'
  | 'doubtful'
  | 'questionable'
  | 'day_to_day'
  | 'available'
  | 'suspended'
  | 'personal'
  | 'listed';

/**
 * The provider's machine enum, mapped.
 *
 * Every injured-list variant collapses to `out` — a player on a 10-day or
 * 60-day list is not playing in this fixture, and the distinction between them
 * is preserved verbatim in `provider_status` rather than lost.
 */
const STATUS_BY_TYPE: Record<string, AvailabilityStatus> = {
  INJURY_STATUS_OUT: 'out',
  INJURY_STATUS_IR: 'out',
  INJURY_STATUS_7DAYIL: 'out',
  INJURY_STATUS_10DAYIL: 'out',
  INJURY_STATUS_15DAYIL: 'out',
  INJURY_STATUS_60DAYIL: 'out',
  INJURY_STATUS_DOUBTFUL: 'doubtful',
  INJURY_STATUS_QUESTIONABLE: 'questionable',
  INJURY_STATUS_DAYTODAY: 'day_to_day',
  INJURY_STATUS_ACTIVE: 'available',
  INJURY_STATUS_SUSPENSION: 'suspended',
  INJURY_STATUS_BEREAVEMENT: 'personal',
};

/** Statuses that mean the player will not take part. */
const ABSENT: ReadonlySet<AvailabilityStatus> = new Set<AvailabilityStatus>([
  'out',
  'suspended',
  'personal',
]);

export function isAbsent(status: AvailabilityStatus): boolean {
  return ABSENT.has(status);
}

/** Statuses where the player may or may not take part. */
const DOUBT: ReadonlySet<AvailabilityStatus> = new Set<AvailabilityStatus>([
  'doubtful',
  'questionable',
  'day_to_day',
]);

export function isInDoubt(status: AvailabilityStatus): boolean {
  return DOUBT.has(status);
}

export interface PlayerAvailability {
  /** Provider athlete id. Null when absent — never a generated stand-in. */
  id: string | null;
  name: string;
  position: string | null;
  status: AvailabilityStatus;
  /** The provider's own label, e.g. `10-day IL`. Shown as written. */
  provider_status: string | null;
  /** What is wrong, in the provider's words, e.g. `Right Foot — Plantar Fasciitis`. */
  detail: string | null;
  /** The provider's expected return date, `YYYY-MM-DD`. Null when not given. */
  expected_return: string | null;
  /** When the provider last changed this entry. */
  updated_at: string | null;
}

export interface TeamAvailability {
  team_id: string | null;
  /** Empty means the provider covers this competition and reports nobody. */
  players: PlayerAvailability[];
}

/**
 * A named probable starter.
 *
 * Baseball only in practice: it is the one sport where the provider publishes
 * a starter ahead of the fixture. `role` carries the provider's own wording
 * ("Probable Starting Pitcher") rather than this application asserting the
 * player is confirmed — probable is what the provider claims, and probable is
 * what the reader is told.
 *
 * There is deliberately no `confirmed` flag. The v2 spec expected a second,
 * weaker tier derived from depth charts, but `teams/<id>/depthchart` returns
 * an empty object on this API, so no such tier exists to distinguish this one
 * from. A flag with a single possible value would imply a distinction the data
 * cannot make.
 */
export interface ProbableStarter {
  id: string | null;
  name: string;
  role: string;
  position: string | null;
}

/**
 * Availability for one fixture.
 *
 * The whole object is null when the provider publishes nothing for the
 * competition, which is what separates "nobody is missing" from "we cannot
 * say". Football reaches the second, every time.
 */
export interface FixtureAvailability {
  home: TeamAvailability;
  away: TeamAvailability;
  probables: {
    home: ProbableStarter[];
    away: ProbableStarter[];
  };
}

// ---------------------------------------------------------------------------
// Raw shapes
// ---------------------------------------------------------------------------

interface RawAthlete {
  id?: unknown;
  displayName?: unknown;
  fullName?: unknown;
  shortName?: unknown;
  position?: { abbreviation?: unknown; displayName?: unknown; name?: unknown };
}

interface RawInjury {
  status?: unknown;
  date?: unknown;
  type?: { name?: unknown; description?: unknown; abbreviation?: unknown };
  details?: {
    type?: unknown;
    detail?: unknown;
    side?: unknown;
    returnDate?: unknown;
  };
  athlete?: RawAthlete;
}

interface RawTeamInjuries {
  team?: { id?: unknown };
  injuries?: RawInjury[];
}

interface RawProbable {
  name?: unknown;
  displayName?: unknown;
  athlete?: RawAthlete;
}

interface RawCompetitor {
  homeAway?: unknown;
  team?: { id?: unknown };
  probables?: RawProbable[];
}

export interface RawAvailabilitySummary {
  injuries?: RawTeamInjuries[];
  header?: {
    competitions?: { competitors?: RawCompetitor[] }[];
  };
}

function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function athleteName(athlete: RawAthlete | undefined): string | null {
  return str(athlete?.displayName) ?? str(athlete?.fullName) ?? str(athlete?.shortName);
}

function position(athlete: RawAthlete | undefined): string | null {
  return (
    str(athlete?.position?.abbreviation) ??
    str(athlete?.position?.displayName) ??
    str(athlete?.position?.name)
  );
}

/**
 * The provider's placeholder for a field it has no value for.
 *
 * Filtered because joining it produces sentences rather than facts: a real
 * entry carrying side "Not Specified", type "Groin" and detail "Not Specified"
 * reads out as "Not Specified Groin — Not Specified".
 *
 * Exactly one string, not a guessed family of them. Sampled across every
 * injury the NFL, MLB, NBA and NHL feeds carried: `side` takes only "Not
 * Specified", "Right" and "Left", and `detail` only "Not Specified" beside
 * real findings like "Surgery" and "Strain". Notably "Undisclosed" is *not*
 * here — with eighty occurrences as a body area it is the injury report
 * genuinely saying the team would not disclose, which is information rather
 * than the absence of it.
 */
function meaningful(value: string | null): string | null {
  if (value === null) return null;
  return value.toLowerCase() === 'not specified' ? null : value;
}

/**
 * What is wrong, assembled from the provider's own three fields.
 *
 * `side`, `type` and `detail` arrive separately — "Right", "Foot", "Plantar
 * Fasciitis" — and are joined in that order. Nothing is inferred: a missing
 * part is left out, and an entry with none of the three gets no detail line
 * rather than an invented one.
 */
function injuryDetail(raw: RawInjury['details']): string | null {
  const side = meaningful(str(raw?.side));
  const area = meaningful(str(raw?.type));
  const specific = meaningful(str(raw?.detail));

  const head = [side, area].filter((part): part is string => part !== null).join(' ');
  if (head && specific && specific !== area) return `${head} — ${specific}`;
  if (head) return head;
  return specific;
}

/**
 * One team's entries, normalised and ordered.
 *
 * Exported because two different feeds carry the same entry shape: the fixture
 * summary this file is named for, and the league-wide injuries feed the
 * projection pipeline reads. Sharing the mapping is what stops the game page
 * and the projection disagreeing about whether a player is out.
 */
export function playersFrom(raw: unknown): PlayerAvailability[] {
  if (!Array.isArray(raw)) return [];
  return sortPlayers(
    raw
      .map((entry) => toPlayer(entry as RawInjury))
      .filter((player): player is PlayerAvailability => player !== null),
  );
}

function toPlayer(raw: RawInjury): PlayerAvailability | null {
  const name = athleteName(raw.athlete);
  // Without a name there is nothing a reader can act on, and attributing an
  // absence to an unnamed player is worse than omitting the row.
  if (!name) return null;

  const typeName = str(raw.type?.name);
  const mapped = typeName ? STATUS_BY_TYPE[typeName] : undefined;

  return {
    id: str(raw.athlete?.id),
    name,
    position: position(raw.athlete),
    status: mapped ?? 'listed',
    // The provider's short description first ("10-day IL"), falling back to
    // its free-text status. Kept for display only — never switched on.
    provider_status: str(raw.type?.description) ?? str(raw.status),
    detail: injuryDetail(raw.details),
    expected_return: str(raw.details?.returnDate),
    updated_at: str(raw.date),
  };
}

/**
 * Absences first, then doubts, then everyone else.
 *
 * A reader scanning a team's list wants the players who are definitely missing
 * at the top; a fit-but-listed player is the least useful row on the card and
 * sorts last. Ties keep the provider's own ordering, which is roughly by
 * recency of update.
 */
const RANK: Record<AvailabilityStatus, number> = {
  out: 0,
  suspended: 1,
  personal: 2,
  doubtful: 3,
  questionable: 4,
  day_to_day: 5,
  listed: 6,
  available: 7,
};

function sortPlayers(players: PlayerAvailability[]): PlayerAvailability[] {
  return [...players].sort((a, b) => RANK[a.status] - RANK[b.status]);
}

function toProbable(raw: RawProbable): ProbableStarter | null {
  const name = athleteName(raw.athlete);
  if (!name) return null;
  return {
    id: str(raw.athlete?.id),
    name,
    role: str(raw.displayName) ?? 'Probable starter',
    position: position(raw.athlete),
  };
}

/**
 * Named probable starters for each side, from the fixture summary.
 *
 * The summary is the only place these appear, so it remains the source for
 * them — unlike the injury lists, which come from the competition-wide report
 * instead. See `fixtureAvailability` for why they were separated.
 */
export function probablesFromSummary(summary: RawAvailabilitySummary | null | undefined): {
  home: ProbableStarter[];
  away: ProbableStarter[];
} {
  const competitors = summary?.header?.competitions?.[0]?.competitors ?? [];

  const forSide = (side: 'home' | 'away'): ProbableStarter[] => {
    const competitor = competitors.find((entry) => str(entry?.homeAway) === side);
    if (!competitor || !Array.isArray(competitor.probables)) return [];
    return competitor.probables
      .map(toProbable)
      .filter((starter): starter is ProbableStarter => starter !== null);
  };

  return { home: forSide('home'), away: forSide('away') };
}

/**
 * Availability for a fixture, or null where the provider publishes none.
 *
 * Injuries come from the **competition-wide report**, not from the fixture
 * summary, even though the summary carries an injury block of its own and
 * costs nothing to read. The summary's block is capped at five players a side:
 * for one MLB fixture it listed five where the full report held seven and ten.
 * Since the game page shows this section directly above the projection — whose
 * caveats are built from the full report — the two would have sat inches apart
 * disagreeing about how many players were out. One source settles it, and the
 * complete one is the right source.
 *
 * A null report means the provider publishes nothing for the competition, and
 * the whole object is null in turn: "we cannot say" must not reach a reader as
 * "nobody is missing".
 *
 * Team attribution is by provider team id and nothing else. A team the report
 * does not name has nobody listed, which is an empty list; a fixture whose
 * sides cannot be identified at all yields empty lists rather than a guessed
 * assignment, because putting an absence against the wrong club is a worse
 * failure than showing none.
 */
export function fixtureAvailability(
  report: ReadonlyMap<string, PlayerAvailability[]> | null,
  probables: { home: ProbableStarter[]; away: ProbableStarter[] },
  homeTeamId: string | null,
  awayTeamId: string | null,
): FixtureAvailability | null {
  if (!report) return null;

  const forTeam = (teamId: string | null): PlayerAvailability[] =>
    teamId ? [...(report.get(teamId) ?? [])] : [];

  return {
    home: { team_id: homeTeamId, players: forTeam(homeTeamId) },
    away: { team_id: awayTeamId, players: forTeam(awayTeamId) },
    probables,
  };
}
