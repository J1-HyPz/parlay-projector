'use client';

/**
 * The middle of a fixture card, for an event contested by a field.
 *
 * Every card in the application — home, schedule, live, the hubs — shows two
 * sides stacked or facing one another. A race has neither. Rather than repeat
 * a race variant inside each of those four cards, the variant lives here once
 * and each card branches to it.
 *
 * What it shows depends on what is known. Before the session: its name and how
 * many are entered. Afterwards: the podium, which is the part anybody wants at
 * a glance, and the size of the field it came from.
 */

import { Flag, Trophy } from 'lucide-react';
import type { Entrant, Game } from '@/lib/home/types';

/** The finishing order, when the provider has published one. */
function finishers(game: Game): Entrant[] {
  const entrants = game.entrants ?? [];
  const placed = entrants.filter((entrant) => entrant.position !== null);
  return placed.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/*
 * There is no `eventHref` any more, and its absence is the point.
 *
 * A race card used to link to `/sports/:sport` rather than to the session,
 * because `/games/:id` could not serve one: the provider has no summary
 * endpoint for motorsport, so the detail request threw and every practice,
 * qualifying and race page showed "temporarily unavailable". Now that a
 * session's page is built from the scoreboard — see `lib/games/race-detail.ts`
 * — every card links to its own fixture, and the branch that decided otherwise
 * is gone rather than left returning one answer.
 */

/**
 * A label describing the event, for a card's `aria-label`.
 *
 * "Italian Grand Prix, Qualifying" rather than a pair of names that do not
 * exist.
 */
export function eventLabel(game: Game): string {
  const parts = [game.title ?? game.league ?? 'Event'];
  if (game.session) parts.push(game.session);
  return parts.join(', ');
}

/*
 * Gold, silver, bronze.
 *
 * Deliberately literal rather than routed through the status tokens: these are
 * not a good/warn/bad reading, they are the three podium colours, and folding
 * first place into "warning" amber would make the ramp meaningless. The middle
 * step uses the ink ramp because silver is exactly that.
 */
const PLACE_TONE = ['text-amber-200', 'text-ink-muted', 'text-orange-200/70'];

export function EventBody({ game, compact = false }: { game: Game; compact?: boolean }) {
  const order = finishers(game);
  const settled = game.status === 'finished' && order.length > 0;
  const field = game.entrants?.length ?? 0;

  return (
    <div className={compact ? 'mt-2.5' : 'mt-4'}>
      <p className="flex items-center gap-1.5 truncate text-sm font-medium text-ink-strong">
        <Flag className="size-3.5 shrink-0 text-violet-300" aria-hidden="true" />
        {game.title ?? game.league ?? 'Event'}
      </p>

      {game.session && (
        <p className="mt-0.5 pl-5 text-2xs text-violet-300/70">{game.session}</p>
      )}

      {settled ? (
        <ol className="mt-2 space-y-1 pl-5">
          {order.slice(0, 3).map((entrant, place) => (
            <li key={entrant.id ?? entrant.name} className="flex items-center gap-2 text-xs">
              <span
                className={`w-3 shrink-0 tabular-nums ${PLACE_TONE[place] ?? 'text-ink-subtle'}`}
                aria-hidden="true"
              >
                {entrant.position}
              </span>
              <span className="sr-only">Position {entrant.position}:</span>
              <span className="min-w-0 truncate text-ink">{entrant.name}</span>
              {place === 0 && (
                <Trophy className="size-3 shrink-0 text-amber-200/70" aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 pl-5 text-2xs text-ink-faint">
          {field > 0 ? `${field} entered` : 'Entry list to be confirmed'}
        </p>
      )}
    </div>
  );
}
