/**
 * Minimal structured server-side logger.
 *
 * Deliberately tiny: one line per meaningful service event, never per render.
 * Secrets must never be passed in — see `redactUrl`, which strips the API key
 * out of provider URLs before they reach the log.
 */

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

export const logger = {
  info: (event: string, fields?: Record<string, unknown>) => emit('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit('error', event, fields),
};

/**
 * Strip credentials from a URL before logging it.
 *
 * TheSportsDB puts the API key in the path (`/api/v1/json/<key>/...`), and other
 * providers use query parameters, so both are scrubbed.
 */
export function redactUrl(url: string, apiKey?: string): string {
  let safe = url;
  if (apiKey && apiKey.length > 0) {
    safe = safe.split(apiKey).join('***');
  }
  try {
    const parsed = new URL(safe);
    for (const key of ['apikey', 'api_key', 'key', 'token', 'access_token']) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, '***');
    }
    return parsed.toString();
  } catch {
    return safe;
  }
}
