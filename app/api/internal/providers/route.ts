/**
 * GET /api/internal/providers
 *
 * Diagnostics: which providers are configured, whether they are enabled, and
 * their current health. Useful for confirming on TrueNAS that an optional
 * provider actually came up.
 *
 * Deliberately returns no secrets: no API keys, no base URLs, no credentials
 * and no request details. Only the provider id, label, capabilities, whether
 * it needs credentials, and a coarse health state.
 */

import { oddsApiConfig, sportsConfig } from '@/lib/config';
import { json } from '@/lib/home/api';
import { oddsQuota } from '@/lib/odds/uk-books';
import { bootstrapProviders, listProviders, providerHealth } from '@/lib/providers';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  bootstrapProviders();

  const providers = listProviders().map((descriptor) => ({
    id: descriptor.id,
    label: descriptor.label,
    enabled: descriptor.enabled,
    health: providerHealth(descriptor.id),
    capabilities: descriptor.capabilities,
    requires_credentials: descriptor.requiresCredentials,
    // The variable *name* only — never its value.
    credential_env_var: descriptor.credentialEnvVar ?? null,
    disabled_reason: descriptor.disabledReason ?? null,
    notes: descriptor.notes ?? null,
  }));

  return json({
    providers,
    // Non-sensitive: which throttling profile is active, so a premium key can
    // be confirmed without exposing it.
    tuning: {
      profile: sportsConfig.tuningProfile,
      schedule_concurrency: sportsConfig.scheduleConcurrency,
      schedule_cache_seconds: Math.round(sportsConfig.scheduleTtlMs / 1000),
      today_cache_seconds: Math.round(sportsConfig.cacheTtlMs / 1000),
    },
    /*
     * The bookmaker quota, as the provider itself reports it.
     *
     * Whether a key is configured, never which key — the same rule the rest of
     * this endpoint follows. `remaining` stays null until the first priced call
     * of the process, because it is read from that call's response headers
     * rather than asked for separately.
     */
    odds_budget: (() => {
      // snake_case, like every other field this application serves.
      const { remaining, used, lastCost, at, exhausted } = oddsQuota();
      return {
        configured: oddsApiConfig.key.length > 0,
        region: oddsApiConfig.region,
        cache_seconds: Math.round(oddsApiConfig.cacheTtlMs / 1000),
        remaining,
        used,
        last_cost: lastCost,
        measured_at: at,
        exhausted,
      };
    })(),
  });
}
