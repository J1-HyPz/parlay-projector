/**
 * Shared helpers for the homepage API routes.
 *
 * Responses are never cached by the browser: freshness is managed server-side
 * by the service cache, which is what keeps provider calls down.
 */

import { SPORT_IDS } from './types';
import type { SportId } from './types';

export const NO_STORE = { 'cache-control': 'no-store' } as const;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * Validate the `sport` query parameter.
 *
 * Returns null for anything not on the allow-list so callers can reject it
 * rather than passing unvalidated input to a provider.
 */
export function parseSport(raw: string | null): SportId | null {
  if (raw === null || raw.trim() === '') return 'all';
  const value = raw.trim().toLowerCase();
  return (SPORT_IDS as readonly string[]).includes(value) ? (value as SportId) : null;
}

export function badRequest(message: string): Response {
  return json({ error: 'invalid_request', message }, 400);
}
