/**
 * Sport hub configuration.
 *
 * A hub is a *page*, a league is a *competition*. They are usually the same
 * thing, so this file derives itself from the league catalogue rather than
 * restating it — `LEAGUES` still owns ids, labels, provider paths, standings
 * support and the collegiate flag.
 *
 * Only what is genuinely presentational lives here: which slug a page answers
 * on, which leagues it covers, and the words that sport uses. Football says
 * "Fixtures", "Clubs" and "Transfers"; basketball says "Games", "Teams" and
 * "Transactions".
 *
 * Pure: no network, no config, no React.
 */

import { LEAGUES, findLeague } from '../leagues/registry.ts';
import type { League } from '../leagues/registry.ts';

/** What the transactions section is called. Sports do not share a word for it. */
export type TransactionsLabel = 'Transactions' | 'Transfers' | 'Roster Moves';

export interface HubTerminology {
  /** "Games" or "Fixtures". */
  games: string;
  /** "Teams" or "Clubs". */
  teams: string;
  /** "Standings" or "Table". */
  standings: string;
  transactions: TransactionsLabel;
}

/** A men's/women's style split within one hub. */
export interface HubDivision {
  id: string;
  label: string;
  /** Catalogue league ids this division selects. */
  leagues: readonly string[];
}

export interface HubConfig {
  /** URL segment: /sports/<slug>. */
  slug: string;
  label: string;
  /** Decorative; the label carries the meaning. */
  emoji: string;
  /**
   * Catalogue league ids this hub covers. One for almost every hub; the
   * combined NCAA basketball hub covers two.
   */
  leagues: readonly string[];
  /**
   * Chip id for deep links into Schedule and Live. Equal to the slug for every
   * current hub, but kept separate because the two systems are independent:
   * chips filter, hubs navigate.
   */
  chip: string;
  terminology: HubTerminology;
  /** Present only where a hub splits, i.e. NCAA basketball. */
  divisions?: readonly HubDivision[];
}

const AMERICAN: HubTerminology = {
  games: 'Games',
  teams: 'Teams',
  standings: 'Standings',
  transactions: 'Transactions',
};

const COLLEGE: HubTerminology = { ...AMERICAN, transactions: 'Roster Moves' };

const FOOTBALL: HubTerminology = {
  games: 'Fixtures',
  teams: 'Clubs',
  standings: 'Table',
  transactions: 'Transfers',
};

const EMOJI: Record<string, string> = {
  'american-football': '\u{1F3C8}',
  basketball: '\u{1F3C0}',
  baseball: '⚾',
  hockey: '\u{1F3D2}',
  football: '⚽',
  other: '\u{1F3C6}',
};

function terminologyFor(league: League): HubTerminology {
  if (league.group === 'football') return FOOTBALL;
  return league.collegiate ? COLLEGE : AMERICAN;
}

/**
 * The combined NCAA basketball hub.
 *
 * `ncaab` is a UI grouping, not a league: the catalogue holds `ncaam` and
 * `ncaaw` separately, and standings, teams and rosters are only ever fetched
 * for one of them. Schedule and Live already group them under one chip, and
 * this keeps that behaviour.
 */
const NCAA_BASKETBALL: HubConfig = {
  slug: 'ncaab',
  label: 'NCAA Basketball',
  emoji: EMOJI.basketball,
  leagues: ['ncaam', 'ncaaw'],
  chip: 'ncaab',
  terminology: COLLEGE,
  divisions: [
    { id: 'all', label: 'All', leagues: ['ncaam', 'ncaaw'] },
    { id: 'mens', label: "Men's", leagues: ['ncaam'] },
    { id: 'womens', label: "Women's", leagues: ['ncaaw'] },
  ],
};

/** League ids the combined hub absorbs, so they get no page of their own. */
const ABSORBED = new Set(NCAA_BASKETBALL.leagues);

function hubForLeague(league: League): HubConfig {
  return {
    slug: league.id,
    label: league.label,
    emoji: EMOJI[league.group] ?? EMOJI.other,
    leagues: [league.id],
    chip: league.id,
    terminology: terminologyFor(league),
  };
}

/**
 * Every hub, in catalogue order.
 *
 * One per league, with the two NCAA basketball divisions replaced by their
 * combined hub at the position of the first of them.
 */
export const HUBS: readonly HubConfig[] = LEAGUES.reduce<HubConfig[]>((hubs, league) => {
  if (league.id === 'ncaam') hubs.push(NCAA_BASKETBALL);
  if (!ABSORBED.has(league.id)) hubs.push(hubForLeague(league));
  return hubs;
}, []);

/**
 * Slugs that resolve to a hub without being one.
 *
 * `ncaam` and `ncaaw` are real leagues with no page of their own, so a link
 * built from a league id still lands somewhere sensible — on the combined hub,
 * with that division already selected.
 */
const ALIASES: Record<string, { slug: string; division: string }> = {
  ncaam: { slug: 'ncaab', division: 'mens' },
  ncaaw: { slug: 'ncaab', division: 'womens' },
};

export interface ResolvedHub {
  hub: HubConfig;
  /** The division to open on, for a hub that has them. */
  division: HubDivision | null;
}

/**
 * Resolve a URL segment to a hub.
 *
 * Returns null for anything not on the catalogue, so an unknown competition is
 * a 404 rather than an empty page.
 */
export function resolveHub(slug: string | null | undefined): ResolvedHub | null {
  if (typeof slug !== 'string') return null;
  const key = slug.trim().toLowerCase();
  if (!/^[a-z0-9-]{1,32}$/.test(key)) return null;

  const alias = Object.prototype.hasOwnProperty.call(ALIASES, key) ? ALIASES[key] : undefined;
  const target = alias ? alias.slug : key;

  const hub = HUBS.find((candidate) => candidate.slug === target);
  if (!hub) return null;

  return { hub, division: alias ? divisionFor(hub, alias.division) : defaultDivision(hub) };
}

