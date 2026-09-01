/**
 * Provider tuning profiles.
 *
 * The request throttling in this codebase exists for one reason: TheSportsDB's
 * public test key rate-limits hard enough that the 8-day Schedule window (up to
 * 48 requests) returns 429s in a burst. Those limits do not apply to a paid
 * key, so holding a premium key to the same ceiling wastes it.
 *
 * The profile is derived from the key alone, so setting `SPORTS_API_KEY`
 * changes the behaviour with no other configuration. Every value stays
 * individually overridable for a tier whose limits differ from these defaults.
 *
 * Pure — no env reads, no side effects — so the decision is directly testable.
 */

/** TheSportsDB's documented public test key. */
export const PUBLIC_TEST_KEY = '3';

export type TuningProfile = 'test-key' | 'premium';

export interface SportsTuning {
  profile: TuningProfile;
  /** Concurrent provider requests when filling the schedule window. */
  scheduleConcurrency: number;
  /** How long a schedule day is cached, in seconds. */
  scheduleTtlSeconds: number;
  /** How long today's fixtures are cached, in seconds. */
  todayCacheSeconds: number;
}

/**
 * Which profile a key implies.
 *
 * An empty or absent key means the app falls back to the test key, so it is
 * treated as the test profile rather than optimistically as premium.
 */
export function tuningProfileFor(apiKey: string | null | undefined): TuningProfile {
  const key = (apiKey ?? '').trim();
  if (key === '' || key === PUBLIC_TEST_KEY) return 'test-key';
  return 'premium';
}

/**
 * Defaults per profile.
 *
 * The premium numbers are deliberately moderate rather than maximal: paid tiers
 * still have limits, and the exact ceiling varies by plan. They are a
 * meaningful improvement that is unlikely to trip a limit, and every one can be
 * raised by environment variable.
 */
export function tuningFor(profile: TuningProfile): SportsTuning {
  if (profile === 'premium') {
    return {
      profile,
      // 48 requests at 10 wide is five waves rather than twelve.
      scheduleConcurrency: 10,
      // Fixtures can be refreshed far more often without risking the quota.
      scheduleTtlSeconds: 300,
      todayCacheSeconds: 60,
    };
  }

  return {
    profile,
    // Measured: anything wider than this reliably 429s on the test key.
    scheduleConcurrency: 4,
    scheduleTtlSeconds: 900,
    todayCacheSeconds: 120,
  };
}

/** Convenience: profile and defaults in one step. */
export function resolveTuning(apiKey: string | null | undefined): SportsTuning {
  return tuningFor(tuningProfileFor(apiKey));
}
