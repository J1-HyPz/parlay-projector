'use client';

/**
 * Recent parlay results, cycling.
 *
 * Sits under the accuracy figure and shows what the percentage is actually made
 * of — a rate with no examples behind it is hard to trust, and hard to learn
 * anything from.
 *
 * It fetches independently of the shared homepage request, so a failure here
 * leaves the accuracy figure alone: the two are separate claims and one being
 * unavailable is no reason to withhold the other.
 *
 * Rotation is deliberately slow, pauses on hover and focus, and restarts its
 * clock whenever the reader moves it themselves so it never takes the card away
 * mid-read. Under `prefers-reduced-motion` the result still changes, it simply
 * changes without sliding.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, History } from 'lucide-react';
import type { SportId } from '@/lib/home/types';
import { sportLabel } from '@/lib/schedule/filters';

/** Slow enough to read a three-leg card without hurrying. */
const ROTATE_MS = 7000;

interface ResultLeg {
  id: string;
  selection: string;
  status: string;
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
}

/** What the line covered. Null where its legs did not agree. */
interface ResultScope {
  sport: string | null;
  competition: string | null;
  competitions: number;
}

interface ParlayResult {
  id: string;
  risk: string;
  scope?: ResultScope;
  status: 'won' | 'lost' | 'void';
  correct_legs: number;
  total_legs: number;
  legs: ResultLeg[];
  went_right: string | null;
  went_wrong: string | null;
}

type State = 'loading' | 'ready' | 'empty' | 'error';

/** A compact description of what a settled line covered. */
function scopeLabel(scope: ResultScope | undefined): string | null {
  if (!scope) return null;
  if (scope.competition) return scope.competition;
  if (scope.sport) return sportLabel(scope.sport as SportId);
  return scope.competitions > 1 ? `${scope.competitions} competitions` : null;
}

const VERDICT: Record<string, { label: string; mark: string; tone: string }> = {
  won: { label: 'Success', mark: '✓', tone: 'text-emerald-300' },
  lost: { label: 'Failed', mark: '✕', tone: 'text-white/45' },
  void: { label: 'Void', mark: '—', tone: 'text-amber-200/80' },
};

/**
 * The scoreline, or nothing.
 *
 * Both names and both scores, or the line is omitted entirely. A score without
 * names does not say which way round it went, and a name without a score is
 * not a result — neither is worth showing, and neither is worth inventing a
 * placeholder for.
 */
function scoreline(leg: ResultLeg): string | null {
  if (!leg.home_team || !leg.away_team) return null;
  if (typeof leg.home_score !== 'number' || typeof leg.away_score !== 'number') return null;
  return `${leg.home_team} ${leg.home_score}–${leg.away_score} ${leg.away_team}`;
}

function Leg({ leg }: { leg: ResultLeg }) {
  const won = leg.status === 'won';
  const score = scoreline(leg);

  return (
    <li className="flex gap-2">
      <span
        aria-hidden="true"
        className={`shrink-0 text-[11px] leading-5 ${won ? 'text-emerald-300' : 'text-white/35'}`}
      >
        {won ? '✓' : '✕'}
      </span>
      <span className="min-w-0">
        <span className="sr-only">{won ? 'Correct: ' : 'Incorrect: '}</span>
        <span className="block text-[12px] leading-5 text-white/72">{leg.selection}</span>
        {score && <span className="block text-[11px] leading-4 text-white/34">{score}</span>}
      </span>
    </li>
  );
}

