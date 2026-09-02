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
  const notifying = startNotifier();

  /*
   * Settlement runs regardless of Discord.
   *
   * The notifier's timer already drives it when a webhook is configured. When
   * one is not, predictions would otherwise sit pending forever and the
   * accuracy figures would never move, so it gets its own timer.
   */
  if (!notifying) {
    const { startSettlement } = await import('./lib/projections/settle-job');
    startSettlement();
  }
}
