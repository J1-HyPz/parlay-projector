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

export async function cached<T>(
  key: string,
  ttlMs: number,
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
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
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
