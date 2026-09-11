/**
 * UK bookmaker prices, from The Odds API.
 *
 * **Why this exists at all.** The prices that used to reach this application
 * came through the sports feed alongside the fixtures, and an audit of a week's
 * worth found exactly one book quoting: DraftKings, on 170 of 170 quotes.
 * DraftKings does not operate in the United Kingdom, so every price the
 * application showed was a price its reader could not take. The odds were real;
 * they were just real somewhere else.
 *
 * This module replaces that with books a UK reader can actually use — Sky Bet,
 * William Hill, Paddy Power, Ladbrokes, Coral, Betfred, BetVictor and the rest
 * of the `uk` region. It is a licensed, documented API with a published price
 * list, which is the same standard every other source here is held to: nothing
 * is scraped, and no bookmaker's site is touched directly.
 *
 * **It is off unless a key is set, and inert when it is not.** No key means no
 * request and no prices, and a fixture with no prices is reported as a model
 * projection whose availability is unverified — which is the truth, and which
 * is what the application already did when the old source had no quote. A
 * quota exhausted mid-month degrades the same way. Prices are an enhancement
 * to a projection and never a precondition for one.
 *
 * **The key is a credential.** Read from the environment only, never committed,
 * never logged and never sent to the browser. It goes in a query parameter
 * because the API requires that, so the URL is never logged either — only the
 * sport and the outcome are.
 *
 * **Matching.** This provider does not share identifiers with the fixtures
 * feed, so its events are joined to ours by the existing strict matcher: same
 * sport, same calendar day, and *both* teams. A single-team match is never
 * enough and an ambiguous one is treated as no match, because attaching
 * another fixture's prices to a game is worse than showing none.
 */

import { cached } from '../cache.ts';
import { oddsApiConfig } from '../config.ts';
import { logger } from '../logger.ts';
import { getJson, ProviderError } from '../http.ts';
import { findMatchingGame, sameTeam } from '../providers/matching.ts';
import { priceFromDecimal } from '../markets/price.ts';
import type { GameMarkets, QuotedMarket, Side } from '../markets/types.ts';
import type { League } from '../leagues/registry';
import type { Game } from '../home/types';

const BASE = 'https://api.the-odds-api.com/v4';

/**
 * Competition to the provider's own sport key.
 *
 * Absent means this competition is not priced, which is a fact about the
 * provider rather than a gap to fill in later: there is no key to guess.
 *
 * Tennis is deliberately absent. This provider keys tennis per *tournament*
 * (`tennis_atp_us_open` and so on) rather than per tour, so there is no single
 * key for the ATP, and neither tennis nor MMA is offered in parlays yet.
 */
const SPORT_KEYS: Readonly<Record<string, string>> = {
  nfl: 'americanfootball_nfl',
  ncaaf: 'americanfootball_ncaaf',
  nba: 'basketball_nba',
  wnba: 'basketball_wnba',
  mlb: 'baseball_mlb',
  nhl: 'icehockey_nhl',
  epl: 'soccer_epl',
  championship: 'soccer_efl_champ',
  'league-one': 'soccer_england_league1',
  ucl: 'soccer_uefa_champs_league',
  uel: 'soccer_uefa_europa_league',
  uecl: 'soccer_uefa_europa_conference_league',
  laliga: 'soccer_spain_la_liga',
  bundesliga: 'soccer_germany_bundesliga',
  seriea: 'soccer_italy_serie_a',
  ufc: 'mma_mixed_martial_arts',
};

/** Whether this competition can be priced at all. */
export function sportKeyFor(leagueId: string): string | null {
  return SPORT_KEYS[leagueId] ?? null;
}

// ---------------------------------------------------------------------------
// The untrusted payload
// ---------------------------------------------------------------------------

interface RawOutcome {
  name?: unknown;
  price?: unknown;
  point?: unknown;
}

interface RawMarket {
  key?: unknown;
  outcomes?: RawOutcome[] | null;
}

interface RawBookmaker {
  key?: unknown;
  title?: unknown;
  last_update?: unknown;
  markets?: RawMarket[] | null;
}

