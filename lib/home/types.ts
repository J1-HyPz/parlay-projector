/**
 * Stable Parlay Projector data contract for the Home page.
 *
 * The frontend depends on these shapes only. Provider payloads are normalised
 * into them, so swapping a sports or news provider never reaches the UI.
 */

/** Sport identifiers accepted by the homepage API. */
export const SPORT_IDS = [
  'all',
  'nfl',
  'nba',
  'mlb',
  'nhl',
  'football',
  'tennis',
  'f1',
] as const;
export type SportId = (typeof SPORT_IDS)[number];

/** Sport identifiers that map to an actual sport (i.e. everything except `all`). */
export type ConcreteSportId = Exclude<SportId, 'all'>;

/**
 * Normalised game status. Provider-specific values are mapped onto these so the
 * UI never has to know about `FT`, `NS`, `AOT` and friends.
 */
export type GameStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'postponed'
  | 'cancelled'
  | 'unknown';

export interface Team {
  id: string | null;
  name: string;
  logo: string | null;
}

/**
 * One competitor in an event contested by a field rather than by two sides.
 *
 * A Grand Prix has twenty-odd drivers finishing in order; there is no home
 * side, no away side and no score. Rather than nominate two of them and call
 * the rest something else, such an event carries its whole field.
 */
export interface Entrant {
  id: string | null;
  name: string;
  /** Constructor or stable, where the provider names one. */
  affiliation: string | null;
  /**
   * Finishing position once the session is over, grid position before it.
   * Null when the provider has published neither.
   */
  position: number | null;
  logo: string | null;
}

/** Points scored. Null per side until the provider reports a figure. */
export interface Score {
  home: number | null;
  away: number | null;
}

export interface Venue {
  name: string | null;
  city: string | null;
  country: string | null;
}

export interface Game {
  id: string;
  sport: ConcreteSportId;
  league: string | null;
  league_badge: string | null;
  /** Competition season, e.g. `2026`. Present in the provider's day feed. */
  season: string | null;
  /** Round or week number, e.g. `7`. Present in the provider's day feed. */
  round: string | null;
  /** ISO-8601 UTC instant, or null when the provider gave no usable time. */
  start_time: string | null;
  status: GameStatus;
  /** Raw provider status, retained so provider quirks stay debuggable. */
  provider_status: string | null;
  /**
   * The two sides.
   *
   * Absent for an event contested by a field — a Grand Prix has no home team.
   * Every fixture in a head-to-head sport has both, so a reader of these should
   * check `entrants` first, or use `sidesOf`, rather than assume.
   */
  home_team?: Team;
  away_team?: Team;
  /**
   * The field, for an event that has one instead of two sides.
   *
   * Present only for motorsport. Ordered as the provider reports it, which is
   * finishing order once a session is complete.
   */
  entrants?: Entrant[];
  /**
   * Which part of a race weekend this is: `Race`, `Qualifying`, `Practice 1`.
   * Null for anything that is not sessioned.
   */
  session?: string | null;
  /**
   * The event's own name, e.g. `Italian Grand Prix`.
   *
   * A field event is named rather than described by its participants, so this
   * is what it is called. Absent for a head-to-head fixture, which is named by
   * its two sides.
   */
  title?: string | null;
  venue: Venue;
  /** Null unless the provider supplies broadcast data. */
  broadcast: string | null;
  /**
   * Present only once a game has started, and only from providers that report
   * it on a fixture feed. A scheduled game has no score, so the field is absent
   * rather than zero-zero.
   */
  score?: Score;
}

/**
 * The two sides, for a fixture that has them.
 *
 * The one place the shape is decided. Returns null for a field event, so a
 * caller that needs two sides is made to say what it does without them rather
 * than reading `undefined.name` at runtime.
 */
export function sidesOf(game: Game): { home: Team; away: Team } | null {
  if (!game.home_team || !game.away_team) return null;
  return { home: game.home_team, away: game.away_team };
}

/** True for an event contested by a field rather than two sides. */
export function isFieldEvent(game: Game): boolean {
  return Array.isArray(game.entrants);
}

/**
 * A readable name for any fixture.
 *
 * `Arsenal v Chelsea` for a head-to-head, the event's own name for a race —
 * which is what a Grand Prix is actually called, rather than a pairing of two
 * of its drivers.
 */
export function fixtureLabel(game: Game): string {
  const sides = sidesOf(game);
  if (sides) return `${sides.away.name} v ${sides.home.name}`;
  return game.title ?? game.league ?? 'Event';
}

export interface NewsArticle {
  id: string;
  headline: string;
  /** Short provider summary. Never a full article body. */
  summary: string | null;
  category: string | null;
  source: string;
  /** ISO-8601 UTC instant, or null if unparseable. */
  published_at: string | null;
  image: string | null;
  url: string;
}

export interface AccuracySummary {
  /**
   * Wins over wins plus losses, as a **fraction**: 0.7647, not 76.47.
   *
   * The same scale the projection engine and every other probability in the
   * application use, so nothing has to remember which figures are which.
   * Format it with `percent()`; this said "0-100" for a while, and both
   * consumers dutifully printed the fraction with a `%` after it.
   *
   * Null until something has settled — never 0, which would read as a model
   * that is always wrong rather than one that has not been tested yet.
   */
  accuracy: number | null;
  correct: number;
  incorrect: number;
  settled: number;
  range: AccuracyRange;
}

export type AccuracyRange = 'all-time' | '30d';

export interface HomeSummary {
  games_today: number;
  sports_active: number;
  /** Fraction 0-1, as on `AccuracySummary`. Format with `percent()`. */
  accuracy: number | null;
  predictions_settled: number;
}

/** Machine-readable error codes returned alongside degraded sections. */
export type HomeErrorCode =
  | 'sports_data_unavailable'
  | 'news_data_unavailable'
  | 'accuracy_unavailable';

export interface GamesResponse {
  date: string;
  timezone: string;
  sport: SportId;
  games: Game[];
  error?: HomeErrorCode;
}

export interface NewsResponse {
  articles: NewsArticle[];
  error?: HomeErrorCode;
}

export interface AccuracyResponse extends AccuracySummary {
  error?: HomeErrorCode;
}

export interface HomeResponse {
  date: string;
  timezone: string;
  summary: HomeSummary;
  games: Game[];
  news: NewsArticle[];
  accuracy: AccuracySummary;
  /** Populated per section when a provider failed; the rest still loads. */
  errors: HomeErrorCode[];
}
