/**
 * Process-local TTL cache.
 *
 * Keeps a browser refresh from becoming a provider request. In-memory is the
 * right size for this stage: the app is a single stateless container and the
 * cached values are cheap to rebuild. Swapping in Redis later means replacing
 * this module, not its callers.
 *
 * `inFlight` deduplicates concurrent misses, so ten simultaneous page loads on
 * a cold cache produce one provider call rather than ten.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

/**
 * TTL, either fixed or derived from the loaded value.
 *
 * The function form exists for values whose volatility is only knowable after
 * loading them — a finished game can be cached for hours, a live one cannot.
 */
export type Ttl<T> = number | ((value: T) => number);

export async function cached<T>(
  key: string,
  ttlMs: Ttl<T>,
  load: () => Promise<T>,
): Promise<{ value: T; hit: boolean }> {
  const now = Date.now();
  const existing = store.get(key);

  if (existing && existing.expiresAt > now) {
    return { value: existing.value as T, hit: true };
  }

  const pending = inFlight.get(key);
  if (pending) {
    return { value: (await pending) as T, hit: true };
  }

  const promise = load()
    .then((value) => {
      const ttl = typeof ttlMs === 'function' ? ttlMs(value) : ttlMs;
      store.set(key, { value, expiresAt: Date.now() + ttl });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return { value: (await promise) as T, hit: false };
}

/** Test helper; not used by request paths. */
export function clearCache(): void {
  store.clear();
  inFlight.clear();
}
