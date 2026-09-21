/**
 * Player prop prices, which are quoted one fixture at a time.
 *
 * Every other market this application reads comes from the competition-wide
 * odds endpoint: one request covers a whole card. Player props do not. The
 * provider serves them only from `/events/{id}/odds`, a request per fixture,
 * so pricing a full slate of them would cost more than every other market on
 * the page put together.
 *
 * That shape decides where this is used. A reader who has opened one fixture
 * gets one request for it; the slate-wide parlay build never touches this.
 *
 * **The region is separately configurable, and that is the point.** The
 * provider's own documentation says prop coverage is "mainly limited to US
 * sports and US bookmakers", and the UK bookmaker list states no prop
 * coverage at all — but this application does not build on documentation it
 * has not tested, and the UK books are what a UK reader can actually place a
 * bet with. So it asks the configured region first and reports what comes
 * back. `ODDS_API_PLAYER_REGION` exists so the answer can be acted on without
 * moving the match markets, which are correctly UK and should stay there.
 *
 * Billing is markets *returned* times regions, per event — so a region that
 * quotes none of this costs nothing beyond the request itself.
 */

import { cached } from '../cache.ts';
import { oddsApiConfig } from '../config.ts';
import { logger } from '../logger.ts';
import { getJsonWithHeaders } from '../http.ts';
import { priceFromDecimal } from '../markets/price.ts';
import { recordQuota, sportKeyFor } from './uk-books.ts';
import type { QuotedMarket } from '../markets/types';

const BASE = 'https://api.the-odds-api.com/v4';

/**
 * The provider's market keys, against this model's statistics.
 *
 * Only the six the model can actually price. Asking for more would cost
 * nothing extra — billing counts what comes back — but a quote the model has
 * no opinion on is a market this application must not appear to have a view
 * about, which is the same rule the fight and tennis markets follow.
 */
const MARKET_KEYS: Readonly<Record<string, { stat: string; label: string }>> = {
  player_pass_yds: { stat: 'passing_yards', label: 'Passing yards' },
  player_pass_tds: { stat: 'passing_touchdowns', label: 'Passing touchdowns' },
  player_rush_yds: { stat: 'rushing_yards', label: 'Rushing yards' },
  player_reception_yds: { stat: 'receiving_yards', label: 'Receiving yards' },
  player_receptions: { stat: 'receptions', label: 'Receptions' },
  player_anytime_td: { stat: 'anytime_touchdown', label: 'Anytime touchdown' },
};

export const PLAYER_MARKETS = Object.keys(MARKET_KEYS);

/** Resolve a bookmaker's spelling of a player to the provider's athlete id. */
export type ResolvePlayer = (name: string) => string | null;

interface RawPlayerOutcome {
  /** `Over` / `Under`, or `Yes` / `No` for a yes-no market. */
  name?: unknown;
  /** The player. The provider puts the person here, not in `name`. */
  description?: unknown;
  price?: unknown;
  point?: unknown;
}

interface RawPlayerMarket {
  key?: unknown;
  outcomes?: RawPlayerOutcome[] | null;
}

interface RawPlayerBook {
  key?: unknown;
  title?: unknown;
  markets?: RawPlayerMarket[] | null;
}

