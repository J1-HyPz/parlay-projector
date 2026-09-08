'use client';

/**
 * Schedule page content.
 *
 * Summary cards, an eight-day selector, sport chips, search and league
 * filters, then the fixtures themselves in one of three layouts.
 *
 * ## Three layouts, not two
 *
 * There used to be two: a seven-column table from `md` up, and a stacked card
 * list below it. The table's columns come to roughly 910px of fixed and
 * minimum widths, but `md` is 768px -- so between 768px and about 1000px the
 * table was rendered into a container too narrow to hold it, and because the
 * document suppresses horizontal scrolling it was *clipped* rather than
 * scrolled. Measured on an 805px viewport: the row needed 906px in a 747px
 * box, which put Broadcast half off-screen and Status and the watch control
 * entirely past the edge. Every tablet lost the status of every fixture.
 *
 * So the table now waits for `xl`, where it genuinely fits alongside the
 * sidebar, and the band it used to occupy gets a two-column card grid --
 * which suits that width better than a table ever did.
 *
 * Every row links to `/games/:id` with the provider event id, so schedule
 * games open the same detail page as Home. Plain anchors are used deliberately
 * -- see components/home/games-today.tsx.
 */

import { CalendarDays, CalendarX2, Clock3, Search, Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { sidesOf } from '@/lib/home/types';
import { EventBody, eventHref, eventLabel } from '@/components/sports/event-body';
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
import { Chip, ChipRow } from '@/components/ui/chip';
import { Crest } from '@/components/ui/crest';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { WatchButton } from '@/components/watchlist/watch-button';
import { SlipButton } from '@/components/slip/slip-button';
import { useSchedule } from './schedule-data';

function TeamLine({ team }: { team: NonNullable<Game['home_team']> }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Crest name={team.name} logo={team.logo} size="md" />
      <span className="truncate text-sm text-ink">{team.name}</span>
    </div>
  );
}

/**
 * Trimmed from the original by about 40px so it clears the sidebar at exactly
 * 1280px, which is the width this layout now starts at. The two flexible
 * columns absorb everything above that.
 */
const ROW_GRID =
  'grid-cols-[104px_112px_minmax(210px,1.3fr)_minmax(140px,1fr)_108px_96px_44px]';

/** The accessible name for a fixture link, shared by every layout. */
function linkLabel(game: Game): string {
  const sides = sidesOf(game);
  return sides
    ? `${sides.away.name} ${separatorFor(game.sport)} ${sides.home.name}, view game details`
    : `${eventLabel(game)}, view details`;
}

