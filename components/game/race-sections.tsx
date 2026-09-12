'use client';

/**
 * The detail-page sections for one session of a race weekend.
 *
 * A race has no league table, no head-to-head and no squad news, so none of
 * the two-sided sections stand: they say nothing about twenty drivers and are
 * not rendered at all. What a session has instead is a field — an entry list
 * before it runs and a classified order after — and a place in a weekend of
 * other sessions.
 *
 * Both come from the same fixture the page was built from, so neither costs a
 * further request.
 */

import { CalendarClock, Flag } from 'lucide-react';
import type { Entrant } from '@/lib/home/types';
import type { GameDetail, SessionLink } from '@/lib/games/types';
import { EmptyNote } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDate, formatTime } from './game-data';
import { Section } from './game-sections';

/*
 * Gold, silver, bronze.
 *
 * Deliberately literal rather than routed through the status tokens, matching
 * the event card: these are the three podium colours, not a good/warn/bad
 * reading, and folding first place into amber "warning" would make the ramp
 * meaningless.
 */
const PLACE_TONE = ['text-amber-200', 'text-ink-muted', 'text-orange-200/70'];

/** The finishing order, when the provider has published one. */
function classified(entrants: readonly Entrant[]): Entrant[] {
  return entrants
    .filter((entrant) => entrant.position !== null)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/**
 * Who took part, and where they finished if the session has run.
 *
 * The heading changes with the answer rather than staying "Field" over a
 * result: a list of twenty names in finishing order is a classification, and
 * calling it an entry list would misdescribe it.
 */
export function RaceField({ game }: { game: GameDetail }) {
  const entrants = game.entrants ?? [];
  const order = classified(entrants);
  const settled = order.length > 0;
  const list = settled ? order : entrants;

  return (
    <Section title={settled ? 'Classification' : 'Entry list'} icon={Flag}>
      {list.length === 0 ? (
        <EmptyNote>
          {/* Not a fault on this side: the provider publishes an entry list
              only once a session has been run. Pointing at the projection
              matters, because that panel does name a field — taken from a
              session that has run — and the two would otherwise look like
              they disagree. */}
          The provider publishes an entry list only once a session has been run,
          so there is none for this one yet. Where the projection below names a
          field, it says which session it took it from.
        </EmptyNote>
      ) : (
        <ol className="divide-y divide-line">
          {list.map((entrant, index) => (
            <li
              key={entrant.id ?? entrant.name}
              className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
            >
              <span
                className={`w-6 shrink-0 text-right text-xs tabular-nums ${
                  settled
                    ? (PLACE_TONE[index] ?? 'text-ink-subtle')
                    : 'text-ink-faint'
                }`}
              >
                {settled ? entrant.position : index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                {entrant.name}
              </span>
              {entrant.affiliation && (
                <span className="hidden shrink-0 text-2xs text-ink-subtle sm:inline">
                  {entrant.affiliation}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {!settled && list.length > 0 && (
        <p className="mt-3 border-t border-line pt-3 text-2xs leading-4 text-ink-faint">
          Numbered in the order the provider lists them, which is not a grid and
          not a prediction.
        </p>
      )}
    </Section>
  );
}

/**
 * The rest of the weekend.
 *
 * A Grand Prix is five sessions, and a page showing one of them with no way
 * through to the others is a dead end — the reason race cards used to point
 * at the sport hub instead of at a session at all.
 */
export function RaceWeekend({ game }: { game: GameDetail }) {
  const sessions: SessionLink[] = game.weekend ?? [];
  if (sessions.length < 2) return null;

  return (
    <Section title="This weekend" icon={CalendarClock}>
      <ul className="divide-y divide-line">
        {sessions.map((session) => {
          const current = session.id === game.id;
          /*
           * The weekday as well as the time. A weekend runs across three
           * days, so five times on their own read as though they were out of
           * order — Friday's 16:00 practice above Saturday's 11:30 one.
           */
          const day = formatDate(session.start_time)?.split(' ')[0] ?? null;
          const time = formatTime(session.start_time);
          const label = session.session ?? 'Session';

          const body = (
            <>
              <span
                className={`min-w-0 flex-1 truncate text-xs ${
                  current ? 'font-medium text-ink-strong' : 'text-ink'
                }`}
              >
                {label}
                {current && <span className="sr-only"> (this page)</span>}
              </span>
              {time && (
                <span className="shrink-0 text-2xs text-ink-subtle">
                  {day ? `${day.slice(0, 3)} ` : ''}
                  <span className="tabular-nums">{time}</span>
                </span>
              )}
              <StatusBadge status={session.status} />
            </>
          );

          return (
            <li key={session.id}>
              {current ? (
                <div
                  aria-current="page"
                  className="flex items-center gap-3 rounded-lg px-2 py-2.5"
                >
                  {body}
                </div>
              ) : (
                <a
                  href={`/games/${encodeURIComponent(session.id)}`}
                  className="focus-ring flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-surface-2"
                >
                  {body}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