export interface RawEventOdds {
  id?: unknown;
  bookmakers?: RawPlayerBook[] | null;
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Quotes for one bookmaker's player markets.
 *
 * An outcome whose player cannot be resolved is dropped rather than guessed
 * at. Pricing the wrong person is worse than pricing nobody: the bet would
 * settle against a record that was never the one the model had an opinion
 * about, and nothing downstream could detect it.
 */
export function playerQuotesFrom(
  book: RawPlayerBook,
  fetchedAt: string,
  resolve: ResolvePlayer,
): QuotedMarket[] {
  const source = str(book.title) ?? str(book.key);
  if (!source) return [];

  const quotes: QuotedMarket[] = [];

  for (const market of book.markets ?? []) {
    const key = str(market.key);
    const mapped = key ? MARKET_KEYS[key] : undefined;
    if (!mapped) continue;

    for (const outcome of market.outcomes ?? []) {
      const player = str(outcome.description);
      const side = str(outcome.name);
      const decimal = num(outcome.price);
      if (!player || !side || decimal === null || decimal <= 1) continue;

      const athleteId = resolve(player);
      if (!athleteId) continue;

      const price = priceFromDecimal(decimal);
      if (!price) continue;

      /*
       * Two shapes, and they settle the same way.
       *
       * A yardage or reception market quotes Over/Under against a number. An
       * anytime touchdown quotes Yes/No against no number at all, which is
       * "more than nought" — so it becomes a line of 0.5 and the same rule,
       * rather than a second kind of settlement that would have to be kept in
       * step with the first.
       */
      const lower = side.toLowerCase();
      let direction: 'over' | 'under' | null = null;
      let line: number | null = null;

      if (lower === 'over' || lower === 'under') {
        direction = lower;
        line = num(outcome.point);
      } else if (lower === 'yes' || lower === 'no') {
        direction = lower === 'yes' ? 'over' : 'under';
        line = num(outcome.point) ?? 0.5;
      }
      if (!direction || line === null) continue;

      quotes.push({
        market: 'player_stat',
        period: 'full_game',
        selection: `${player} ${direction === 'over' ? 'Over' : 'Under'} ${line} ${mapped.label.toLowerCase()}`,
        side: null,
        direction,
        line,
        price,
        source,
        fetchedAt,
        settlement: {
          kind: 'player_stat',
          athleteId,
          player,
          stat: mapped.stat,
          statLabel: mapped.label,
          direction,
          line,
        },
      });
    }
  }

  return quotes;
}

/**
 * The best price for each distinct player market on one event.
 *
 * Best is unambiguous: a higher decimal pays more for the same outcome. Which
 * book it came from travels with the quote, exactly as it does for the team
 * markets, so a slip never implies one book offered all of it.
 */
export function bestPlayerQuotes(
  event: RawEventOdds,
  fetchedAt: string,
  resolve: ResolvePlayer,
): QuotedMarket[] {
  const best = new Map<string, QuotedMarket>();

  for (const book of event.bookmakers ?? []) {
    for (const quote of playerQuotesFrom(book, fetchedAt, resolve)) {
      const rule = quote.settlement;
      if (rule.kind !== 'player_stat') continue;
      const key = `${rule.athleteId}|${rule.stat}|${rule.direction}|${rule.line}`;
      const current = best.get(key);
      if (!current || quote.price.decimal > current.price.decimal) best.set(key, quote);
    }
  }

  return [...best.values()];
}

/** The region player props are asked for, which may differ from the match one. */
export function playerRegion(): string {
  return oddsApiConfig.playerRegion || oddsApiConfig.region;
}

/**
 * Player prop quotes for one fixture.
 *
 * Empty for every reason that is not an error: no key, the feature switched
 * off, a competition the provider does not key, or — the case the
 * documentation predicts — a region whose books quote none of this. None of
 * those is a failure, and none of them is reported as one.
 */
export async function playerPropsForEvent(
  leagueId: string,
  eventId: string,
  resolve: ResolvePlayer,
): Promise<QuotedMarket[]> {
  if (!oddsApiConfig.key || !oddsApiConfig.playerProps) return [];

  const sportKey = sportKeyFor(leagueId);
  if (!sportKey) return [];

  const region = playerRegion();

  const { value } = await cached(
    `odds:player-props:${leagueId}:${eventId}:${region}`,
    oddsApiConfig.cacheTtlMs,
    async () => {
      const url =
        `${BASE}/sports/${encodeURIComponent(sportKey)}/events/${encodeURIComponent(eventId)}/odds` +
        `?apiKey=${encodeURIComponent(oddsApiConfig.key)}` +
        `&regions=${encodeURIComponent(region)}` +
        `&markets=${encodeURIComponent(PLAYER_MARKETS.join(','))}` +
        `&oddsFormat=decimal`;

      try {
        const { value: body, headers } = await getJsonWithHeaders<RawEventOdds>(url, {
          timeoutMs: oddsApiConfig.timeoutMs,
          // The key travels in the query string, so it is redacted from any
          // log line this produces.
          redactSecret: oddsApiConfig.key,
        });
        const quota = recordQuota(headers);

        logger.info('odds_player_props_read', {
          league: leagueId,
          region,
          books: (body.bookmakers ?? []).length,
          markets: new Set(
            (body.bookmakers ?? []).flatMap((book) =>
              (book.markets ?? []).map((market) => String(market.key)),
            ),
          ).size,
          cost: quota.lastCost,
          remaining: quota.remaining,
        });

        return { event: body, fetchedAt: new Date().toISOString() };
      } catch (error) {
        logger.warn('odds_player_props_failed', {
          league: leagueId,
          region,
          reason: error instanceof Error ? error.message : 'unknown',
        });
        return { event: {} as RawEventOdds, fetchedAt: new Date().toISOString() };
      }
    },
  );

  return bestPlayerQuotes(value.event, value.fetchedAt, resolve);
}
