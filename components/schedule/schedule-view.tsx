'use client';

/**
 * Schedule page content.
 *
 * Preserves the existing layout exactly: summary cards, an eight-day selector,
 * sport chips, search and league filters, then a desktop table and a stacked
 * mobile card list. Only the data behind them is real now.
 *
 * Every row links to `/games/:id` with the provider event id, so schedule games
 * open the same detail page as Home. Plain anchors are used deliberately — see
 * components/home/games-today.tsx.
 */

import { CalendarDays, Clock3, Search, Trophy } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { sidesOf } from '@/lib/home/types';
import { EventBody, eventLabel } from '@/components/sports/event-body';
import type { Game } from '@/lib/home/types';
import {
  ALL_LEAGUES,
  ALL_SPORTS,
  isChipId,
  visibleChips,
  badgeLabel,
  chipLabel,
  chipMatches,
  applyFilters,
  availableLeagues,
  formatDateHeading,
  formatDayTab,
  formatKickoff,
  groupByDate,
  separatorFor,
  sportLabel,
  summarise,
} from '@/lib/schedule/filters';
import { WatchButton } from '@/components/watchlist/watch-button';
import { STATUS_LABEL, statusTone } from '@/lib/schedule/status';
import { useSchedule } from './schedule-data';

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

function TeamLine({ team }: { team: NonNullable<Game['home_team']> }) {
  return (
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
      <span className="truncate text-sm text-white/68">{team.name}</span>
    </div>
  );
}

const ROW_GRID =
  'grid-cols-[110px_130px_minmax(210px,1.3fr)_minmax(150px,1fr)_120px_90px_44px]';

function DesktopRow({ game, timezone }: { game: Game; timezone: string }) {
  const sides = sidesOf(game);

  return (
    <div className="relative border-b border-white/[.065] last:border-b-0">
      <a
        href={`/games/${game.id}`}
        aria-label={
          sides
            ? `${sides.away.name} ${separatorFor(game.sport)} ${sides.home.name}, view game details`
            : `${eventLabel(game)}, view details`
        }
        className={`grid min-h-[78px] ${ROW_GRID} items-center gap-4 px-4 py-3 transition hover:bg-violet-500/[.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400/50`}
      >
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/8 bg-white/[.04] text-[9px] text-violet-300">
          {badgeLabel(game.league, game.sport)}
        </span>
        <span className="truncate text-xs text-white/52">{game.league ?? sportLabel(game.sport)}</span>
      </div>

      <div className="text-xs leading-5 text-white/45">
        <span className="block">{formatKickoff(game.start_time, timezone)}</span>
        {game.round && <span className="text-white/28">Round {game.round}</span>}
      </div>

      <div className="min-w-0 space-y-2">
        {sides ? (
          <>
            <TeamLine team={sides.away} />
            <TeamLine team={sides.home} />
          </>
        ) : (
          <EventBody game={game} compact />
        )}
      </div>

      <div className="min-w-0 text-xs leading-5 text-white/38">
        <span className="block truncate">{game.venue.name ?? 'Venue TBC'}</span>
        {game.venue.city && <span className="truncate text-white/25">{game.venue.city}</span>}
      </div>

      <span className="truncate text-xs text-white/32">{game.broadcast ?? '--'}</span>

      <span className={`w-fit rounded-full border px-2 py-1 text-[10px] ${statusTone(game.status)}`}>
        {STATUS_LABEL[game.status]}
      </span>

        {/* Reserves the trailing column; the button is a sibling of the link,
            because a button nested inside an anchor is invalid and would fight
            the navigation. */}
        <span aria-hidden="true" />
      </a>
      <WatchButton game={game} className="absolute right-3 top-1/2 -translate-y-1/2" />
    </div>
  );
}

