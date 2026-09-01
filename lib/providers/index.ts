/**
 * Provider bootstrap.
 *
 * Registers every known provider with its capabilities and enabled state.
 * Importing this module is what makes the registry aware of them, so services
 * import from here rather than reaching for adapters directly.
 */

import { newsConfig, espnConfig, sportsConfig } from '../config';
import { espnDescriptor } from './espn/adapter';
import { registerProvider } from './registry';

let bootstrapped = false;

export function bootstrapProviders(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  // Incumbent: fixtures, live scores and the base game record.
  registerProvider({
    id: 'thesportsdb',
    label: 'TheSportsDB',
    // Always enabled: it has a documented free test key, so the app runs with
    // no configuration at all.
    enabled: true,
    requiresCredentials: false,
    credentialEnvVar: 'SPORTS_API_KEY',
    capabilities: [
      'schedules',
      'live_scores',
      'game_details',
      'standings',
      'team_records',
      'recent_form',
    ],
    notes:
      sportsConfig.apiKey === '3'
        ? 'Using the public test key: heavily rate limited and league tables are truncated.'
        : undefined,
  });

  // Enrichment: records, form, head-to-head, broadcast, venue.
  registerProvider(espnDescriptor());

  // News.
  registerProvider({
    id: 'rss',
    label: 'RSS sports news',
    enabled: newsConfig.feedUrls.length > 0,
    disabledReason: newsConfig.feedUrls.length > 0 ? undefined : 'NEWS_FEED_URLS is empty',
    requiresCredentials: false,
    capabilities: ['news'],
  });
}

export { listProviders, providerHealth, withFallback } from './registry';
export type { Capability, ProviderDescriptor, ProviderHealth } from './capabilities';
