/**
 * Provider capability model.
 *
 * Every provider declares what it can supply. Callers ask the registry for a
 * capability, not for a named provider, so adding a provider later is an
 * adapter plus a capability declaration — no page or service rewrite.
 */

export const CAPABILITIES = [
  'schedules',
  'live_scores',
  'game_details',
  'standings',
  'team_records',
  'recent_form',
  'head_to_head',
  'player_leaders',
  'broadcasts',
  'news',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Coarse health, tracked so a failing provider can be skipped for a while. */
export type ProviderHealth = 'available' | 'rate_limited' | 'unavailable' | 'disabled';

export interface ProviderDescriptor {
  /** Stable id used in logs, cache keys and provenance. */
  id: string;
  label: string;
  /**
   * False when required configuration is absent. A disabled provider is simply
   * skipped — its absence must never break a request.
   */
  enabled: boolean;
  /** Why it is disabled, for the diagnostics endpoint and logs. */
  disabledReason?: string;
  capabilities: readonly Capability[];
  /** Whether the provider needs credentials at all. */
  requiresCredentials: boolean;
  /** Environment variable that enables it, when it needs one. */
  credentialEnvVar?: string;
  /** Attribution or licensing note that must travel with the integration. */
  notes?: string;
}

export function supports(descriptor: ProviderDescriptor, capability: Capability): boolean {
  return descriptor.enabled && descriptor.capabilities.includes(capability);
}