export interface RawUkEvent {
  id?: unknown;
  commence_time?: unknown;
  home_team?: unknown;
  away_team?: unknown;
  bookmakers?: RawBookmaker[] | null;
}

function str(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Reading one event
// ---------------------------------------------------------------------------

/**
 * Which of a fixture's two sides an outcome names, or null.
 *
 * Compared by the same token matcher used to join fixtures across providers,
 * because a book writes "Spurs" where a fixtures feed writes "Tottenham
 * Hotspur". An outcome that matches neither side — and a draw does not, by
 * design — is handled by the caller.
 */
function sideOf(
  outcomeName: string,
  homeName: string,
  awayName: string,
): 'home' | 'away' | null {
  const isHome = sameTeam(outcomeName, homeName);
  const isAway = sameTeam(outcomeName, awayName);
  // Both would mean the two sides are indistinguishable by name, which is not a
  // fixture this can price safely.
  if (isHome === isAway) return null;
  return isHome ? 'home' : 'away';
}

/**
 * The quotes one bookmaker offers on one fixture.
 *
 * Only the three markets this provider actually carries in its base price are
 * read: head-to-head, handicaps and totals. Nothing is inferred for a market
 * the book did not quote — that is the whole point of this work.
 */
function quotesFrom(
  book: RawBookmaker,
  homeName: string,
  awayName: string,
  fetchedAt: string,
): QuotedMarket[] {
  const source = str(book.title) ?? str(book.key);
  if (!source) return [];
  const quotes: QuotedMarket[] = [];

  for (const market of book.markets ?? []) {
    const key = str(market.key);
    for (const outcome of market.outcomes ?? []) {
      const name = str(outcome.name);
      const decimal = num(outcome.price);
      if (!name || decimal === null || decimal <= 1) continue;

      const price = priceFromDecimal(decimal);
      if (!price) continue;
      const point = num(outcome.point);
      const side = sideOf(name, homeName, awayName);

      if (key === 'h2h') {
        // A draw names neither side, which is how it is recognised.
        const isDraw = side === null && /^draw$|^tie$/i.test(name);
        if (!side && !isDraw) continue;
        const backed: Side = isDraw ? 'draw' : (side as 'home' | 'away');
        quotes.push({
          market: 'moneyline',
          period: 'full_game',
          selection: name,
          side: backed,
          direction: null,
          line: null,
          price,
          source,
          fetchedAt,
          settlement: { kind: 'winner', side: backed },
        });
      } else if (key === 'spreads' && side && point !== null) {
        quotes.push({
          market: 'spread',
          period: 'full_game',
          selection: name,
          side,
          direction: null,
          line: point,
          price,
          source,
          fetchedAt,
          settlement: { kind: 'spread', side, line: point },
        });
      } else if (key === 'totals' && point !== null) {
        const direction = /^over$/i.test(name) ? 'over' : /^under$/i.test(name) ? 'under' : null;
        if (!direction) continue;
        quotes.push({
          market: 'total',
          period: 'full_game',
          selection: name,
          side: null,
          direction,
          line: point,
          price,
          source,
          fetchedAt,
          settlement: { kind: 'total', direction, line: point },
        });
      }
    }
  }

  return quotes;
}

/**
 * One fixture's markets, from whichever book gave the best price per selection.
 *
 * Best rather than first, and best is unambiguous here: a higher decimal price
 * pays more for the same outcome, so taking the maximum is taking the best
 * available to the reader. Which book that was travels with the quote, so a
 * slip never implies one book offered all of it.
 */
function bestQuotes(event: RawUkEvent, fetchedAt: string): QuotedMarket[] {
  const homeName = str(event.home_team);
  const awayName = str(event.away_team);
  if (!homeName || !awayName) return [];

  const best = new Map<string, QuotedMarket>();
  for (const book of event.bookmakers ?? []) {
    for (const quote of quotesFrom(book, homeName, awayName, fetchedAt)) {
      const key = `${quote.market}|${quote.side ?? ''}|${quote.direction ?? ''}|${quote.line ?? ''}`;
      const current = best.get(key);
      if (!current || quote.price.decimal > current.price.decimal) best.set(key, quote);
    }
  }
  return [...best.values()];
}

/**
 * Join a provider payload to our fixtures, by name and day.
 *
 * Pure, and exported for that reason: this is where every judgement about a
 * price lives -- which side an outcome names, which market it is, which book
 * gave the best number, and whether an event is even the fixture we think it
 * is -- and none of it should only ever run against a live key.
 *
 * A fixture the payload does not cover simply gets no entry, and an event that
 * matches no fixture, or matches ambiguously, is dropped. Attaching another
 * match's prices to a game is worse than showing none.
 */
export function joinToFixtures(
  events: readonly RawUkEvent[],
  fixtures: readonly Game[],
  fetchedAt: string,
): Map<string, GameMarkets> {
  const candidates = fixtures.map((game) => ({
    date: game.start_time?.slice(0, 10) ?? null,
    homeTeam: game.home_team?.name ?? null,
    awayTeam: game.away_team?.name ?? null,
    id: game.id,
  }));

  const markets = new Map<string, GameMarkets>();

  for (const event of events) {
    const date = str(event.commence_time)?.slice(0, 10) ?? null;
    const match = findMatchingGame(
      { date, homeTeam: str(event.home_team), awayTeam: str(event.away_team) },
      candidates,
    );
    if (!match) continue;

    const quotes = bestQuotes(event, fetchedAt);
    if (quotes.length === 0) continue;

    /*
     * `source` names the books behind this fixture's prices, not one book.
     * Each quote already records which book gave it; this is the summary a
     * reader sees, and it must not imply a single book offered all of it.
     */
    const sources = [...new Set(quotes.map((quote) => quote.source))].sort();
    markets.set(match.id, {
      gameId: match.id,
      source: sources.length === 1 ? sources[0] : `${sources.length} UK books`,
      fetchedAt,
      markets: quotes,
    });
  }

  return markets;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

export interface UkOddsResult {
  /** Prices by our own game id. Empty when unavailable for any reason. */
  markets: ReadonlyMap<string, GameMarkets>;
  /** Credits this key has left, as the provider reports them. Null if unknown. */
  remaining: number | null;
}

const EMPTY: UkOddsResult = { markets: new Map(), remaining: null };

/**
 * Prices for one competition's fixtures.
 *
 * Takes the fixtures rather than a date range, because this provider has no
 * identifiers in common with them: the join is by name and day, and it needs
 * both sides to do it.
 */
export async function ukMarketsForLeague(
  league: League,
  fixtures: readonly Game[],
): Promise<UkOddsResult> {
  const sport = sportKeyFor(league.id);
  if (!oddsApiConfig.key || !sport || fixtures.length === 0) return EMPTY;

  try {
    const { value } = await cached(
      `uk-odds:${league.id}:${oddsApiConfig.region}`,
      oddsApiConfig.cacheTtlMs,
      async () => {
        /*
         * One request per competition, three markets, one region.
         *
         * The provider charges markets x regions per call, so this is three
         * credits. Asking for more regions to "see more books" would multiply
         * the bill for prices a UK reader cannot use anyway.
         */
        const url =
          `${BASE}/sports/${sport}/odds?apiKey=${encodeURIComponent(oddsApiConfig.key)}` +
          `&regions=${oddsApiConfig.region}&markets=h2h,spreads,totals` +
          `&oddsFormat=decimal&dateFormat=iso`;
        return getJson<RawUkEvent[]>(url, { timeoutMs: oddsApiConfig.timeoutMs });
      },
    );

    const events = Array.isArray(value) ? value : [];
    const markets = joinToFixtures(events, fixtures, new Date().toISOString());

    logger.info('uk_odds_refreshed', {
      league: league.id,
      events: events.length,
      fixtures: fixtures.length,
      matched: markets.size,
    });

    return { markets, remaining: null };
  } catch (error) {
    /*
     * Swallowed to nothing, deliberately.
     *
     * An exhausted quota, an expired key or an outage must degrade the
     * labelling rather than withhold the analysis: every selection simply
     * reports as unverified, exactly as it does for a fixture no book has
     * priced yet. The key is never included in what is logged.
     */
    logger.warn('uk_odds_failed', {
      league: league.id,
      reason: error instanceof ProviderError ? `status ${error.status}` : 'unknown',
    });
    return EMPTY;
  }
}
