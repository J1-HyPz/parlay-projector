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

import { json } from '@/lib/home/api';
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

  return json({ providers });
}
