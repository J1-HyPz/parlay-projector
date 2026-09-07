/**
 * Provider registry: priority, health and fallback.
 *
 * One place decides which provider serves each capability. Services ask for a
 * capability; they never name a provider. That is what makes adding a provider
 * a configuration change rather than a rewrite.
 *
 * Health is tracked in memory so a provider that just rate-limited is skipped
 * for a cool-off rather than being hammered on the next request.
 */

import { logger } from '../logger';
import { ProviderError } from '../http';
import type { Capability, ProviderDescriptor, ProviderHealth } from './capabilities';
import { supports } from './capabilities';

/** How long a provider is skipped after a failure, by failure kind. */
const COOL_OFF_MS: Record<Exclude<ProviderHealth, 'available' | 'disabled'>, number> = {
  rate_limited: 5 * 60_000,
  unavailable: 60_000,
};

interface HealthEntry {
  state: ProviderHealth;
  until: number;
  lastReason?: string;
}

const health = new Map<string, HealthEntry>();
const registered = new Map<string, ProviderDescriptor>();

/**
 * Priority per capability, most preferred first.
 *
 * Deliberately explicit rather than inferred: the ordering encodes real
 * judgements about which source is authoritative for which kind of data.
 */
const PRIORITY: Record<Capability, readonly string[]> = {
  // TheSportsDB is the incumbent for fixtures and scores and works well.
  schedules: ['thesportsdb'],
  live_scores: ['thesportsdb'],
  // The base game record stays with the incumbent; ESPN enriches it.
  game_details: ['thesportsdb'],
  // Everything below is where TheSportsDB is thin or absent, so ESPN leads.
  standings: ['espn', 'thesportsdb'],
  team_records: ['espn', 'thesportsdb'],
  recent_form: ['espn', 'thesportsdb'],
  head_to_head: ['espn'],
  player_leaders: ['espn'],
  broadcasts: ['espn'],
  news: ['rss'],
};

export function registerProvider(descriptor: ProviderDescriptor): void {
  registered.set(descriptor.id, descriptor);
  if (!descriptor.enabled) {
    health.set(descriptor.id, { state: 'disabled', until: 0, lastReason: descriptor.disabledReason });
  }
}

export function listProviders(): ProviderDescriptor[] {
  return [...registered.values()];
}

export function providerHealth(id: string): ProviderHealth {
  const descriptor = registered.get(id);
  if (!descriptor) return 'unavailable';
  if (!descriptor.enabled) return 'disabled';

  const entry = health.get(id);
  if (!entry || entry.state === 'available') return 'available';
  // Cool-off expired: give it another chance.
  if (Date.now() >= entry.until) {
    health.set(id, { state: 'available', until: 0 });
    return 'available';
  }
  return entry.state;
}

export function markHealthy(id: string): void {
  const entry = health.get(id);
  if (entry && entry.state !== 'available' && entry.state !== 'disabled') {
    logger.info('provider_recovered', { provider: id });
  }
  if (registered.get(id)?.enabled) health.set(id, { state: 'available', until: 0 });
}

export function markFailed(id: string, error: unknown): void {
  const rateLimited = error instanceof ProviderError && error.rateLimited;
  const state: 'rate_limited' | 'unavailable' = rateLimited ? 'rate_limited' : 'unavailable';

  health.set(id, {
    state,
    until: Date.now() + COOL_OFF_MS[state],
    lastReason: error instanceof Error ? error.message : 'unknown',
  });

  logger.warn(rateLimited ? 'provider_rate_limited' : 'provider_unavailable', {
    provider: id,
    cool_off_ms: COOL_OFF_MS[state],
    reason: error instanceof Error ? error.message : 'unknown',
  });
}

/** Providers that can serve a capability right now, in priority order. */
export function providersFor(capability: Capability): ProviderDescriptor[] {
  const order = PRIORITY[capability] ?? [];
  return order
    .map((id) => registered.get(id))
    .filter((descriptor): descriptor is ProviderDescriptor => {
      if (!descriptor || !supports(descriptor, capability)) return false;
      return providerHealth(descriptor.id) === 'available';
    });
}

export interface CapabilityResult<T> {
  value: T;
  /** Provider that actually served the request, for provenance. */
  providerId: string;
}

/**
 * Run a capability against providers in priority order, stopping at the first
 * success.
 *
 * Deliberately sequential: fallback exists for when the preferred provider is
 * unavailable, not as an excuse to call every provider on every request.
 *
 * Returns null when no provider is configured, healthy, or able to answer —
 * callers treat that as "this enrichment is unavailable", never as an error.
 */
export async function withFallback<T>(
  capability: Capability,
  run: (descriptor: ProviderDescriptor) => Promise<T | null>,
): Promise<CapabilityResult<T> | null> {
  const candidates = providersFor(capability);

  if (candidates.length === 0) {
    logger.info('capability_unavailable', { capability });
    return null;
  }

  for (const [index, descriptor] of candidates.entries()) {
    try {
      const value = await run(descriptor);
      markHealthy(descriptor.id);

      if (value === null || value === undefined) continue;

      if (index > 0) {
        logger.info('provider_fallback_used', {
          capability,
          provider: descriptor.id,
          skipped: candidates.slice(0, index).map((c) => c.id),
        });
      }
      return { value, providerId: descriptor.id };
    } catch (error) {
      markFailed(descriptor.id, error);
      // Try the next provider rather than failing the caller.
    }
  }

  return null;
}

/** Test helper; not used by request paths. */
export function resetRegistry(): void {
  registered.clear();
  health.clear();
}
