'use client';

/**
 * Game detail sections.
 *
 * Every section omits rows the provider did not supply rather than rendering
 * `undefined`, `null`, `NaN` or a misleading `0`. Sections with no data at all
 * show a short empty state instead of an empty grid.
 */

import { Info, LineChart, Swords, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import type { GameDetail, FormResult, RecentGame, TeamStanding } from '@/lib/games/types';
import { formatDate, formatRecord, formatTime, ordinal, scoreNoun } from './game-data';

// ---------------------------------------------------------------------------
// Shared shells
// ---------------------------------------------------------------------------

export function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Info;
  children: ReactNode;
}) {
  return (
    <section className="panel p-5" aria-label={title}>
      <div className="mb-4 flex items-center gap-2">
        <Icon className="size-4 text-violet-300" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: string }) {
  return <p className="text-xs leading-5 text-white/36">{children}</p>;
}

/** A label/value row. Renders nothing at all when the value is absent. */
function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/[.055] py-2.5 last:border-b-0">
      <span className="shrink-0 text-xs text-white/38">{label}</span>
      <span className="text-right text-xs font-medium text-white/68">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Game Information
// ---------------------------------------------------------------------------

export function GameInformation({ game }: { game: GameDetail }) {
  const rows: { label: string; value: string | null }[] = [
    { label: 'Date', value: formatDate(game.start_time) },
    { label: 'Time', value: formatTime(game.start_time) },
    { label: 'Venue', value: game.venue.name },
    { label: 'Location', value: game.venue.city },
    { label: 'League', value: game.league },
    { label: 'Season', value: game.season },
    { label: 'Round', value: game.round },
    { label: 'Broadcast', value: game.broadcast },
  ];
  const present = rows.filter((row) => row.value);

  return (
    <Section title="Game Information" icon={Info}>
      {present.length > 0 ? (
        <div>
          {present.map((row) => (
            <Row key={row.label} label={row.label} value={row.value} />
          ))}
        </div>
      ) : (
        <EmptyState>No further details available for this game.</EmptyState>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Matchup Overview
// ---------------------------------------------------------------------------

function standingSummary(
  standing: TeamStanding | null,
  sport: GameDetail['sport'],
): { record: string | null; position: string | null } {
  if (!standing) return { record: null, position: null };
  return {
    record: formatRecord(standing.wins, standing.draws, standing.losses, sport),
    position: standing.rank !== null ? `${ordinal(standing.rank)}${standing.group ? ` · ${standing.group}` : ''}` : null,
  };
}

export function MatchupOverview({ game }: { game: GameDetail }) {
  const sides = [
    { team: game.away_team, standing: game.standings.away, label: 'Away' },
    { team: game.home_team, standing: game.standings.home, label: 'Home' },
  ];
  const anyData = sides.some((side) => side.standing !== null);

  return (
    <Section title="Matchup Overview" icon={Swords}>
      {anyData ? (
        <div className="space-y-4">
          {sides.map(({ team, standing, label }) => {
            const summary = standingSummary(standing, game.sport);
            return (
              <div key={label} className="rounded-xl border border-white/7 bg-white/[.018] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-xs font-medium text-white/68">{team.name}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-white/28">
                    {label}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-white/42">
                  {summary.record && <span>Record {summary.record}</span>}
                  {summary.position && <span>{summary.position}</span>}
                  {!summary.record && !summary.position && (
                    <span className="text-white/28">No standings data</span>
                  )}
                </div>
                {standing && standing.form.length > 0 && (
                  <div className="mt-3">
                    <FormRun form={standing.form} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState>
          Standings are not published for this competition yet.
        </EmptyState>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Recent Form
// ---------------------------------------------------------------------------

const FORM_TONE: Record<FormResult, string> = {
  W: 'border-emerald-400/25 bg-emerald-500/12 text-emerald-300',
  D: 'border-white/12 bg-white/[.05] text-white/55',
  L: 'border-rose-400/25 bg-rose-500/12 text-rose-300',
};

export function FormRun({ form }: { form: FormResult[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label={`Recent form: ${form.join(', ')}`}>
      {form.map((result, index) => (
        <span
          key={`${result}-${index}`}
          className={`grid size-6 place-items-center rounded-md border text-[10px] font-semibold ${FORM_TONE[result]}`}
        >
          {result}
        </span>
      ))}
    </div>
  );
}

export function RecentForm({ game }: { game: GameDetail }) {
  const sides = [
    { team: game.away_team, form: game.standings.away?.form ?? [] },
    { team: game.home_team, form: game.standings.home?.form ?? [] },
  ];
  const anyForm = sides.some((side) => side.form.length > 0);

  return (
    <Section title="Recent Form" icon={TrendingUp}>
      {anyForm ? (
        <div className="space-y-4">
          {sides.map(({ team, form }) => (
            <div key={team.name}>
              <p className="mb-2 truncate text-xs text-white/50">{team.name}</p>
              {form.length > 0 ? (
                <FormRun form={form} />
              ) : (
                <p className="text-[11px] text-white/28">No form data</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState>Recent form is not available for these teams.</EmptyState>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Team Comparison
// ---------------------------------------------------------------------------

/**
 * Comparison rows.
 *
 * The provider publishes one shared league-table stat set for every sport, so
 * only the wording is sport-aware. Sport-specific statistics (passing yards,
 * ERA, field-goal percentage) are not available and are therefore absent
 * rather than invented.
 */
export function TeamComparison({ game }: { game: GameDetail }) {
  const away = game.standings.away;
  const home = game.standings.home;
  const nouns = scoreNoun(game.sport);

  if (!away && !home) {
    return (
      <Section title="Team Comparison" icon={LineChart}>
        <EmptyState>
          Season statistics are not published for this competition yet.
        </EmptyState>
      </Section>
    );
  }

  const value = (standing: TeamStanding | null, pick: (s: TeamStanding) => number | null) => {
    if (!standing) return null;
    const result = pick(standing);
    return result === null ? null : String(result);
  };

  const rows: { label: string; away: string | null; home: string | null }[] = [
    {
      label: 'Record',
      away: away ? formatRecord(away.wins, away.draws, away.losses, game.sport) : null,
      home: home ? formatRecord(home.wins, home.draws, home.losses, game.sport) : null,
    },
    {
      label: 'Position',
      away: away?.rank != null ? ordinal(away.rank) : null,
      home: home?.rank != null ? ordinal(home.rank) : null,
    },
    { label: 'Played', away: value(away, (s) => s.played), home: value(home, (s) => s.played) },
    { label: nouns.for, away: value(away, (s) => s.goals_for), home: value(home, (s) => s.goals_for) },
    {
      label: nouns.against,
      away: value(away, (s) => s.goals_against),
      home: value(home, (s) => s.goals_against),
    },
    {
      label: 'Difference',
      away: value(away, (s) => s.goal_difference),
      home: value(home, (s) => s.goal_difference),
    },
    { label: 'Points', away: value(away, (s) => s.points), home: value(home, (s) => s.points) },
  ].filter((row) => row.away !== null || row.home !== null);

  return (
    <Section title="Team Comparison" icon={LineChart}>
      {/* Header: away | stat | home. Stacks safely because it is a 3-column
          grid rather than a table, so it never scrolls horizontally. */}
      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 border-b border-white/7 pb-3 text-[10px] uppercase tracking-wider text-white/28">
        <span className="truncate text-left">{game.away_team.abbreviation ?? game.away_team.name}</span>
        <span className="text-center">Stat</span>
        <span className="truncate text-right">{game.home_team.abbreviation ?? game.home_team.name}</span>
      </div>

      <div className="divide-y divide-white/[.055]">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2.5">
            <span className="text-left text-xs font-medium tabular-nums text-white/68">
              {row.away ?? '--'}
            </span>
            <span className="text-center text-[11px] text-white/38">{row.label}</span>
            <span className="text-right text-xs font-medium tabular-nums text-white/68">
              {row.home ?? '--'}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Recent Games
// ---------------------------------------------------------------------------

function RecentGameRow({ game }: { game: RecentGame }) {
  const tone =
    game.result === 'W'
      ? 'text-emerald-300'
      : game.result === 'L'
        ? 'text-rose-300'
        : 'text-white/55';

  const score =
    game.team_score !== null && game.opponent_score !== null
      ? `${game.team_score}-${game.opponent_score}`
      : null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/[.055] py-2 last:border-b-0">
      <span className="min-w-0 truncate text-xs text-white/55">
        <span className="text-white/30">{game.home ? 'vs' : '@'}</span> {game.opponent}
      </span>
      <span className={`shrink-0 text-xs font-medium tabular-nums ${tone}`}>
        {game.result ?? ''} {score ?? '--'}
      </span>
    </div>
  );
}

export function RecentGames({ game }: { game: GameDetail }) {
  const sides = [
    { team: game.away_team, games: game.recent_games.away },
    { team: game.home_team, games: game.recent_games.home },
  ];
  const anyGames = sides.some((side) => side.games.length > 0);

  return (
    <Section title="Recent Games" icon={TrendingUp}>
      {anyGames ? (
        <div className="grid gap-5 md:grid-cols-2">
          {sides.map(({ team, games }) => (
            <div key={team.name} className="min-w-0">
              <p className="mb-2 truncate text-xs font-medium text-white/50">{team.name}</p>
              {games.length > 0 ? (
                <div>
                  {games.map((recent) => (
                    <RecentGameRow key={recent.id} game={recent} />
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-white/28">No recent results</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState>No recent results available for these teams.</EmptyState>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Head to Head
// ---------------------------------------------------------------------------

export function HeadToHead({ game }: { game: GameDetail }) {
  return (
    <Section title="Head to Head" icon={Swords}>
      {game.head_to_head.length > 0 ? (
        <div>
          {game.head_to_head.map((meeting) => (
            <RecentGameRow key={meeting.id} game={meeting} />
          ))}
        </div>
      ) : (
        <EmptyState>
          Previous meetings are not available from the current sports data provider.
        </EmptyState>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
