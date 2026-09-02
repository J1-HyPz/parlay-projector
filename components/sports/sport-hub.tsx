'use client';

/**
 * The competition hub.
 *
 * One component for every competition, driven by hub configuration and the
 * league catalogue. There is no per-league branch: what differs between the
 * NBA and the Premier League is the words, the columns and which leagues are
 * queried, and all three are data.
 *
 * Sections load independently. News failing leaves scores, standings, teams and
 * transactions working.
 */

import { useMemo, useState } from 'react';
import { CalendarDays, Radio, Trophy, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { HubConfig } from '@/lib/sports/hubs';
import { divisionFor, isFootballHub, leaguesForHub, singleLeagueFor } from '@/lib/sports/hubs';
import { previewSections, seasonLabel, splitGames } from '@/lib/sports/split';
import {
  useHubGames,
  useHubNews,
  useHubStandings,
  useHubTeams,
  useHubTransactions,
} from './hub-data';
import {
  CompetitionSelector,
  DivisionSelector,
  HubHeader,
  HubNavigation,
  type HubSection,
} from './hub-chrome';
import {
  EmptyState,
  ErrorState,
  GameList,
  NewsList,
  SectionHeader,
  SkeletonRows,
} from './hub-pieces';
import { MoreLink, StandingsGroups, TeamGrid, TransactionList } from './hub-tables';

const NEWS_LIMIT = 9;
const TRANSACTIONS_LIMIT = 25;
/** Rows per section on the overview, which links onward rather than listing everything. */
const PREVIEW = 4;

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <article className="panel flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[.14em] text-white/30">{label}</p>
        <p className="mt-1 truncate text-xl font-semibold">{value}</p>
      </div>
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-violet-400/20 bg-violet-500/[.08] text-violet-300">
        <Icon className="size-4" aria-hidden="true" />
      </span>
    </article>
  );
}

