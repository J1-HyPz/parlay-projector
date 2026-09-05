'use client';

/**
 * Live scoreboard.
 *
 * Summary cards, then the filters, then the games. Desktop is a wide card,
 * mobile stacks the same information. Cards link to `/games/:id` with the
 * provider event id, so a live game opens the same detail page as Home and
 * Schedule.
 *
 * The filters describe the application rather than the minute. Every tracked
 * sport is always in the row, each carrying how many of its games are live and
 * how many are still to come; a sport with nothing on says so instead of
 * disappearing. Before, chips existed only for sports that happened to have a
 * game in play, so a quiet morning offered a single "All" button and gave no
 * hint that six other sports were being followed at all.
 */

import { Activity, Radio, RefreshCw, Search, Trophy, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { sidesOf } from '@/lib/home/types';
import { EventBody, eventHref, eventLabel } from '@/components/sports/event-body';
import type { Game } from '@/lib/home/types';
import type { LiveGame } from '@/lib/live/types';
import {
  ALL_COMPETITIONS,
  ALL_SPORTS,
  TRACKED_COMPETITIONS,
  competitionTallies,
  describeFilters,
  isFiltered,
  matchesLive,
  tallySports,
} from '@/lib/live/filters';
import type { LiveFilters } from '@/lib/live/filters';
import { formatKickoff, separatorFor, sportLabel } from '@/lib/schedule/filters';
import { WatchButton } from '@/components/watchlist/watch-button';
import { formatUpdatedAt, useLive } from './live-data';

function StatCard({
  label,
  icon: Icon,
  value,
  note,
}: {
  label: string;
  icon: LucideIcon;
  value: string;
  note: string;
}) {
  return (
    <article className="panel flex min-h-28 items-center justify-between p-4">
      <div>
        <p className="text-xs text-white/42">{label}</p>
        <p className="mt-2 text-2xl font-semibold text-white/75">{value}</p>
        <p className="mt-1 text-[10px] text-white/27">{note}</p>
      </div>
      <span className="grid size-10 place-items-center rounded-xl border border-violet-400/15 bg-violet-500/[.08] text-violet-300">
        <Icon className="size-[18px]" />
      </span>
    </article>
  );
}

/**
 * Live badge.
 *
 * Uses the application's purple accent, and the pulse is disabled under
 * `prefers-reduced-motion` via Tailwind's `motion-reduce` variant.
 */
function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-400/25 bg-violet-500/12 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-300">
      <span className="size-1.5 rounded-full bg-violet-400 motion-safe:animate-pulse motion-reduce:animate-none" />
      Live
    </span>
  );
}

/** A score that has not arrived yet shows `--`, never 0 or NaN. */
function Score({ value }: { value: number | null }) {
  return (
    <span className="text-xl font-semibold tabular-nums text-white/85 md:text-2xl">
      {value === null ? '--' : value}
    </span>
  );
}

function TeamRow({
  team,
  score,
}: {
  team: NonNullable<LiveGame['home_team']>;
  score: number | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {team.logo ? (
          // oxlint-disable-next-line nextjs/no-img-element -- remote team badge from the sports provider CDN; see components/home/games-today.tsx
          <img
            src={team.logo}
            alt=""
            loading="lazy"
            className="size-8 shrink-0 rounded-full border border-white/9 bg-white/[.04] object-contain"
          />
        ) : (
          <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/9 bg-white/[.04] text-[9px] text-white/40">
            {team.name.slice(0, 2).toUpperCase()}
          </span>
        )}
        <span className="truncate text-sm text-white/72">{team.name}</span>
      </div>
      <Score value={score} />
    </div>
  );
}

