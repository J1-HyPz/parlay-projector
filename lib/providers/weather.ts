/**
 * Conditions at a fixture, from Open-Meteo.
 *
 * Free and keyless, which is why it was chosen: this project does not put
 * secrets in committed compose files, and a weather source that needed one
 * would have to earn that exception.
 *
 * Two calls, both cached hard:
 *
 *   Geocoding turns a venue's city into coordinates. The fixtures provider
 *   sends a venue's name, city and country but no latitude or longitude —
 *   checked before building this, as §4.5 step 1 asks. City-level precision is
 *   ample: a ground and its city share their weather, and the effect this
 *   feeds was measured at exactly this precision.
 *
 *   The forecast gives hourly temperature. A fixture is matched to the hour it
 *   starts.
 *
 * **Nothing here ever guesses.** A failed lookup, an unknown city, a fixture
 * outside the forecast horizon or a missing hour all yield null, and null
 * means the projection is made exactly as it would have been before this
 * existed. A stale or invented temperature would move a total on no evidence,
 * which is the one outcome worse than having no weather at all.
 */

import { cached } from '../cache.ts';
import { logger } from '../logger.ts';
import { getJson } from '../http.ts';
import type { FixtureConditions } from '../projections/weather.ts';
import type { Game } from '../home/types';

const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

const TIMEOUT_MS = 6_000;
/** Cities do not move. */
const GEOCODE_TTL_MS = 30 * 24 * 60 * 60_000;
/** A forecast worth re-reading a few times a day, not a few times a minute. */
const FORECAST_TTL_MS = 3 * 60 * 60_000;

interface RawGeocode {
  results?: { latitude?: unknown; longitude?: unknown }[];
}

interface RawForecast {
  hourly?: { time?: unknown[]; temperature_2m?: unknown[] };
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Coordinates for a city, or null when it cannot be resolved. */
export async function coordinatesFor(city: string): Promise<Coordinates | null> {
  const name = city.trim();
  if (name.length === 0) return null;

  try {
    const { value } = await cached(`weather:geo:${name.toLowerCase()}`, GEOCODE_TTL_MS, async () => {
      const payload = await getJson<RawGeocode>(
        `${GEOCODE}?name=${encodeURIComponent(name)}&count=1&language=en&format=json`,
        { timeoutMs: TIMEOUT_MS },
      );
      const hit = payload?.results?.[0];
      const latitude = num(hit?.latitude);
      const longitude = num(hit?.longitude);
      return latitude !== null && longitude !== null ? { latitude, longitude } : null;
    });
    return value;
  } catch (error) {
    logger.warn('weather_geocode_failed', {
      city: name,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

/**
 * Hourly temperatures for a city over a date range, keyed by `YYYY-MM-DDTHH`.
 *
 * One request covers every fixture that city hosts in the window, so a slate
 * costs one call per city rather than one per fixture.
 */
async function hourlyTemperatures(
  city: string,
  from: string,
  to: string,
): Promise<ReadonlyMap<string, number>> {
  const coordinates = await coordinatesFor(city);
  if (!coordinates) return new Map();

  try {
    const { value } = await cached(
      `weather:hourly:${city.toLowerCase()}:${from}:${to}`,
      FORECAST_TTL_MS,
      async () => {
        const payload = await getJson<RawForecast>(
          `${FORECAST}?latitude=${coordinates.latitude}&longitude=${coordinates.longitude}` +
            `&hourly=temperature_2m&start_date=${from}&end_date=${to}&timezone=UTC`,
          { timeoutMs: TIMEOUT_MS },
        );

        const times = payload?.hourly?.time ?? [];
        const temperatures = payload?.hourly?.temperature_2m ?? [];
        const byHour = new Map<string, number>();

        for (let index = 0; index < times.length; index += 1) {
          const hour = typeof times[index] === 'string' ? (times[index] as string).slice(0, 13) : null;
          const temperature = num(temperatures[index]);
          if (hour && temperature !== null) byHour.set(hour, temperature);
        }
        return byHour;
      },
    );
    return value;
  } catch (error) {
    logger.warn('weather_forecast_failed', {
      city,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return new Map();
  }
}

/**
 * Conditions for a set of fixtures, keyed by game id.
 *
 * Grouped by city so a slate costs one request per city. A fixture already
 * known to be covered is skipped before any request is made — there is no
 * point forecasting weather for a dome.
 */
export async function conditionsForGames(
  games: readonly Game[],
): Promise<Map<string, FixtureConditions>> {
  const outdoor = games.filter(
    (game) => game.venue?.indoor === false && game.venue.city && game.start_time,
  );
  if (outdoor.length === 0) return new Map();

  const byCity = new Map<string, Game[]>();
  for (const game of outdoor) {
    const city = game.venue.city as string;
    const list = byCity.get(city);
    if (list) list.push(game);
    else byCity.set(city, [game]);
  }

  const conditions = new Map<string, FixtureConditions>();

  await Promise.all(
    [...byCity.entries()].map(async ([city, list]) => {
      const dates = list
        .map((game) => game.start_time?.slice(0, 10))
        .filter((date): date is string => date !== undefined)
        .sort();
      const hours = await hourlyTemperatures(city, dates[0], dates[dates.length - 1]);

      for (const game of list) {
        const hour = game.start_time?.slice(0, 13);
        const temperature = hour ? hours.get(hour) : undefined;
        // No hour, no adjustment. Never the nearest one, and never an average.
        if (temperature === undefined) continue;
        conditions.set(game.id, { temperature_c: temperature, indoor: false });
      }
    }),
  );

  return conditions;
}