export function SportHub({ hub, initialDivision }: { hub: HubConfig; initialDivision: string }) {
  const [section, setSection] = useState<HubSection>('overview');
  const [divisionId, setDivisionId] = useState(initialDivision);

  const division = useMemo(() => divisionFor(hub, divisionId), [hub, divisionId]);

  // Which leagues the hub is currently showing. Standings, teams and
  // transactions are per-league by nature, so they use the single league a
  // division resolves to; games and news can span both NCAA divisions.
  const leagues = useMemo(() => leaguesForHub(hub, division), [hub, division]);
  const leagueIds = useMemo(() => leagues.map((league) => league.id), [leagues]);
  const single = useMemo(() => singleLeagueFor(hub, division), [hub, division]);

  const games = useHubGames(leagueIds);
  const standings = useHubStandings(single?.id ?? null);
  const teams = useHubTeams(single?.id ?? null);
  const news = useHubNews(leagueIds, NEWS_LIMIT);
  const transactions = useHubTransactions(leagueIds, TRANSACTIONS_LIMIT);

  const sections = useMemo(() => {
    if (!games.data) return null;
    return splitGames(games.data.games, games.data.today, games.data.timezone);
  }, [games.data]);

  const timezone = games.data?.timezone ?? 'Europe/London';
  const preview = sections ? previewSections(sections, PREVIEW) : null;

  const season = useMemo(
    () => (games.data ? seasonLabel(games.data.games, leagues[0]?.group === 'football') : null),
    [games.data, leagues],
  );

  const collegiate = leagues.some((league) => league.collegiate);
  const leagueGroup = leagues[0]?.group ?? 'other';
  const { terminology } = hub;

  /** Deep links back into the existing filtered pages, which are unchanged. */
  const scheduleHref = `/schedule?sport=${encodeURIComponent(hub.chip)}`;
  const liveHref = `/live?sport=${encodeURIComponent(hub.chip)}`;

  // --- section bodies -----------------------------------------------------

  function gamesSection(list: 'live' | 'today' | 'results' | 'upcoming', empty: string) {
    if (games.state === 'loading') return <SkeletonRows rows={2} />;
    if (games.state === 'error' || !sections) {
      return <ErrorState>Unable to load {terminology.games.toLowerCase()} right now.</ErrorState>;
    }
    const source = section === 'overview' && preview ? preview : sections;
    return <GameList games={source[list]} timezone={timezone} empty={empty} />;
  }

  function standingsBody(limit?: number) {
    if (!single) {
      return (
        <EmptyState>
          Choose Men&apos;s or Women&apos;s to see a {terminology.standings.toLowerCase()}.
        </EmptyState>
      );
    }
    if (!single.hasStandings) {
      return <EmptyState>No {terminology.standings.toLowerCase()} is published for this competition.</EmptyState>;
    }
    if (standings.state === 'loading') return <SkeletonRows rows={4} />;
    if (standings.state === 'error' || !standings.data) {
      return <ErrorState>Unable to load the {terminology.standings.toLowerCase()} right now.</ErrorState>;
    }
    return <StandingsGroups groups={standings.data} leagueGroup={leagueGroup} limit={limit} />;
  }

  function teamsBody(limit?: number) {
    if (!single) {
      return (
        <EmptyState>
          Choose Men&apos;s or Women&apos;s to see {terminology.teams.toLowerCase()}.
        </EmptyState>
      );
    }
    if (teams.state === 'loading') return <SkeletonRows rows={2} />;
    if (teams.state === 'error' || !teams.data) {
      return <ErrorState>Unable to load {terminology.teams.toLowerCase()} right now.</ErrorState>;
    }
    return <TeamGrid teams={teams.data} leagueId={single.id} limit={limit} />;
  }

  function newsBody(limit?: number) {
    if (news.state === 'loading') return <SkeletonRows rows={2} />;
    if (news.state === 'error' || !news.data) {
      return <ErrorState>Unable to load news right now.</ErrorState>;
    }
    return <NewsList articles={limit ? news.data.slice(0, limit) : news.data} />;
  }

  function transactionsBody(limit?: number) {
    if (transactions.state === 'loading') return <SkeletonRows rows={3} />;
    if (transactions.state === 'error' || !transactions.data) {
      return (
        <ErrorState>{terminology.transactions} data is currently unavailable.</ErrorState>
      );
    }
    return (
      <TransactionList
        transactions={
          limit ? transactions.data.transactions.slice(0, limit) : transactions.data.transactions
        }
        supported={transactions.data.supported}
        label={terminology.transactions}
      />
    );
  }

  return (
    <>
      <HubHeader
        hub={hub}
        season={season}
        collegiate={collegiate}
        liveCount={sections?.live.length ?? 0}
      />

      <HubNavigation hub={hub} active={section} onSelect={setSection} />

      {hub.divisions && (
        <div className="mt-3">
          <DivisionSelector
            divisions={hub.divisions}
            active={division?.id ?? hub.divisions[0].id}
            onSelect={setDivisionId}
          />
        </div>
      )}

      {/* Deep links into the existing filtered pages, which keep their own chips. */}
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={scheduleHref}
          className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-white/9 bg-white/[.02] px-3 text-xs text-white/60 transition hover:bg-white/[.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
        >
          <CalendarDays className="size-3.5" aria-hidden="true" />
          View full schedule
        </a>
        <a
          href={liveHref}
          className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-white/9 bg-white/[.02] px-3 text-xs text-white/60 transition hover:bg-white/[.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
        >
          <Radio className="size-3.5" aria-hidden="true" />
          View live games
        </a>
      </div>

      {section === 'overview' && (
        <>
          <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Summary">
            <SummaryCard
              label="Live now"
              value={sections ? String(sections.live.length) : '--'}
              icon={Radio}
            />
            <SummaryCard
              label="Today"
              value={sections ? String(sections.today.length + sections.live.length) : '--'}
              icon={CalendarDays}
            />
            <SummaryCard
              label={terminology.teams}
              value={teams.data ? String(teams.data.length) : '--'}
              icon={Users}
            />
            <SummaryCard label="Season" value={season ?? '--'} icon={Trophy} />
          </section>

          {isFootballHub(hub) && <CompetitionSelector activeSlug={hub.slug} />}

          <section className="mt-6" aria-labelledby="live-heading">
            <SectionHeader title="Live now" id="live-heading" />
            {gamesSection('live', 'No games are currently live.')}
          </section>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
            <div className="min-w-0 space-y-6">
              <section aria-labelledby="today-heading">
                <SectionHeader
                  title={`Today's ${terminology.games.toLowerCase()}`}
                  id="today-heading"
                  action={<MoreLink href={scheduleHref}>Full schedule</MoreLink>}
                />
                {gamesSection('today', `No ${terminology.games.toLowerCase()} scheduled today.`)}
              </section>

              <section aria-labelledby="upcoming-heading">
                <SectionHeader
                  title={`Upcoming ${terminology.games.toLowerCase()}`}
                  id="upcoming-heading"
                />
                {gamesSection('upcoming', `No upcoming ${terminology.games.toLowerCase()}.`)}
              </section>

              <section aria-labelledby="results-heading">
                <SectionHeader title="Recent results" id="results-heading" />
                {gamesSection('results', 'No recent results.')}
              </section>
            </div>

            <aside className="min-w-0">
              <SectionHeader
                title={terminology.standings}
                id="standings-preview-heading"
                action={
                  <button
                    type="button"
                    onClick={() => setSection('standings')}
                    className="text-xs text-violet-300 transition hover:text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
                  >
                    Full {terminology.standings.toLowerCase()}
                  </button>
                }
              />
              {standingsBody(6)}
            </aside>
          </div>

          <section className="mt-8" aria-labelledby="news-preview-heading">
            <SectionHeader title="Latest news" id="news-preview-heading" />
            {newsBody(6)}
          </section>

          <section className="mt-8" aria-labelledby="teams-preview-heading">
            <SectionHeader
              title={terminology.teams}
              id="teams-preview-heading"
              action={
                <button
                  type="button"
                  onClick={() => setSection('teams')}
                  className="text-xs text-violet-300 transition hover:text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
                >
                  All {terminology.teams.toLowerCase()}
                </button>
              }
            />
            {teamsBody(10)}
          </section>

          <section className="mt-8" aria-labelledby="transactions-preview-heading">
            <SectionHeader title={terminology.transactions} id="transactions-preview-heading" />
            {transactionsBody(6)}
          </section>
        </>
      )}

      {section === 'scores' && (
        <div className="mt-6 space-y-6">
          <section aria-labelledby="scores-live-heading">
            <SectionHeader title="Live now" id="scores-live-heading" />
            {gamesSection('live', 'No games are currently live.')}
          </section>
          <section aria-labelledby="scores-today-heading">
            <SectionHeader title="Today" id="scores-today-heading" />
            {gamesSection('today', `No ${terminology.games.toLowerCase()} scheduled today.`)}
          </section>
          <section aria-labelledby="scores-upcoming-heading">
            <SectionHeader title="Upcoming" id="scores-upcoming-heading" />
            {gamesSection('upcoming', `No upcoming ${terminology.games.toLowerCase()}.`)}
          </section>
          <section aria-labelledby="scores-results-heading">
            <SectionHeader title="Recent results" id="scores-results-heading" />
            {gamesSection('results', 'No recent results.')}
          </section>
        </div>
      )}

      {section === 'standings' && (
        <section className="mt-6" aria-labelledby="standings-heading">
          <SectionHeader title={terminology.standings} id="standings-heading" />
          {standingsBody()}
        </section>
      )}

      {section === 'news' && (
        <section className="mt-6" aria-labelledby="news-heading">
          <SectionHeader title="Latest news" id="news-heading" />
          {newsBody()}
        </section>
      )}

      {section === 'teams' && (
        <section className="mt-6" aria-labelledby="teams-heading">
          <SectionHeader title={terminology.teams} id="teams-heading" />
          {teamsBody()}
        </section>
      )}

      {section === 'transactions' && (
        <section className="mt-6" aria-labelledby="transactions-heading">
          <SectionHeader title={terminology.transactions} id="transactions-heading" />
          {transactionsBody()}
        </section>
      )}

      {isFootballHub(hub) && section !== 'overview' && (
        <CompetitionSelector activeSlug={hub.slug} />
      )}
    </>
  );
}
