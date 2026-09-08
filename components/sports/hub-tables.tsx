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
import { InlineEmpty } from '@/components/ui/states';
import { Crest } from '@/components/ui/crest';

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

function TeamCell({ row }: { row: StandingsRow }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Crest name={row.team_name} logo={row.logo} size="xs" bare />
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
      <h3 className="border-b border-line px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-violet-300">
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
            <tr className="text-2xs uppercase tracking-wider text-ink-faint">
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
              <tr key={row.team_id} className="border-t border-line">
                {showRank && (
                  <td className="px-3 py-2 text-right tabular-nums text-ink-faint">
                    {row.rank ?? index + 1}
                  </td>
                )}
                <th scope="row" className="max-w-[220px] px-3 py-2 text-left font-normal text-ink">
                  <TeamCell row={row} />
                </th>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className="px-2 py-2 text-right tabular-nums text-ink-muted"
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
    return <InlineEmpty>No table is published for this competition yet.</InlineEmpty>;
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
  if (teams.length === 0) return <InlineEmpty>No teams listed for this competition.</InlineEmpty>;

  const shown = limit ? teams.slice(0, limit) : teams;

  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {shown.map((team) => (
        <li key={team.id}>
          <a
            href={`/api/leagues/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(team.id)}/roster`}
            className="panel flex h-full items-center gap-2.5 p-3 transition hover:border-violet-400/35 focus-ring"
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
              <span className="block truncate text-sm text-ink">
                {team.short_name ?? team.name}
              </span>
              <span className="block truncate text-2xs text-ink-faint">
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
      <InlineEmpty>
        {label} are not published for this competition by the current data provider.
      </InlineEmpty>
    );
  }

  if (transactions.length === 0) {
    return <InlineEmpty>No {label.toLowerCase()} in the last 45 days.</InlineEmpty>;
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
            <Users aria-hidden="true" className="mt-1 size-5 shrink-0 text-ink-faint" />
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs">
              <span className="rounded-md border border-violet-400/20 bg-violet-500/[.08] px-1.5 py-0.5 text-violet-300">
                {TRANSACTION_TYPE_LABEL[transaction.type]}
              </span>
              {transaction.team && (
                <span className="truncate text-ink-subtle">{transaction.team.name}</span>
              )}
              <span className="ml-auto shrink-0 text-ink-faint">
                {transactionDate(transaction.date)}
              </span>
            </div>
            {/* The provider's own wording, shown in full and never rewritten. */}
            <p className="mt-1.5 text-sm leading-5 text-ink-muted">
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
      className="inline-flex shrink-0 items-center gap-1 text-xs text-violet-300 transition hover:text-violet-200 focus-ring"
    >
      {children}
      <ArrowRight className="size-3.5" />
    </a>
  );
}