function GameCard({ game }: { game: LiveGame }) {
  const sides = sidesOf(game);

  return (
    <div className="relative">
      <a
        href={eventHref(game)}
        aria-label={
          sides
            ? `${sides.away.name} ${separatorFor(game.sport)} ${sides.home.name}, live, view game details`
            : `${eventLabel(game)}, live, view details`
        }
        className="panel block p-4 transition hover:border-violet-400/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 active:bg-white/[.06] md:p-5"
      >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pr-10">
        <LiveBadge />
        <span className="truncate text-[11px] font-medium uppercase tracking-wider text-violet-300">
          {sportLabel(game.sport)}
        </span>
        {game.league && (
          <>
            <span className="text-white/20">·</span>
            <span className="truncate text-[11px] text-white/45">{game.league}</span>
          </>
        )}
        {game.game_state.display && (
          <span className="ml-auto shrink-0 text-[11px] font-medium text-white/60">
            {game.game_state.display}
          </span>
        )}
      </div>

      <div className="mt-4 space-y-3 border-t border-white/7 pt-4">
        {sides ? (
          <>
            <TeamRow team={sides.away} score={game.score.away} />
            <TeamRow team={sides.home} score={game.score.home} />
          </>
        ) : (
          <EventBody game={game} compact />
        )}
      </div>

      {(game.venue.name ?? game.venue.city) && (
        <p className="mt-4 truncate border-t border-white/7 pt-3 text-[11px] text-white/31">
          {[game.venue.name, game.venue.city].filter(Boolean).join(' · ')}
        </p>
      )}
      </a>
      <WatchButton game={game} className="absolute right-3 top-3" />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse" aria-busy="true" aria-label="Loading live scores">
      {[0, 1, 2].map((card) => (
        <div key={card} className="panel p-4 md:p-5">
          <div className="flex items-center gap-3">
            <div className="h-5 w-14 rounded-md bg-white/[.06]" />
            <div className="h-3 w-16 rounded-full bg-white/[.05]" />
            <div className="ml-auto h-3 w-20 rounded-full bg-white/[.045]" />
          </div>
          <div className="mt-4 space-y-3 border-t border-white/7 pt-4">
            {[0, 1].map((row) => (
              <div key={row} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="size-8 rounded-full bg-white/[.06]" />
                  <div className="h-3 w-36 rounded-full bg-white/[.05]" />
                </div>
                <div className="h-5 w-8 rounded bg-white/[.06]" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}


/** Keeps the tail short so Live never becomes a second Schedule. */
const MAX_UPCOMING = 12;

function UpcomingRow({ game, timezone }: { game: Game; timezone: string }) {
  const sides = sidesOf(game);

  return (
    <div className="relative">
      <a
        href={eventHref(game)}
        aria-label={
          sides
            ? `${sides.away.name} ${separatorFor(game.sport)} ${sides.home.name}, starts ${formatKickoff(game.start_time, timezone)}, view game details`
            : `${eventLabel(game)}, starts ${formatKickoff(game.start_time, timezone)}, view details`
        }
        className="panel flex items-center gap-3 p-3 pr-12 transition hover:border-violet-400/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 active:bg-white/[.06]"
      >
      <span className="w-12 shrink-0 text-xs font-medium tabular-nums text-violet-300">
        {formatKickoff(game.start_time, timezone)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-white/68">
        {sides ? (
          <>
            {sides.away.name} <span className="text-white/28">{separatorFor(game.sport)}</span>{' '}
            {sides.home.name}
          </>
        ) : (
          eventLabel(game)
        )}
      </span>
      <span className="hidden shrink-0 truncate text-[11px] text-white/32 sm:block">
        {game.league ?? sportLabel(game.sport)}
      </span>
      </a>
      <WatchButton game={game} className="absolute right-2 top-1/2 -translate-y-1/2" />
    </div>
  );
}

export function LiveView() {
  const { state, data, stale, refresh } = useLive();
  const [sport, setSport] = useState<string>(ALL_SPORTS);
  const [league, setLeague] = useState<string>(ALL_COMPETITIONS);
  const [search, setSearch] = useState('');

  const games = useMemo(() => data?.games ?? [], [data]);
  const allUpcoming = useMemo(() => data?.upcoming ?? [], [data]);
  const timezone = data?.timezone ?? 'Europe/London';

  const filters: LiveFilters = { sport, league, search };

  /*
   * Every tracked sport, always, with what each currently holds.
   *
   * The counts respect the search box but not the sport already chosen, so
   * they answer "what would I get if I picked this instead" — counting the
   * current selection into every other chip would leave the row reading zero
   * the moment anything was picked.
   */
  const sports = useMemo(
    () => tallySports(games, allUpcoming, search),
    [games, allUpcoming, search],
  );

  const competitions = useMemo(
    () => competitionTallies(sport, games, search),
    [sport, games, search],
  );

  // The catalogue's competitions lead; everything else the provider happens to
  // be carrying follows, so the two are never mistaken for one another.
  const named = competitions.filter(
    (entry) => entry.id !== ALL_COMPETITIONS && entry.id !== TRACKED_COMPETITIONS,
  );
  const followed = named.filter((entry) => entry.tracked);
  const others = named.filter((entry) => !entry.tracked);

  /*
   * What "all sports" would give you.
   *
   * The search applies but the sport does not, exactly as on every other chip
   * — otherwise this one alone would keep reading 22 while the rest of the row
   * summed to four.
   */
  const acrossSports = games.filter((game) =>
    matchesLive(game, { sport: ALL_SPORTS, league: ALL_COMPETITIONS, search }),
  ).length;

  /*
   * Derived during render rather than memoised by hand.
   *
   * `filters` is a fresh object each render, so a dependency array would have
   * to list its three fields and hope nobody adds a fourth. The compiler
   * memoises this correctly without that trap.
   */
  const filtered = games.filter((game) => matchesLive(game, filters));
  const upcoming = allUpcoming.filter((game) => matchesLive(game, filters));

  /*
   * Changing sport clears the competition.
   *
   * Leaving "Premier League" selected under Basketball would be a filter that
   * describes nothing and matches nothing.
   */
  const chooseSport = useCallback((next: string) => {
    setSport(next);
    setLeague(ALL_COMPETITIONS);
  }, []);

  const clear = useCallback(() => {
    setSport(ALL_SPORTS);
    setLeague(ALL_COMPETITIONS);
    setSearch('');
  }, []);

  const summary = useMemo(
    () => ({
      live: games.length,
      sports: new Set(games.map((game) => game.sport)).size,
      tracked: sports.filter((entry) => entry.tracked > 0).length,
      leagues: new Set(games.map((game) => game.league).filter(Boolean)).size,
    }),
    [games, sports],
  );

  const updatedAt = formatUpdatedAt(data?.updated_at, timezone);
  const ready = state === 'loaded';

  return (
    <>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Live overview">
        <StatCard
          label="Live Now"
          icon={Radio}
          value={ready ? String(summary.live) : '--'}
          note="Games in progress"
        />
        <StatCard
          label="Sports Active"
          icon={Trophy}
          // Out of the sports actually tracked, so "1" reads as one of seven
          // rather than as the whole picture.
          value={ready ? `${summary.sports}/${summary.tracked}` : '--'}
          note="Of the sports tracked"
        />
        <StatCard
          label="Leagues Active"
          icon={Activity}
          value={ready ? String(summary.leagues) : '--'}
          note="With live games"
        />
        <StatCard
          label="Last Updated"
          icon={RefreshCw}
          value={updatedAt ?? '--'}
          note={`Refreshes every ${Math.round((data?.refresh_interval_ms ?? 30_000) / 1000)}s`}
        />
      </section>

      <section className="mt-5 space-y-3" aria-label="Live filters">
        {/*
          Every tracked sport, always.

          A sport with nothing live keeps its place with a zero rather than
          vanishing, so the row is a stable thing a reader can learn and the
          page says what it follows even when nothing is on.
        */}
        <div className="horizontal-cards" aria-label="Sport filters">
          <button
            type="button"
            aria-pressed={sport === ALL_SPORTS}
            onClick={() => chooseSport(ALL_SPORTS)}
            className={`min-h-9 shrink-0 rounded-xl border px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
              sport === ALL_SPORTS
                ? 'border-violet-500 bg-violet-600 text-white hover:bg-violet-500'
                : 'border-white/9 bg-white/[.02] text-white/48 hover:bg-white/[.05] hover:text-white'
            }`}
          >
            All sports
            <span
              className={`ml-1.5 tabular-nums ${
                sport === ALL_SPORTS ? 'text-white/70' : 'text-white/30'
              }`}
            >
              {ready ? acrossSports : '--'}
            </span>
          </button>

          {sports.map((entry) => {
            const active = sport === entry.id;
            // A sport the application does not track yet can never produce a
            // game, so it is offered as information rather than as a choice.
            const selectable = entry.tracked > 0;

            return (
              <button
                key={entry.id}
                type="button"
                aria-pressed={active}
                disabled={!selectable}
                title={
                  entry.unavailable ??
                  (entry.live === 0 && entry.upcoming > 0
                    ? `${entry.upcoming} still to start today`
                    : undefined)
                }
                onClick={() => chooseSport(entry.id)}
                className={`min-h-9 shrink-0 rounded-xl border px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                  active
                    ? 'border-violet-500 bg-violet-600 text-white hover:bg-violet-500'
                    : !selectable
                      ? 'cursor-not-allowed border-white/6 bg-white/[.01] text-white/18'
                      : entry.live > 0
                        ? 'border-white/9 bg-white/[.02] text-white/60 hover:bg-white/[.05] hover:text-white'
                        : // Nothing live: still selectable, because it may have
                          // games later today, but it should not compete for
                          // attention with a sport that is actually on.
                          'border-white/7 bg-white/[.01] text-white/28 hover:bg-white/[.04] hover:text-white/60'
                }`}
              >
                {entry.label}
                <span
                  className={`ml-1.5 tabular-nums ${
                    active
                      ? 'text-white/70'
                      : entry.live > 0
                        ? 'text-violet-300/80'
                        : 'text-white/20'
                  }`}
                >
                  {ready ? entry.live : '--'}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/*
            Search.

            The same match the Schedule uses, so a term that finds a fixture
            there finds it here: team names, a race and its drivers, the
            competition, and the venue.
          */}
          <div className="relative flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/28"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search team, competition, driver or venue"
              aria-label="Search live games"
              className="h-10 w-full rounded-xl border border-white/9 bg-white/[.02] pl-9 pr-9 text-xs text-white/70 outline-none placeholder:text-white/25 focus:border-violet-400/40"
            />
            {search !== '' && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-lg text-white/35 transition hover:bg-white/[.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/*
            Competitions actually on the board.

            Split into the ones this application follows and the ones it does
            not, because the scoreboard's provider answers with every live game
            in a sport worldwide while the rest of the application is about a
            catalogue of twenty-one. Both are worth seeing; conflating them is
            what made the old filter useless.
          */}
          {competitions.length > 0 && (
            <select
              aria-label="Competition"
              value={league}
              onChange={(event) => setLeague(event.target.value)}
              className="h-10 min-w-44 rounded-xl border border-white/9 bg-[#0f0d17] px-3 text-xs text-white/60 outline-none focus:border-violet-400/40 sm:max-w-[280px]"
            >
              {competitions
                .filter((entry) => entry.id === ALL_COMPETITIONS || entry.id === TRACKED_COMPETITIONS)
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label} ({entry.live})
                  </option>
                ))}

              {followed.length > 0 && (
                <optgroup label="Followed here">
                  {followed.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label} ({entry.live})
                    </option>
                  ))}
                </optgroup>
              )}

              {others.length > 0 && (
                <optgroup label="Also live elsewhere">
                  {others.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label} ({entry.live})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          )}

          {isFiltered(filters) && (
            <button
              type="button"
              onClick={clear}
              className="h-10 shrink-0 rounded-xl border border-white/9 bg-white/[.02] px-3 text-xs text-white/50 transition hover:bg-white/[.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
            >
              Clear
            </button>
          )}
        </div>
      </section>

      {stale && updatedAt && (
        <p className="mt-4 rounded-xl border border-amber-400/15 bg-amber-500/[.06] px-3 py-2 text-[11px] text-amber-200/80">
          Unable to refresh. Showing scores from {updatedAt}.
        </p>
      )}

      {/*
        `aria-live="polite"` on the count only. Announcing every card on a
        30-second cycle would spam a screen reader; the summary is enough to
        signal that something changed.
      */}
      <p className="sr-only" aria-live="polite">
        {ready
          ? `${filtered.length} ${filtered.length === 1 ? 'game' : 'games'} live${
              isFiltered(filters) ? ` ${describeFilters(filters)}` : ''
            }`
          : ''}
      </p>

      <section className="mt-4" aria-labelledby="live-list-heading">
        <h2 id="live-list-heading" className="sr-only">
          Live games
        </h2>

        {state === 'loading' ? (
          <Skeleton />
        ) : state === 'error' ? (
          <div className="panel flex min-h-[160px] flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-xs text-white/38">Live scores are temporarily unavailable.</p>
            <button
              type="button"
              onClick={refresh}
              className="min-h-9 rounded-xl border border-white/9 bg-white/[.025] px-3 text-xs text-white/55 transition hover:border-violet-400/30 hover:text-white"
            >
              Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="panel flex min-h-[160px] flex-col items-center justify-center gap-2 p-6 text-center">
            {/*
              What "nothing" actually means here.

              Three different situations used to share one sentence. Nothing on
              anywhere, nothing on in the chosen sport, and a search that found
              nothing are different facts, and only the last is something the
              reader can act on.
            */}
            <p className="text-xs text-white/45">
              {games.length === 0
                ? 'No games are live right now, in any tracked sport.'
                : `Nothing live ${describeFilters(filters)}.`}
            </p>

            {upcoming.length > 0 ? (
              <p className="text-[11px] text-white/32">
                {upcoming.length} {upcoming.length === 1 ? 'game is' : 'games are'} still to start
                today.
              </p>
            ) : null}

            <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
              {isFiltered(filters) && games.length > 0 && (
                <button
                  type="button"
                  onClick={clear}
                  className="text-xs text-violet-300 transition hover:text-violet-200"
                >
                  Show all {games.length} live {games.length === 1 ? 'game' : 'games'}
                </button>
              )}
              <a href="/schedule" className="py-1 text-xs text-violet-300 hover:text-violet-200">
                Check the Schedule
              </a>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        )}
      </section>

      {/* Later today only. Anything beyond today belongs on /schedule. */}
      {ready && upcoming.length > 0 && (
        <section className="mt-8" aria-labelledby="upcoming-heading">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h2 id="upcoming-heading" className="text-base font-semibold">
                Upcoming today
              </h2>
              <p className="mt-1 text-xs text-white/34">
                {upcoming.length} {upcoming.length === 1 ? 'game' : 'games'} still to start today
              </p>
            </div>
            <a href="/schedule" className="shrink-0 py-1 text-xs text-violet-300 hover:text-violet-200">
              Full schedule
            </a>
          </div>

          <div className="space-y-2">
            {upcoming.slice(0, MAX_UPCOMING).map((game) => (
              <UpcomingRow key={game.id} game={game} timezone={timezone} />
            ))}
          </div>

          {upcoming.length > MAX_UPCOMING && (
            <p className="mt-3 text-center text-[11px] text-white/30">
              Showing {MAX_UPCOMING} of {upcoming.length}.{' '}
              <a href="/schedule" className="text-violet-300 hover:text-violet-200">
                See all on the Schedule
              </a>
            </p>
          )}
        </section>
      )}
    </>
  );
}
