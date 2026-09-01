/**
 * /games/:gameId — individual game detail.
 *
 * A server component so a direct visit or a refresh renders on the server and
 * the route works without any client-side navigation having happened first.
 * It keeps the application shell; this is a child page, not a nav destination.
 */

import { AppShell } from '@/components/app-shell';
import { GameDetail } from '@/components/game/game-detail';

export const dynamic = 'force-dynamic';

export default async function GamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;

  return (
    <AppShell active="home">
      <GameDetail gameId={gameId} />
    </AppShell>
  );
}