function MobileCard({ game, timezone }: { game: Game; timezone: string }) {
  const sides = sidesOf(game);

  return (
    <div className="relative">
      <a
        href={`/games/${game.id}`}
        aria-label={
          sides
            ? `${sides.away.name} ${separatorFor(game.sport)} ${sides.home.name}, view game details`
            : `${eventLabel(game)}, view details`
        }
        className="panel block p-4 transition hover:border-violet-400/35 active:bg-white/[.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
      >
      <div className="flex items-center justify-between gap-3 border-b border-white/7 pb-3 pr-10">
        <span className="truncate text-xs font-medium text-violet-300">
          {game.league ?? sportLabel(game.sport)}
          {game.round ? ` • Round ${game.round}` : ''}
        </span>
        <span className="shrink-0 text-[11px] text-white/32">
          {formatKickoff(game.start_time, timezone)}
        </span>
      </div>

      <div className="my-4 space-y-3">
        {sides ? (
          <>
            <TeamLine team={sides.away} />
            <div className="pl-[42px] text-[10px] uppercase tracking-wider text-white/25">
              {separatorFor(game.sport)}
            </div>
            <TeamLine team={sides.home} />
          </>
        ) : (
          <EventBody game={game} />
        )}
      </div>

      <div className="flex items-end justify-between gap-3 text-[11px]">
        <span className="min-w-0 leading-5 text-white/31">
          <span className="block truncate">{game.venue.name ?? 'Venue TBC'}</span>
          {game.venue.city && <span className="block truncate">{game.venue.city}</span>}
        </span>
        <span
          className={`shrink-0 rounded-full border px-2 py-1 ${statusTone(game.status)}`}
        >
          {STATUS_LABEL[game.status]}
        </span>
      </div>
      </a>
      <WatchButton game={game} className="absolute right-3 top-3" />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading schedule">
      <div className="hidden overflow-hidden rounded-2xl border border-white/[.085] bg-white/[.018] md:block">
        {[0, 1, 2, 3].map((row) => (
          <div
            key={row}
            className={`grid min-h-[78px] ${ROW_GRID} items-center gap-4 border-b border-white/[.065] px-4 py-3 last:border-b-0`}
          >
            <div className="h-3 w-16 rounded-full bg-white/[.06]" />
            <div className="h-3 w-14 rounded-full bg-white/[.05]" />
            <div className="space-y-2">
              <div className="h-3 w-40 rounded-full bg-white/[.06]" />
              <div className="h-3 w-32 rounded-full bg-white/[.045]" />
            </div>
            <div className="h-3 w-28 rounded-full bg-white/[.045]" />
            <div className="h-3 w-16 rounded-full bg-white/[.04]" />
            <div className="h-5 w-20 rounded-full bg-white/[.05]" />
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:hidden">
        {[0, 1, 2].map((card) => (
          <div key={card} className="panel space-y-4 p-4">
            <div className="h-3 w-24 rounded-full bg-white/[.06]" />
            <div className="h-3 w-40 rounded-full bg-white/[.05]" />
            <div className="h-3 w-36 rounded-full bg-white/[.05]" />
            <div className="h-3 w-28 rounded-full bg-white/[.04]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Notice({ children }: { children: string }) {
  return (
    <div className="panel flex min-h-[140px] items-center justify-center p-6 text-center text-xs text-white/38">
      {children}
    </div>
  );
}

/**
 * @param initialSport Chip id to open with, from `?sport=` on the route. The
 *   page resolves it server-side and passes it in, so the first render already
 *   has the right filter -- reading `window.location` here instead would either
 *   mismatch hydration or need an effect that re-renders immediately.
 */
export function ScheduleView({ initialSport }: { initialSport?: string }) {
  const { state, data, retry } = useSchedule();

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [sport, setSport] = useState<string>(
    initialSport && isChipId(initialSport) ? initialSport : ALL_SPORTS,
  );
  const [league, setLeague] = useState<string>(ALL_LEAGUES);
  const [search, setSearch] = useState('');

  const timezone = data?.timezone ?? 'Europe/London';
  const dates = useMemo(() => data?.dates ?? [], [data]);
  const games = useMemo(() => data?.games ?? [], [data]);

  // Today is selected by default; `dates[0]` is today in the app timezone.
  const activeDate = selectedDate ?? dates[0] ?? null;

  // Only competitions with games in the window get a chip — the NBA, WNBA and
  // both NCAA basketball divisions are dark for months, and a chip that can
  // only return nothing is noise.
  const chips = useMemo(() => visibleChips(games), [games]);

  // A refresh can retire the active chip, e.g. the last fixture of a
  // competition finishing. Fall back to All rather than filtering to nothing.
  const activeChip = chips.some((chip) => chip.id === sport) ? sport : ALL_SPORTS;

  // A sport was asked for but has no chip: an out-of-season sidebar link, or a
  // competition whose last fixture finished mid-session. Say so, rather than
  // silently showing everything and leaving the fallback unexplained.
  const unavailable = sport !== ALL_SPORTS && activeChip === ALL_SPORTS ? sport : null;

  // League options follow the sport chip: picking Basketball should not still
  // offer the Premier League.
  const leagues = useMemo(
    () => availableLeagues(
        activeChip === ALL_SPORTS ? games : games.filter((g) => chipMatches(g, activeChip)),
      ),
    [games, activeChip],
  );
  const summary = useMemo(() => summarise(games, dates, timezone), [games, dates, timezone]);

  const filtered = useMemo(
    () => applyFilters(games, { date: activeDate, sport: activeChip, league, search }, timezone),
    [games, activeDate, activeChip, league, search, timezone],
  );

  const perDayCounts = useMemo(() => groupByDate(games, timezone), [games, timezone]);

  // Why the current view is empty, so the message can be specific.
  const emptyMessage = (() => {
    if (search.trim()) return `No games match “${search.trim()}”.`;
    if (activeChip !== ALL_SPORTS) return `No ${chipLabel(activeChip)} games scheduled for this day.`;
    if (league !== ALL_LEAGUES) return `No ${league} games scheduled for this day.`;
    return 'No games scheduled for this day.';
  })();

  return (
    <>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Schedule overview">
        <StatCard
          label="Games This Week"
          icon={CalendarDays}
          value={state === 'loaded' ? String(summary.games_this_week) : '--'}
          note="Today through next week"
        />
        <StatCard
          label="Sports Tracked"
          icon={Trophy}
          value={state === 'loaded' ? String(summary.sports_tracked) : '--'}
          note="Represented in this period"
        />
        <StatCard
          label="Today"
          icon={Clock3}
          value={state === 'loaded' ? String(summary.today) : '--'}
          note="Scheduled games"
        />
        <StatCard
          label="Tomorrow"
          icon={CalendarDays}
          value={state === 'loaded' ? String(summary.tomorrow) : '--'}
          note="Scheduled games"
        />
      </section>

      {/* Eight-day selector: today through today + 7 */}
      <section className="mt-6">
        <h2 className="sr-only">Date range</h2>
        <div className="horizontal-cards rounded-2xl border border-white/[.085] bg-white/[.02] p-1.5">
          {(dates.length > 0 ? dates : Array.from({ length: 8 }, (_, i) => `placeholder-${i}`)).map(
            (date, index) => {
              const real = dates.length > 0;
              const { weekday, label } = real
                ? formatDayTab(date)
                : { weekday: '--', label: '--' };
              const isActive = real && date === activeDate;
              const count = real ? (perDayCounts.get(date)?.length ?? 0) : 0;

              return (
                <button
                  key={date}
                  type="button"
                  disabled={!real}
                  onClick={() => setSelectedDate(date)}
                  aria-pressed={isActive}
                  className={`min-h-[54px] min-w-[92px] flex-1 rounded-xl px-4 text-center transition ${
                    isActive
                      ? 'border border-violet-400/35 bg-violet-500/15 text-white'
                      : 'text-white/42 hover:bg-white/[.035] hover:text-white'
                  }`}
                >
                  <span className="block text-xs font-semibold uppercase tracking-wide">
                    {index === 0 && real ? 'TODAY' : weekday}
                  </span>
                  <span
                    className={`mt-1 block text-[10px] ${isActive ? 'text-violet-300' : 'text-white/28'}`}
                  >
                    {label}
                    {real && count > 0 ? ` · ${count}` : ''}
                  </span>
                </button>
              );
            },
          )}
        </div>
      </section>

      {/* Filters */}
      <section className="mt-4 space-y-3" aria-label="Schedule filters">
        {unavailable && (
          <output className="block text-xs text-white/45">
            No {chipLabel(unavailable)} games this week &mdash; showing all sports.
          </output>
        )}
        <div className="horizontal-cards" aria-label="Sport filters">
          {chips.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={activeChip === tab.id}
              aria-label={chipLabel(tab.id)}
              onClick={() => {
                setSport(tab.id);
                // The chosen league may not exist in the new sport.
                setLeague(ALL_LEAGUES);
              }}
              className={`min-h-9 shrink-0 rounded-xl border px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                activeChip === tab.id
                  ? 'border-violet-500 bg-violet-600 text-white hover:bg-violet-500'
                  : 'border-white/9 bg-white/[.02] text-white/48 hover:bg-white/[.05] hover:text-white'
              }`}
            >
              {tab.emoji && (
                <span aria-hidden="true" className="mr-1.5">
                  {tab.emoji}
                </span>
              )}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="schedule-search" className="relative min-w-[220px] flex-1">
            <span className="sr-only">Search games, teams, or venues</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/28" />
            <input
              id="schedule-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search games, teams, venues..."
              className="h-10 w-full rounded-xl border border-white/9 bg-white/[.025] pl-9 pr-3 text-xs text-white/60 outline-none placeholder:text-white/25 focus:border-violet-400/40"
            />
          </label>

          <select
            aria-label="League"
            value={league}
            onChange={(event) => setLeague(event.target.value)}
            className="h-10 min-w-28 max-w-[220px] rounded-xl border border-white/9 bg-[#0f0d17] px-3 text-xs text-white/55 outline-none focus:border-violet-400/40"
          >
            {leagues.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Games */}
      <section className="mt-4" aria-labelledby="schedule-list-heading">
        <h2 id="schedule-list-heading" className="mb-3 text-sm font-semibold text-white/70">
          {activeDate ? formatDateHeading(activeDate) : 'Schedule'}
        </h2>

        {state === 'loading' ? (
          <Skeleton />
        ) : state === 'error' ? (
          <div className="panel flex min-h-[140px] flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-xs text-white/38">Schedule information is temporarily unavailable.</p>
            <button
              type="button"
              onClick={retry}
              className="min-h-9 rounded-xl border border-white/9 bg-white/[.025] px-3 text-xs text-white/55 transition hover:border-violet-400/30 hover:text-white"
            >
              Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <Notice>{emptyMessage}</Notice>
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-2xl border border-white/[.085] bg-white/[.018] md:block">
              <div
                className={`grid ${ROW_GRID} gap-4 border-b border-white/8 px-4 py-3 text-[10px] font-medium uppercase tracking-wider text-white/28`}
              >
                <span>Sport / League</span>
                <span>Time</span>
                <span>Matchup</span>
                <span>Venue</span>
                <span>Broadcast</span>
                <span>Status</span>
                <span className="sr-only">Watch</span>
              </div>
              {filtered.map((game) => (
                <DesktopRow key={game.id} game={game} timezone={timezone} />
              ))}
            </div>

            <div className="grid gap-3 md:hidden">
              {filtered.map((game) => (
                <MobileCard key={game.id} game={game} timezone={timezone} />
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}
