/**
 * Stable Parlay Projector data contract for the Home page.
 *
 * The frontend depends on these shapes only. Provider payloads are normalised
 * into them, so swapping a sports or news provider never reaches the UI.
 */

/** Sport identifiers accepted by the homepage API. */
export const SPORT_IDS = ['all', 'nfl', 'nba', 'mlb', 'nhl', 'football', 'tennis'] as const;
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
  home_team: Team;
  away_team: Team;
  venue: Venue;
  /** Null unless the provider supplies broadcast data. */
  broadcast: string | null;
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
  /** Percentage 0-100, or null when nothing has settled yet. */
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
