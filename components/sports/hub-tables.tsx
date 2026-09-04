'use client';

/**
 * Standings, teams and transactions.
 *
 * The standings table is one component for every competition: groups come from
 * the provider (two NBA conferences, eleven NCAA Football conferences, one flat
 * football table) and columns are chosen from the data present, so nothing is
 * hardcoded per league and no empty column is rendered.
 */

import { ArrowRight, Users } from 'lucide-react';
import type { StandingsGroup, StandingsRow, TeamProfile } from '@/lib/leagues/types';
import { competitorLabel, hasRank, standingsColumns } from '@/lib/sports/standings-columns';
import {
  TRANSACTION_TYPE_LABEL,
  type Transaction,
} from '@/lib/leagues/transactions-normalise';
import { EmptyState } from './hub-pieces';

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

function TeamCell({ row }: { row: StandingsRow }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {row.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.logo} alt="" aria-hidden="true" className="size-5 shrink-0 object-contain" />
      ) : (
        <span aria-hidden="true" className="size-5 shrink-0 rounded-full bg-white/[.06]" />
      )}
      <span className="truncate">{row.team_name}</span>
    </div>
  );
}

/** One conference, division, or a whole league that has neither. */
export function StandingsTable({
  group,
  leagueGroup,
  limit,
}: {
  group: StandingsGroup;
  /** Catalogue group, which decides the column shape. */
  leagueGroup: string;
  /** Trim for the overview preview; omit for the full section. */
  limit?: number;
}) {
  const rows = limit ? group.rows.slice(0, limit) : group.rows;
  const columns = standingsColumns(group.rows, leagueGroup);
  const showRank = hasRank(group.rows);

  return (
    <div className="panel overflow-hidden">
      <h3 className="border-b border-white/8 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-violet-300">
        {group.name}
      </h3>

      {/* Wide tables scroll inside their own container rather than the page. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          {/* "Driver Standings" is already a full name; appending the word
              again reads as "Driver Standings standings". */}
          <caption className="sr-only">
            {/standings/i.test(group.name) ? group.name : `${group.name} standings`}
          </caption>
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-white/28">
              {showRank && (
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  <abbr title="Position">Pos</abbr>
                </th>
              )}
              <th scope="col" className="px-3 py-2 text-left font-medium">
                {competitorLabel(leagueGroup, group.name)}
              </th>
              {columns.map((column) => (
                <th key={column.key} scope="col" className="px-2 py-2 text-right font-medium">
                  <abbr title={column.title}>{column.label}</abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.team_id} className="border-t border-white/[.055]">
                {showRank && (
                  <td className="px-3 py-2 text-right tabular-nums text-white/32">
                    {row.rank ?? index + 1}
                  </td>
                )}
                <th scope="row" className="max-w-[220px] px-3 py-2 text-left font-normal text-white/70">
                  <TeamCell row={row} />
                </th>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className="px-2 py-2 text-right tabular-nums text-white/50"
                  >
                    {column.value(row) ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function StandingsGroups({
  groups,
  leagueGroup,
  limit,
}: {
  groups: readonly StandingsGroup[];
  leagueGroup: string;
  limit?: number;
}) {
  if (groups.length === 0) {
    return <EmptyState>No table is published for this competition yet.</EmptyState>;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {groups.map((group) => (
        <StandingsTable
          key={group.id}
          group={group}
          leagueGroup={leagueGroup}
          limit={limit}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

/**
 * Team grid.
 *
 * Each card links to the roster route the backend already exposes. Full team
 * pages are not part of this pass, so the link points at the API rather than
 * inventing a /teams route that does not exist yet.
 */
export function TeamGrid({
  teams,
  leagueId,
  limit,
}: {
  teams: readonly TeamProfile[];
  leagueId: string;
  limit?: number;
}) {
  if (teams.length === 0) return <EmptyState>No teams listed for this competition.</EmptyState>;

  const shown = limit ? teams.slice(0, limit) : teams;

  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {shown.map((team) => (
        <li key={team.id}>
          <a
            href={`/api/leagues/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(team.id)}/roster`}
            className="panel flex h-full items-center gap-2.5 p-3 transition hover:border-violet-400/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
          >
            {team.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={team.logo}
                alt={`${team.name} badge`}
                className="size-8 shrink-0 object-contain"
              />
            ) : (
              <span
                aria-hidden="true"
                className="size-8 shrink-0 rounded-full"
                style={{ background: team.colour ? `#${team.colour}` : 'rgba(255,255,255,.06)' }}
              />
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm text-white/72">
                {team.short_name ?? team.name}
              </span>
              <span className="block truncate text-[11px] text-white/30">
                {team.abbreviation ?? team.location ?? ''}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

function transactionDate(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(instant);
}

export function TransactionList({
  transactions,
  supported,
  label,
}: {
  transactions: readonly Transaction[];
  supported: boolean;
  /** "Transactions", "Transfers" or "Roster Moves". */
  label: string;
}) {
  // A competition the provider does not cover at all reads very differently
  // from a quiet week, and saying so avoids a section that looks broken.
  if (!supported) {
    return (
      <EmptyState>
        {label} are not published for this competition by the current data provider.
      </EmptyState>
    );
  }

  if (transactions.length === 0) {
    return <EmptyState>No {label.toLowerCase()} in the last 45 days.</EmptyState>;
  }

  return (
    <ul className="space-y-2">
      {transactions.map((transaction) => (
        <li
          key={transaction.id}
          className="panel flex items-start gap-3 p-3 text-sm"
        >
          {transaction.team?.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={transaction.team.logo}
              alt=""
              aria-hidden="true"
              className="mt-0.5 size-7 shrink-0 object-contain"
            />
          ) : (
            <Users aria-hidden="true" className="mt-1 size-5 shrink-0 text-white/20" />
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
              <span className="rounded-md border border-violet-400/20 bg-violet-500/[.08] px-1.5 py-0.5 text-violet-300">
                {TRANSACTION_TYPE_LABEL[transaction.type]}
              </span>
              {transaction.team && (
                <span className="truncate text-white/45">{transaction.team.name}</span>
              )}
              <span className="ml-auto shrink-0 text-white/28">
                {transactionDate(transaction.date)}
              </span>
            </div>
            {/* The provider's own wording, shown in full and never rewritten. */}
            <p className="mt-1.5 text-[13px] leading-5 text-white/60">
              {transaction.description}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MoreLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex shrink-0 items-center gap-1 text-xs text-violet-300 transition hover:text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
    >
      {children}
      <ArrowRight className="size-3.5" />
    </a>
  );
}
