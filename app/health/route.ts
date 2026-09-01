/**
 * Liveness endpoint for the container health check.
 *
 * Deliberately trivial: it confirms the HTTP server is up and serving routes.
 * It does not check downstream services, because there are none yet.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { status: 'ok', service: 'parlay-projector' },
    { headers: { 'cache-control': 'no-store' } },
  );
}