export function RecentResults() {
  const [state, setState] = useState<State>('loading');
  const [results, setResults] = useState<ParlayResult[]>([]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  /*
   * Bumped on every manual move. It is in the timer effect's dependencies, so
   * moving by hand restarts the clock and the card stays put for a full
   * interval — the carousel never snatches a result away mid-read.
   */
  const [nudge, setNudge] = useState(0);
  const container = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch('/api/accuracy?section=recent-parlays&limit=10', {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(String(response.status));

        const body = (await response.json()) as { parlays?: ParlayResult[] };
        if (controller.signal.aborted) return;

        const parlays = body.parlays ?? [];
        setResults(parlays);
        setState(parlays.length === 0 ? 'empty' : 'ready');
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  const count = results.length;

  /*
   * Pause while the reader is on the card.
   *
   * Attached natively rather than as JSX props: hovering a panel is an
   * enhancement, not an interaction the element offers, and marking it up as
   * one would misrepresent it to assistive technology. `focusin` and `focusout`
   * also bubble, which `focus` and `blur` do not — so tabbing to the arrows
   * inside pauses it too.
   */
  useEffect(() => {
    const element = container.current;
    if (!element) return;

    const hold = () => setPaused(true);
    const release = () => setPaused(false);

    element.addEventListener('mouseenter', hold);
    element.addEventListener('mouseleave', release);
    element.addEventListener('focusin', hold);
    element.addEventListener('focusout', release);

    return () => {
      element.removeEventListener('mouseenter', hold);
      element.removeEventListener('mouseleave', release);
      element.removeEventListener('focusin', hold);
      element.removeEventListener('focusout', release);
    };
  }, [state]);

  useEffect(() => {
    if (paused || count <= 1) return;
    const timer = setInterval(() => setIndex((current) => (current + 1) % count), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused, count, nudge]);

  const move = useCallback(
    (step: number) => {
      setIndex((current) => (count === 0 ? 0 : (current + step + count) % count));
      setNudge((current) => current + 1);
    },
    [count],
  );

  if (state === 'loading') {
    return (
      <section className="mt-5 border-t border-white/7 pt-5" aria-busy="true">
        <p className="text-[10px] uppercase tracking-wider text-white/28">Recent parlay results</p>
        <div className="mt-3 h-28 rounded-xl bg-white/[.035] motion-safe:animate-pulse motion-reduce:animate-none" />
      </section>
    );
  }

  if (state === 'error' || state === 'empty') {
    return (
      <section className="mt-5 border-t border-white/7 pt-5">
        <p className="text-[10px] uppercase tracking-wider text-white/28">Recent parlay results</p>
        <p className="mt-2 text-[11px] leading-5 text-white/32">
          {state === 'error'
            ? 'Recent results unavailable.'
            : 'No completed parlays yet. Results will appear here once generated parlays have finished.'}
        </p>
      </section>
    );
  }

  // `index` can outrun a shorter list if the data reloads; wrap rather than
  // rendering nothing.
  const result = results[index % count];
  const verdict = VERDICT[result.status] ?? VERDICT.lost;

  return (
    <section
      ref={container}
      className="mt-5 border-t border-white/7 pt-5"
      aria-label="Recent parlay results"
    >
      <p className="text-[10px] uppercase tracking-wider text-white/28">Recent parlay results</p>

      <div
        // Keyed on the result so the card remounts and replays its entrance.
        // Under reduced motion the animation is dropped and the content simply
        // changes, which is the whole of what that preference asks for.
        key={result.id}
        className="mt-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-2 motion-safe:duration-300 motion-reduce:animate-none"
      >
        <span className="sr-only">
          Result {index + 1} of {count}.
        </span>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-200/80">
            {result.risk} risk
          </span>
          <span className={`text-[11px] font-semibold uppercase tracking-wide ${verdict.tone}`}>
            <span aria-hidden="true">{verdict.mark} </span>
            {verdict.label}
          </span>
          {/*
            Where the line came from, when its legs agree on one answer.

            A mixed line says how many competitions rather than naming one of
            them, which would be true of a third of it.
          */}
          {scopeLabel(result.scope) && (
            <span className="truncate text-[11px] text-white/34">{scopeLabel(result.scope)}</span>
          )}
          <span className="ml-auto text-[11px] tabular-nums text-white/32">
            {result.correct_legs} / {result.total_legs} correct
          </span>
        </div>

        <ul className="mt-3 space-y-2">
          {result.legs.map((leg) => (
            <Leg key={leg.id} leg={leg} />
          ))}
        </ul>

        {result.status === 'void' && (
          <p className="mt-3 text-[11px] leading-5 text-white/34">
            One or more games were not played, so this line could not be judged.
          </p>
        )}

        {result.went_right && (
          <div className="mt-3">
            <p className="text-[10px] uppercase tracking-wider text-white/28">What went right</p>
            <p className="mt-1 text-[11px] leading-5 text-white/45">{result.went_right}</p>
          </div>
        )}

        {result.went_wrong && (
          <div className="mt-2">
            <p className="text-[10px] uppercase tracking-wider text-white/28">What went wrong</p>
            <p className="mt-1 text-[11px] leading-5 text-white/45">{result.went_wrong}</p>
          </div>
        )}
      </div>

      {count > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => move(-1)}
            aria-label="Previous result"
            className="grid size-7 place-items-center rounded-lg text-white/35 transition hover:bg-white/[.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>

          <span className="flex items-center gap-1.5" aria-hidden="true">
            {results.map((entry, position) => (
              <span
                key={entry.id}
                className={`size-1.5 rounded-full transition ${
                  position === index % count ? 'bg-violet-400' : 'bg-white/15'
                }`}
              />
            ))}
          </span>

          <button
            type="button"
            onClick={() => move(1)}
            aria-label="Next result"
            className="grid size-7 place-items-center rounded-lg text-white/35 transition hover:bg-white/[.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <p className="mt-3 flex items-center gap-1.5 text-[10px] text-white/22">
        <History className="size-3 shrink-0" aria-hidden="true" />
        Settled lines this application generated and stored before kick-off.
      </p>
    </section>
  );
}
