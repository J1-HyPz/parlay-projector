/**
 * Pure normalisation for league, team, standings and player payloads.
 *
 * Same discipline as the rest of the data layer: every field is treated as
 * untrusted, an absent value stays null rather than becoming 0 or a
 * placeholder, and betting fields never enter the model.
 *
 * No network, no config — directly unit-testable.
 */

import type { StandingsGroup, StandingsRow, PlayerProfile, TeamProfile } from './types';

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
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : null;
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export interface RawTeamEntry {
  team?: {
    id?: unknown;
    displayName?: unknown;
    /** Short club name, e.g. `Dream` for `Atlanta Dream`. */
    name?: unknown;
    nickname?: unknown;
    shortDisplayName?: unknown;
    abbreviation?: unknown;
    location?: unknown;
    color?: unknown;
    logos?: { href?: unknown }[];
  };
}

export interface RawTeamsResponse {
  sports?: { leagues?: { teams?: RawTeamEntry[] }[] }[];
}

export function normaliseTeam(raw: RawTeamEntry | null | undefined): TeamProfile | null {
  const team = raw?.team;
  if (!team) return null;

  const id = str(team.id);
  const name = str(team.displayName) ?? str(team.name);
  if (!id || !name) return null;

  const logos = Array.isArray(team.logos) ? team.logos : [];

  return {
    id,
    name,
    short_name: str(team.name) ?? str(team.nickname) ?? str(team.shortDisplayName),
    abbreviation: str(team.abbreviation),
    location: str(team.location),
    logo: str(logos[0]?.href),
    colour: str(team.color) ? `#${str(team.color)}` : null,
  };
}

/** ESPN nests teams three levels deep; anything unexpected yields no teams. */
export function normaliseTeams(payload: RawTeamsResponse | null | undefined): TeamProfile[] {
  const leagues = payload?.sports?.[0]?.leagues;
  if (!Array.isArray(leagues)) return [];

  const entries = leagues[0]?.teams;
  if (!Array.isArray(entries)) return [];

  const teams: TeamProfile[] = [];
  for (const entry of entries) {
    const team = normaliseTeam(entry);
    if (team) teams.push(team);
  }
  return teams.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export interface RawStandingsStat {
  name?: unknown;
  abbreviation?: unknown;
  value?: unknown;
  displayValue?: unknown;
}

export interface RawStandingsEntry {
  team?: {
    id?: unknown;
    displayName?: unknown;
    abbreviation?: unknown;
    logos?: { href?: unknown }[];
  };
  stats?: RawStandingsStat[];
}

export interface RawStandingsGroup {
  id?: unknown;
  name?: unknown;
  abbreviation?: unknown;
  standings?: { entries?: RawStandingsEntry[] };
  children?: RawStandingsGroup[];
}

/** Pull one named statistic out of an entry, by ESPN's stat name. */
export function statValue(stats: RawStandingsStat[] | undefined, name: string): number | null {
  if (!Array.isArray(stats)) return null;
  const stat = stats.find((entry) => str(entry?.name) === name);
  return stat ? num(stat.value) : null;
}

export function statDisplay(stats: RawStandingsStat[] | undefined, name: string): string | null {
  if (!Array.isArray(stats)) return null;
  const stat = stats.find((entry) => str(entry?.name) === name);
  return stat ? str(stat.displayValue) : null;
}

export function normaliseStandingsEntry(raw: RawStandingsEntry): StandingsRow | null {
  const id = str(raw?.team?.id);
  const name = str(raw?.team?.displayName);
  if (!id || !name) return null;

  const logos = Array.isArray(raw.team?.logos) ? raw.team.logos : [];

  return {
    team_id: id,
    team_name: name,
    abbreviation: str(raw.team?.abbreviation),
    logo: str(logos[0]?.href),
    rank: statValue(raw.stats, 'playoffSeed') ?? statValue(raw.stats, 'rank'),
    games_played: statValue(raw.stats, 'gamesPlayed'),
    wins: statValue(raw.stats, 'wins'),
    losses: statValue(raw.stats, 'losses'),
    ties: statValue(raw.stats, 'ties'),
    win_percent: statValue(raw.stats, 'winPercent'),
    games_behind: statValue(raw.stats, 'gamesBehind'),
    points_for: statValue(raw.stats, 'pointsFor'),
    points_against: statValue(raw.stats, 'pointsAgainst'),
    point_differential: statValue(raw.stats, 'pointDifferential'),
    points: statValue(raw.stats, 'points'),
    /** Provider's own summary, e.g. `11-2`. */
    record: statDisplay(raw.stats, 'overall') ?? statDisplay(raw.stats, 'record'),
    streak: statDisplay(raw.stats, 'streak'),
  };
}

/**
 * Flatten ESPN's nested standings into named groups.
 *
 * Conferences and divisions arrive as `children`; a league with neither has one
 * group at the top. NCAA Football has eleven conferences, the NBA two.
 */
export function normaliseStandings(
  payload: RawStandingsGroup | null | undefined,
): StandingsGroup[] {
  if (!payload || typeof payload !== 'object') return [];

  const groups: StandingsGroup[] = [];

  const walk = (node: RawStandingsGroup, inheritedName: string | null): void => {
    const name = str(node.name) ?? inheritedName;
    const entries = node.standings?.entries;

    if (Array.isArray(entries) && entries.length > 0) {
      const rows: StandingsRow[] = [];
      for (const entry of entries) {
        const row = normaliseStandingsEntry(entry);
        if (row) rows.push(row);
      }
      if (rows.length > 0) {
        groups.push({
          id: str(node.id) ?? name ?? `group-${groups.length}`,
          name: name ?? 'Standings',
          abbreviation: str(node.abbreviation),
          rows: rows.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)),
        });
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child, name);
    }
  };

  walk(payload, null);
  return groups;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export interface RawAthlete {
  id?: unknown;
  fullName?: unknown;
  displayName?: unknown;
  jersey?: unknown;
  position?: { abbreviation?: unknown; displayName?: unknown };
  /** Numeric inches. `displayHeight` is the readable form and is preferred. */
  height?: unknown;
  displayHeight?: unknown;
  weight?: unknown;
  displayWeight?: unknown;
  age?: unknown;
  headshot?: { href?: unknown };
  experience?: { years?: unknown };
}

