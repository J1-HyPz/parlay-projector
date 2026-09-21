'use client';

/**
 * What the model expects named players to do.
 *
 * Analysis, and labelled as analysis. A projection is not a bet: a bet needs a
 * line, and a line has to come from a bookmaker rather than from this number —
 * see `lib/projections/player-selections.ts`. Where a book has quoted one, the
 * bet appears in Markets below with a price attached; this panel stays what it
 * is either way.
 *
 * Grouped by player rather than by statistic, because a reader asks "what is
 * this model expecting from him" far more often than "who has the most
 * receiving yards".
 */

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import type { PlayerProjection } from '@/lib/projections/types';
import { qualityLabel } from '@/lib/projections/types';
import { Section } from './game-sections';
import { EmptyNote } from '@/components/ui/states';

type State = 'loading' | 'ready' | 'empty' | 'error';

interface Response {
  players?: PlayerProjection[];
}

/** One player's rows, in the order the model ranked them. */
function groupByPlayer(players: readonly PlayerProjection[]): PlayerProjection[][] {
  const byPlayer = new Map<string, PlayerProjection[]>();
  for (const projection of players) {
    const list = byPlayer.get(projection.athlete_id);
    if (list) list.push(projection);
    else byPlayer.set(projection.athlete_id, [projection]);
  }
  return [...byPlayer.values()];
}

function PlayerRows({ rows }: { rows: PlayerProjection[] }) {
  const first = rows[0];

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-xs font-medium text-ink">{first.player}</p>
        {first.position && (
          <span className="shrink-0 text-2xs uppercase tracking-wider text-ink-faint">
            {first.position}
          </span>
        )}
      </div>

      <dl className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <div key={row.stat} className="flex items-baseline justify-between gap-3 text-2xs">
            <dt className="min-w-0 truncate text-ink-subtle">{row.stat_label}</dt>
            <dd className="shrink-0 tabular-nums text-ink">
              {row.expected}
              <span className="ml-2 text-ink-faint">
                usually {row.likely_range[0]}&ndash;{row.likely_range[1]}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-2 border-t border-line pt-2 text-2xs text-ink-faint">
        {/* The sample is the whole basis of the estimate, so it is never
            hidden behind a quality word alone. */}
        {first.games} game{first.games === 1 ? '' : 's'} on record ·{' '}
        {qualityLabel(first.data_quality)} data quality
        {first.recent.length > 0 && ` · recent ${first.recent.slice(0, 5).join(', ')}`}
      </p>
    </div>
  );
}

export function PlayerProjections({ gameId }: { gameId: string }) {
  const [state, setState] = useState<State>('loading');
  const [players, setPlayers] = useState<PlayerProjection[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(
          `/api/projections/games/${encodeURIComponent(gameId)}`,
          { signal: controller.signal, headers: { accept: 'application/json' } },
        );
        if (!response.ok) throw new Error(String(response.status));

        const body = (await response.json()) as Response;
        if (controller.signal.aborted) return;

        const found = body.players ?? [];
        setPlayers(found);
        setState(found.length > 0 ? 'ready' : 'empty');
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    }

    void load();
    return () => controller.abort();
  }, [gameId]);

  /*
   * Absent rather than empty.
   *
   * Most competitions have no player model at all, and a section that said
   * "none available" on every football fixture would be noise about a
   * capability that was never claimed for it.
   */
  if (state === 'empty') return null;

  return (
    <Section title="Player projections" icon={Users}>
      {state === 'loading' && (
        <div className="h-28 rounded-xl bg-surface-2 motion-safe:animate-pulse motion-reduce:animate-none" />
      )}

      {state === 'error' && <EmptyNote>Player projections could not be loaded right now.</EmptyNote>}

      {state === 'ready' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {groupByPlayer(players).map((rows) => (
              <PlayerRows key={rows[0].athlete_id} rows={rows} />
            ))}
          </div>

          {/*
            The two things a reader has to know about these numbers, said here
            rather than left to be inferred from their absence elsewhere.
          */}
          <p className="border-t border-line pt-3 text-2xs leading-5 text-ink-faint">
            These are projections, not bets. A bet needs a line, and a line comes from a
            bookmaker &mdash; where one has quoted a player market for this fixture it appears
            under Markets with its price. Each estimate is built from that player&rsquo;s own
            games and carries no view of the defence they face, and nothing here knows whether
            they will be selected: no lineup, depth chart or inactive list is published to this
            application.
          </p>
        </div>
      )}
    </Section>
  );
}