/** The division a hub opens on when none is requested. */
export function defaultDivision(hub: HubConfig): HubDivision | null {
  return hub.divisions?.[0] ?? null;
}

/** A named division, falling back to the default rather than to nothing. */
export function divisionFor(hub: HubConfig, id: string | null | undefined): HubDivision | null {
  if (!hub.divisions) return null;
  const match = hub.divisions.find((division) => division.id === id);
  return match ?? defaultDivision(hub);
}

/**
 * The leagues a hub is currently showing.
 *
 * Honours the selected division, so "Men's" narrows to `ncaam` rather than
 * quietly querying both.
 */
export function leaguesForHub(hub: HubConfig, division: HubDivision | null): League[] {
  const ids = division ? division.leagues : hub.leagues;
  return ids
    .map((id) => findLeague(id))
    .filter((league): league is League => league !== null);
}

/**
 * The single league a hub queries for standings, teams and transactions.
 *
 * These are per-league by nature: there is no meaningful combined table across
 * men's and women's college basketball, and merging hundreds of teams into one
 * grid helps nobody. When a division selects exactly one league that is the
 * answer; otherwise there is none and the UI asks the user to choose.
 */
export function singleLeagueFor(hub: HubConfig, division: HubDivision | null): League | null {
  const leagues = leaguesForHub(hub, division);
  return leagues.length === 1 ? leagues[0] : null;
}

export function hubSlugs(): string[] {
  return HUBS.map((hub) => hub.slug);
}

/** The hub a league belongs to, for linking from a game or a chip. */
export function hubForLeagueId(leagueId: string): HubConfig | null {
  return resolveHub(leagueId)?.hub ?? null;
}

// ---------------------------------------------------------------------------
// Directory
// ---------------------------------------------------------------------------

/** Readable name for a catalogue group, for the competition index. */
const GROUP_LABEL: Record<string, string> = {
  'american-football': 'American football',
  basketball: 'Basketball',
  baseball: 'Baseball',
  hockey: 'Ice hockey',
  football: 'Football',
  other: 'Other',
};

export interface HubGroup {
  id: string;
  label: string;
  emoji: string;
  hubs: HubConfig[];
}

/**
 * Every hub, grouped by sport, in catalogue order.
 *
 * Used by the competition index — the page the mobile navigation opens, since
 * the sidebar shortcuts are desktop-only. Grouping comes from the league
 * catalogue rather than a second list.
 */
export function hubGroups(): HubGroup[] {
  const groups: HubGroup[] = [];

  for (const hub of HUBS) {
    // A hub's leagues always share a group; the combined NCAA basketball hub
    // covers two leagues, both of them basketball.
    const league = findLeague(hub.leagues[0]);
    if (!league) continue;

    const existing = groups.find((group) => group.id === league.group);
    if (existing) existing.hubs.push(hub);
    else {
      groups.push({
        id: league.group,
        label: GROUP_LABEL[league.group] ?? league.group,
        emoji: EMOJI[league.group] ?? EMOJI.other,
        hubs: [hub],
      });
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

/**
 * Curated sidebar shortcuts.
 *
 * Navigation, not filtering: these open a competition hub, while the Schedule
 * and Live chips continue to filter those pages. The two were previously the
 * same list, which conflated them.
 *
 * Deliberately a subset. Seventeen permanent entries would be an unusable
 * navigation column, so the remaining football competitions are reached from
 * the switcher on any football hub.
 */
export interface SidebarHub {
  /** Hub slug: /sports/<slug>. A test asserts every one of these resolves. */
  slug: string;
  /** Longer than a chip label — a sidebar row has room to say which NCAA. */
  label: string;
  emoji: string;
}

export const SIDEBAR_HUBS: readonly SidebarHub[] = [
  { slug: 'nfl', label: 'NFL', emoji: EMOJI['american-football'] },
  { slug: 'ncaaf', label: 'NCAA Football', emoji: EMOJI['american-football'] },
  { slug: 'nba', label: 'NBA', emoji: EMOJI.basketball },
  { slug: 'wnba', label: 'WNBA', emoji: EMOJI.basketball },
  { slug: 'ncaab', label: 'NCAA Basketball', emoji: EMOJI.basketball },
  { slug: 'mlb', label: 'MLB', emoji: EMOJI.baseball },
  { slug: 'nhl', label: 'NHL', emoji: EMOJI.hockey },
  { slug: 'epl', label: 'Premier League', emoji: EMOJI.football },
  { slug: 'ucl', label: 'Champions League', emoji: EMOJI.football },
];

// ---------------------------------------------------------------------------
// Football competition navigation
// ---------------------------------------------------------------------------

/**
 * Football competitions, grouped for the switcher.
 *
 * Only the Premier League and the Champions League are permanent sidebar
 * entries — seventeen shortcuts would be an unusable navigation column — so
 * every football hub carries this selector to reach the rest.
 *
 * Presentation only. The ids are the catalogue's.
 */
export interface CompetitionGroup {
  label: string;
  slugs: readonly string[];
}

export const FOOTBALL_GROUPS: readonly CompetitionGroup[] = [
  { label: 'England', slugs: ['epl', 'championship', 'league-one'] },
  { label: 'Europe', slugs: ['ucl', 'uel', 'uecl'] },
  { label: 'Other domestic leagues', slugs: ['laliga', 'bundesliga', 'seriea'] },
];

/** True when a hub should show the football competition switcher. */
export function isFootballHub(hub: HubConfig): boolean {
  return FOOTBALL_GROUPS.some((group) => group.slugs.includes(hub.slug));
}