export interface RawRosterResponse {
  /**
   * Flat for some leagues, grouped by position for others, so both shapes are
   * handled rather than assuming one.
   */
  athletes?: (RawAthlete | { items?: RawAthlete[] })[];
  coach?: { firstName?: unknown; lastName?: unknown }[];
}

export function normalisePlayer(raw: RawAthlete | null | undefined): PlayerProfile | null {
  if (!raw || typeof raw !== 'object') return null;

  const id = str(raw.id);
  const name = str(raw.fullName) ?? str(raw.displayName);
  if (!id || !name) return null;

  return {
    id,
    name,
    jersey: str(raw.jersey),
    position: str(raw.position?.abbreviation) ?? str(raw.position?.displayName),
    height: str(raw.displayHeight) ?? str(raw.height),
    weight: num(raw.weight),
    age: num(raw.age),
    headshot: str(raw.headshot?.href),
    experience_years: num(raw.experience?.years),
  };
}

/** Handles both the flat and position-grouped roster shapes. */
export function normaliseRoster(payload: RawRosterResponse | null | undefined): PlayerProfile[] {
  const athletes = payload?.athletes;
  if (!Array.isArray(athletes)) return [];

  const players: PlayerProfile[] = [];
  for (const entry of athletes) {
    if (entry && typeof entry === 'object' && Array.isArray((entry as { items?: unknown }).items)) {
      for (const item of (entry as { items: RawAthlete[] }).items) {
        const player = normalisePlayer(item);
        if (player) players.push(player);
      }
      continue;
    }
    const player = normalisePlayer(entry as RawAthlete);
    if (player) players.push(player);
  }

  return players;
}
