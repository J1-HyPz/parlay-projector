/**
 * Server start-up hook.
 *
 * Starts the two background processes the application needs a long-lived
 * process for: the Discord notifier, and the prediction tracker that settles
 * published predictions against real results.
 *
 * The runtime calls this lazily, on the first request rather than at boot, and
 * exactly once.
 *
 * ---
 *
 * A note on the guard, because getting it wrong is silent and total.
 *
 * This previously checked `process.env.NEXT_RUNTIME !== 'nodejs'` and returned
 * early. That variable is part of the build tooling and is **never set at
 * runtime** by this server, so the check was always true, `register()` always
 * returned immediately, and neither background process ever started. Nothing
 * errored — the notifier simply never sent, and every prediction sat pending
 * for ever while the accuracy figure stayed at zero.
 *
 * So the guard is now inverted: run unless we are somewhere a timer cannot
 * live. Prerendering is already excluded by the caller; an edge runtime
 * identifies itself, and a Node server does not.
 */

export async function register(): Promise<void> {
  // No process means no timers — a worker or edge environment, not this server.
  if (typeof process === 'undefined') return;
  // Edge runtimes announce themselves; a Node server sets nothing.
  if (process.env.NEXT_RUNTIME === 'edge') return;
  // Belt and braces: the caller already skips prerendering.
  if (process.env.VINEXT_PRERENDER === '1') return;

  const { logger } = await import('./lib/logger');
  logger.info('instrumentation_registered', {});

  const { startNotifier } = await import('./lib/notify/service');
  startNotifier();

  /*
   * The prediction tracker always runs.
   *
   * It moves predictions from pending to live to settled, and it is what keeps
   * the accuracy figures moving, so it must not depend on Discord being
   * configured. It also runs once immediately: after a restart there may be
   * games that finished while the container was down.
   */
  if (process.env.PREDICTION_TRACKING_ENABLED !== 'false') {
    const { startSettlement } = await import('./lib/projections/settle-job');
    startSettlement();
  }
}