function DesktopRow({ game, timezone }: { game: Game; timezone: string }) {
  const sides = sidesOf(game);

  return (
    <div className="relative border-b border-line last:border-b-0">
      <a
        href={eventHref(game)}
        aria-label={linkLabel(game)}
        className={`focus-ring-inset grid min-h-[78px] ${ROW_GRID} items-center gap-4 px-4 py-3 transition hover:bg-violet-500/[.06]`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-full border border-line bg-surface-2 text-2xs text-violet-300"
          >
            {badgeLabel(game.league, game.sport)}
          </span>
          <span className="truncate text-xs text-ink-subtle">
            {game.league ?? sportLabel(game.sport)}
          </span>
        </div>

        <div className="text-xs leading-5 text-ink-subtle">
          <span className="block tabular-nums">{formatKickoff(game.start_time, timezone)}</span>
          {game.round && <span className="text-ink-faint">Round {game.round}</span>}
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

        <div className="min-w-0 text-xs leading-5 text-ink-faint">
          <span className="block truncate">{game.venue.name ?? 'Venue TBC'}</span>
          {game.venue.city && <span className="block truncate">{game.venue.city}</span>}
        </div>

        <span className="truncate text-xs text-ink-faint">{game.broadcast ?? '--'}</span>

        <StatusBadge status={game.status} />

        {/* Reserves the trailing column; the buttons are siblings of the link,
            because a button nested inside an anchor is invalid and would fight
            the navigation. */}
        <span aria-hidden="true" />
      </a>
      <WatchButton game={game} className="absolute right-3 top-1/2 -translate-y-1/2" />
      <SlipButton game={game} className="absolute right-[56px] top-1/2 -translate-y-1/2" />
    </div>
  );
}

/**
 * The card, used on phones and through the whole tablet band.
 *
 * Same information as a table row, ordered by what a reader looks for first:
 * who is playing, then when, then where.
 */
function GameCard({ game, timezone }: { game: Game; timezone: string }) {
  const sides = sidesOf(game);

  return (
    <div className="relative min-w-0">
      <a
        href={eventHref(game)}
        aria-label={linkLabel(game)}
        className="panel-interactive focus-ring block h-full min-w-0 p-4"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line pb-3 pr-[92px]">
          <span className="min-w-0 truncate text-2xs font-medium text-violet-300">
            {game.league ?? sportLabel(game.sport)}
            {game.round ? ` • Round ${game.round}` : ''}
          </span>
          <span className="shrink-0 text-2xs tabular-nums text-ink-subtle">
            {formatKickoff(game.start_time, timezone)}
          </span>
        </div>

        <div className="my-4 space-y-3">
          {sides ? (
            <>
              <TeamLine team={sides.away} />
              <div
                aria-hidden="true"
                className="pl-[42px] text-2xs uppercase tracking-wider text-ink-faint"
              >
                {separatorFor(game.sport)}
              </div>
              <TeamLine team={sides.home} />
            </>
          ) : (
            <EventBody game={game} />
          )}
        </div>

        <div className="flex items-end justify-between gap-3 text-2xs">
          <span className="min-w-0 leading-5 text-ink-faint">
            <span className="block truncate">{game.venue.name ?? 'Venue TBC'}</span>
            {game.venue.city && <span className="block truncate">{game.venue.city}</span>}
          </span>
          <StatusBadge status={game.status} />
        </div>
      </a>
      <WatchButton game={game} className="absolute right-3 top-3" />
      <SlipButton game={game} className="absolute right-[56px] top-3" />
    </div>
  );
}

/**
 * The skeleton matches the layout that will replace it at every width, so the
 * page does not rearrange itself the moment data lands.
 */
function Skeleton() {
  return (
    <div className="motion-safe:animate-pulse" aria-busy="true" aria-label="Loading schedule">
      <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface-1 xl:block">
        {[0, 1, 2, 3].map((row) => (
          <div
            key={row}
            className={`grid min-h-[78px] ${ROW_GRID} items-center gap-4 border-b border-line px-4 py-3 last:border-b-0`}
          >
            <div className="h-3 w-16 rounded-full bg-surface-3" />
            <div className="h-3 w-14 rounded-full bg-surface-2" />
            <div className="space-y-2">
              <div className="h-3 w-40 rounded-full bg-surface-3" />
              <div className="h-3 w-32 rounded-full bg-surface-2" />
            </div>
            <div className="h-3 w-28 rounded-full bg-surface-2" />
            <div className="h-3 w-16 rounded-full bg-surface-2" />
            <div className="h-5 w-20 rounded-full bg-surface-2" />
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:hidden">
        {[0, 1, 2, 4].map((card) => (
          <div key={card} className="panel space-y-4 p-4">
            <div className="h-3 w-24 rounded-full bg-surface-3" />
            <div className="h-3 w-40 rounded-full bg-surface-2" />
            <div className="h-3 w-36 rounded-full bg-surface-2" />
            <div className="h-3 w-28 rounded-full bg-surface-2" />
          </div>
        ))}
      </div>
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
    () =>
      availableLeagues(
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

  const narrowed = activeChip !== ALL_SPORTS || league !== ALL_LEAGUES || search.trim() !== '';

  return (
    <>
      <StatGrid label="Schedule overview">
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
      </StatGrid>

      {/* Eight-day selector: today through today + 7 */}
      <section className="mt-6">
        <h2 className="sr-only">Date range</h2>
        <div className="horizontal-cards rounded-2xl border border-line bg-surface-1 p-1.5">
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
                  className={`focus-ring min-h-[54px] min-w-fit flex-1 rounded-xl px-3 text-center transition sm:px-4 ${
                    isActive
                      ? 'border border-violet-400/35 bg-violet-500/15 text-ink-strong'
                      : 'text-ink-subtle hover:bg-surface-2 hover:text-ink-strong'
                  }`}
                >
                  <span className="block whitespace-nowrap text-xs font-semibold uppercase tracking-wide">
                    {index === 0 && real ? 'TODAY' : weekday}
                  </span>
                  <span
                    className={`mt-1 block whitespace-nowrap text-2xs tabular-nums ${
                      isActive ? 'text-violet-300' : 'text-ink-faint'
                    }`}
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
          <output className="block text-xs text-ink-subtle">
            No {chipLabel(unavailable)} games this week &mdash; showing all sports.
          </output>
        )}

        <ChipRow label="Sport filters">
          {chips.map((tab) => (
            <Chip
              key={tab.id}
              active={activeChip === tab.id}
              ariaLabel={chipLabel(tab.id)}
              emoji={tab.emoji ?? undefined}
              onClick={() => {
                setSport(tab.id);
                // The chosen league may not exist in the new sport.
                setLeague(ALL_LEAGUES);
              }}
            >
              {tab.label}
            </Chip>
          ))}
        </ChipRow>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="schedule-search" className="relative min-w-[200px] flex-1">
            <span className="sr-only">Search games, teams, or venues</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
            />
            <input
              id="schedule-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search games, teams, venues..."
              className="field w-full pl-9 pr-3"
            />
          </label>

          <select
            aria-label="League"
            value={league}
            onChange={(event) => setLeague(event.target.value)}
            className="field-select min-w-28 max-w-[220px] flex-1 sm:flex-none"
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
      <section className="mt-5" aria-labelledby="schedule-list-heading">
        <h2 id="schedule-list-heading" className="mb-3 text-sm font-semibold text-ink">
          {activeDate ? formatDateHeading(activeDate) : 'Schedule'}
        </h2>

        {state === 'loading' ? (
          <Skeleton />
        ) : state === 'error' ? (
          <ErrorState title="Schedule information is temporarily unavailable." onRetry={retry} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={CalendarX2}
            title={emptyMessage}
            hint={
              narrowed && games.length > 0
                ? 'Another day, or a wider filter, may have more.'
                : undefined
            }
            action={
              narrowed ? (
                <button
                  type="button"
                  onClick={() => {
                    setSport(ALL_SPORTS);
                    setLeague(ALL_LEAGUES);
                    setSearch('');
                  }}
                  className="focus-ring rounded-lg px-1 py-1 text-xs text-violet-300 transition hover:text-violet-200"
                >
                  Clear filters
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* The table, only where its columns fit. */}
            <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface-1 xl:block">
              <div
                className={`grid ${ROW_GRID} gap-4 border-b border-line px-4 py-3 text-2xs font-medium uppercase tracking-wider text-ink-faint`}
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

            {/* One column on a phone, two through the tablet band. */}
            <div className="grid gap-3 sm:grid-cols-2 xl:hidden">
              {filtered.map((game) => (
                <GameCard key={game.id} game={game} timezone={timezone} />
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}
