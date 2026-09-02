/**
 * Server start-up hook.
 *
 * The Discord notifier needs something to drive it, and the application runs as
 * a long-lived container, so an in-process timer is simpler and more reliable
 * than an external cron reaching in over HTTP.
 *
 * Guarded on the Node runtime: this file is also evaluated during the build and
 * on the edge runtime, and neither should start a poller.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startNotifier } = await import('./lib/notify/service');
  startNotifier();

  /*
   * The prediction tracker always runs.
   *
   * It moves predictions from pending to live to settled, and it is what keeps
   * the accuracy figures moving, so it must not depend on Discord being
   * configured. It also runs once on start-up: after a restart there may be
   * games that finished while the container was down.
   */
  if (process.env.PREDICTION_TRACKING_ENABLED !== 'false') {
    const { startSettlement } = await import('./lib/projections/settle-job');
    startSettlement();
  }
}
