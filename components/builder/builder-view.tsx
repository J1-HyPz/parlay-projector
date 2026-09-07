'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { useBuilder } from './builder-context';
import { LinePanel } from './line-panel';
import { AnalysisPanel } from './analysis-panel';
import { SuggestPanel } from './suggest-panel';
import { fixtureLabel } from '@/lib/home/types';
import type { Game } from '@/lib/home/types';
import type {
  BetSelection,
  LegEvidence,
  MarketResponse,
} from '@/lib/builder/types';
import {
  addSelection,
  calculateLine,
  quoteUsable,
  revalidateLeg,
} from '@/lib/builder/line';
import { restoreLine } from '@/lib/builder/drafts';
import type { SavedDraft } from '@/lib/builder/drafts';
import type { RiskLevel } from '@/lib/projections/types';

import { action, control, displayTime } from './ui';
async function getMarkets(
  id: string,
  signal?: AbortSignal,
): Promise<MarketResponse> {
  const response = await fetch(
    `/api/builder/markets/${encodeURIComponent(id)}`,
    { cache: 'no-store', signal },
  );
  if (!response.ok) throw new Error('Could not load markets. Please retry.');
  return response.json();
}

export function BuilderView({ initialGame }: { initialGame: string }) {
  const { line, setLine, ready, storageError } = useBuilder();
  const [games, setGames] = useState<Game[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState(initialGame);
  const [search, setSearch] = useState('');
  const [sport, setSport] = useState('all');
  const [marketSearch, setMarketSearch] = useState('');
  const [markets, setMarkets] = useState<MarketResponse | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketRevision, setMarketRevision] = useState(0);
  const [replaceId, setReplaceId] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [drafts, setDrafts] = useState<SavedDraft[]>([]);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [evidence, setEvidence] = useState<LegEvidence[]>([]);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /*
   * Two ways to use the same match list.
   *
   * `browse` opens one match's real markets, which is how a leg is made.
   * `suggest` ticks several and asks the projection engine what it would back
   * across them. One list, because a second copy of it would drift.
   */
  const [mode, setMode] = useState<'browse' | 'suggest'>('browse');
  const [picked, setPicked] = useState<string[]>([]);
  const [risk, setRisk] = useState<RiskLevel>('medium');
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const loadGames = useCallback(async (signal?: AbortSignal) => {
    setGamesLoading(true);
    setGamesError(null);
    try {
      const res = await fetch('/api/schedule', { signal });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { error?: string; games?: Game[] };
      if (signal?.aborted) return;
      if (data.error || !Array.isArray(data.games)) throw new Error();
      setGames(
        data.games.filter(
          (g: Game) => g.status === 'scheduled' || g.status === 'live',
        ),
      );
    } catch {
      if (!signal?.aborted)
        setGamesError(
          'The match schedule is unavailable. Existing legs and saved drafts are retained.',
        );
    } finally {
      if (!signal?.aborted) setGamesLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // oxlint-disable-next-line react/react-compiler -- initialize loading state while synchronizing with the schedule API
    void loadGames(controller.signal);
    return () => controller.abort();
  }, [loadGames]);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/builder/drafts', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = (await res.json()) as {
          message?: string;
          drafts: SavedDraft[];
        };
        if (!res.ok) throw new Error(data.message ?? 'Could not read drafts.');
        setDrafts(data.drafts);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setDraftError(error.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- clear the previous event before fetching another event
    setMarkets(null);
    setMarketError(null);
    if (!selectedGame) return;
    const controller = new AbortController();
    setMarketLoading(true);
    getMarkets(selectedGame, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setMarkets(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMarketError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setMarketLoading(false);
      });
    return () => controller.abort();
  }, [selectedGame, marketRevision]);

  // All restored/added legs are fetched again, and never trusted from local storage.
  const legIds = line.legs
    .map((l) => `${l.selection.event.id}|${l.selection.id}`)
    .join('\n');
  useEffect(() => {
    if (!ready || !legIds) return;
    const controller = new AbortController();
    const ids = [...new Set(legIds.split('\n').map((s) => s.split('|')[0]))];
    // oxlint-disable-next-line react/react-compiler -- the provider request is the external system this effect synchronizes
    setRefreshing(true);
    const run = async () => {
      const responses = new Map<string, MarketResponse>();
      for (let i = 0; i < ids.length; i += 3) {
        await Promise.all(
          ids.slice(i, i + 3).map(async (id) => {
            try {
              responses.set(id, await getMarkets(id, controller.signal));
            } catch {
              responses.set(id, {
                event: null,
                provider: '',
                selections: [],
                stale: true,
                fetchedAt: new Date().toISOString(),
                message: 'Price refresh failed. Retry to revalidate this leg.',
              });
            }
          }),
        );
        if (controller.signal.aborted) return;
      }
      setLine((current) => ({
        ...current,
        legs: current.legs.map((leg) =>
          responses.has(leg.selection.event.id)
            ? revalidateLeg(leg, responses.get(leg.selection.event.id)!)
            : leg,
        ),
      }));
      setNow(Date.now());
      setRefreshing(false);
    };
    void run();
    return () => controller.abort();
  }, [ready, legIds, refreshRevision, setLine]);

  const refresh = () => {
    setRefreshRevision((r) => r + 1);
    setMarketRevision((r) => r + 1);
  };
  const choose = (selection: BetSelection) => {
    const result = addSelection(line, selection, replaceId);
    if (result.error) {
      setNotice(result.error);
      return;
    }
    setLine(result.line);
    setReplaceId(undefined);
    setPanelOpen(true);
    setNotice('Selection added. Checking the provider price.');
  };
  const review = (id: string) => {
    const leg = line.legs.find((l) => l.selection.id === id);
    if (!leg) return;
    setSelectedGame(leg.selection.event.id);
    setReplaceId(id);
    setMarketSearch('');
    setPanelOpen(false);
    document
      .getElementById('market-browser')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const save = async () => {
    setSaving(true);
    setDraftError(null);
    try {
      const res = await fetch('/api/builder/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(line),
      });
      const data = (await res.json()) as {
        message?: string;
        drafts: SavedDraft[];
      };
      if (!res.ok)
        throw new Error(
          data.message ?? 'Enter a name and add at least one selection.',
        );
      setDrafts(data.drafts);
      setNotice('Named draft saved to the server data volume.');
    } catch (error) {
      setDraftError(
        error instanceof Error ? error.message : 'Draft save failed.',
      );
    } finally {
      setSaving(false);
    }
  };
  const analyse = async () => {
    setAnalysisOpen(true);
    setAnalysing(true);
    setAnalysisError(null);
    try {
      const res = await fetch('/api/builder/analyse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          gameIds: [...new Set(line.legs.map((l) => l.selection.event.id))],
        }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { evidence: LegEvidence[] };
      setEvidence(data.evidence);
    } catch {
      setAnalysisError(
        'Team information could not be retrieved. Price arithmetic and line checks remain available.',
      );
    } finally {
      setAnalysing(false);
    }
  };
  const books = useMemo(
    () => [
      ...new Map(
        [
          ...(markets?.selections ?? []),
          ...line.legs.map((l) => l.selection),
        ].map((s) => [s.bookmaker.id, s.bookmaker]),
      ).values(),
    ],
    [markets, line.legs],
  );
  const filteredGames = games.filter(
    (g) =>
      (sport === 'all' || g.sport === sport) &&
      `${fixtureLabel(g)} ${g.league ?? ''}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const filteredSelections = (markets?.selections ?? []).filter(
    (s) =>
      (!line.bookmakerId || s.bookmaker.id === line.bookmakerId) &&
      `${s.marketName} ${s.outcome} ${s.line ?? ''}`
        .toLowerCase()
        .includes(marketSearch.toLowerCase()),
  );
  const groups = [...new Set(filteredSelections.map((s) => s.marketId))];
  const activeMatch = games.find((g) => g.id === selectedGame);

  return (
    <div className="mt-6 pb-16 lg:pb-0">
      {(storageError || notice) && (
        <output className="mb-4 rounded-xl border border-violet-400/20 bg-violet-500/10 p-3 text-sm text-violet-100">
          {storageError ?? notice}
        </output>
      )}
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_390px]">
        <section
          className="min-w-0 space-y-5"
          aria-label="Match and market browser"
        >
          <div className="panel p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-semibold">
                {mode === 'browse' ? 'Browse matches' : 'Choose matches'}
              </h2>
              <div className="flex items-center gap-2">
                {/*
                  One list, two questions. Browsing opens a match's real
                  markets; choosing asks the model what it would back across
                  several.
                */}
                <fieldset className="flex rounded-lg border border-white/15 p-0.5">
                  <legend className="sr-only">Match list mode</legend>
                  {(['browse', 'suggest'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={mode === option}
                      onClick={() => setMode(option)}
                      className={`min-h-9 rounded-md px-2.5 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-violet-400 ${
                        mode === option
                          ? 'bg-violet-500/25 text-white'
                          : 'text-white/50 hover:text-white'
                      }`}
                    >
                      {option === 'browse' ? 'Browse' : 'Suggest'}
                    </button>
                  ))}
                </fieldset>
                <button
                  className={action}
                  onClick={() => void loadGames()}
                  disabled={gamesLoading}
                  aria-label="Refresh match list"
                >
                  <RefreshCw className="size-4" />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Search matches or competitions</span>
                <Search
                  className="absolute left-3 top-3 size-4 text-white/40"
                  aria-hidden="true"
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Match or competition"
                  className={`${control} w-full pl-9`}
                />
              </label>
              <label>
                <span className="sr-only">Sport</span>
                <select
                  className={control}
                  value={sport}
                  onChange={(e) => setSport(e.target.value)}
                >
                  <option value="all">All sports</option>
                  {[...new Set(games.map((g) => g.sport))].sort().map((s) => (
                    <option key={s} value={s}>
                      {s.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-2 text-xs text-white/50">
              {mode === 'browse'
                ? 'Next eight days · Choose a match to view markets. A match alone does not add a leg.'
                : `Next eight days · Tick the matches to build from. ${picked.length} chosen.`}
            </p>
            {gamesLoading ? (
              <output className="py-8 text-sm text-white/60">
                Loading matches…
              </output>
            ) : gamesError ? (
              <p className="py-5 text-sm text-amber-200" role="alert">
                {gamesError}
              </p>
            ) : (
              <div className="mt-3 max-h-[340px] space-y-2 overflow-y-auto pr-1">
                {!filteredGames.length && (
                  <p className="py-5 text-sm text-white/60">
                    No matching scheduled or live events.
                  </p>
                )}
                {filteredGames.map((game) => {
                  const chosen = picked.includes(game.id);
                  const active = mode === 'suggest' ? chosen : selectedGame === game.id;

                  return (
                    <button
                      key={game.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        if (mode === 'suggest') {
                          setPicked((current) =>
                            current.includes(game.id)
                              ? current.filter((id) => id !== game.id)
                              : [...current, game.id],
                          );
                          return;
                        }
                        setSelectedGame(game.id);
                        setReplaceId(undefined);
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left focus-visible:outline-2 focus-visible:outline-violet-400 ${active ? 'border-violet-400/50 bg-violet-500/15' : 'border-white/10 hover:bg-white/5'}`}
                    >
                      {mode === 'suggest' && (
                        <span
                          aria-hidden="true"
                          className={`grid size-5 shrink-0 place-items-center rounded-md border text-[11px] ${
                            chosen
                              ? 'border-violet-400 bg-violet-500 text-white'
                              : 'border-white/20 text-transparent'
                          }`}
                        >
                          ✓
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {fixtureLabel(game)}
                        </span>
                        <span className="mt-1 block text-xs text-white/55">
                          {game.league} · {displayTime(game.start_time)} ·{' '}
                          {game.status === 'live' ? 'In-play' : 'Pre-match'}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {mode === 'suggest' && (
            <SuggestPanel
              picked={picked}
              risk={risk}
              onRisk={setRisk}
              onClear={() => setPicked([])}
              onOpenMatch={(gameId) => {
                // Straight to the real markets for that match, which is the
                // only place a leg can actually be made.
                setMode('browse');
                setSelectedGame(gameId);
                setReplaceId(undefined);
                document
                  .getElementById('market-browser')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />
          )}

          <section
            id="market-browser"
            className={`panel scroll-mt-24 p-4 ${mode === 'suggest' ? 'hidden' : ''}`}
            aria-busy={marketLoading}
          >
            <h2 className="font-semibold">
              {markets?.event?.name ??
                (activeMatch
                  ? fixtureLabel(activeMatch)
                  : selectedGame
                    ? 'Selected match'
                    : 'Choose a match')}
            </h2>
            {replaceId && (
              <div className="my-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-violet-500/10 p-3 text-sm">
                <p>
                  Choose a supported replacement. The current leg stays until
                  you accept.
                </p>
                <button
                  className={action}
                  onClick={() => setReplaceId(undefined)}
                >
                  Cancel replacement
                </button>
              </div>
            )}
            {selectedGame && (
              <a
                className="mt-2 inline-block text-sm text-violet-300 underline"
                href={`/games/${encodeURIComponent(selectedGame)}`}
              >
                Game details
              </a>
            )}
            {marketLoading ? (
              <output className="py-6 text-sm text-white/60">
                Loading provider markets…
              </output>
            ) : marketError ? (
              <div role="alert">
                <p className="my-3 text-sm text-amber-200">{marketError}</p>
                <button
                  className={action}
                  onClick={() => setMarketRevision((r) => r + 1)}
                >
                  Retry markets
                </button>
              </div>
            ) : markets ? (
              <>
                {markets.message && (
                  <p
                    className={`my-3 rounded-lg p-3 text-sm leading-6 ${markets.stale ? 'bg-amber-500/10 text-amber-200' : 'bg-white/5 text-white/65'}`}
                  >
                    {markets.message}
                  </p>
                )}
                {!!markets.selections.length && (
                  <>
                    <div className="my-4 grid gap-3 sm:grid-cols-2">
                      <label className="text-sm text-white/70">
                        Bookmaker
                        <select
                          className={`${control} mt-1 w-full`}
                          value={line.bookmakerId}
                          onChange={(e) =>
                            setLine((current) => ({
                              ...current,
                              bookmakerId: e.target.value,
                            }))
                          }
                        >
                          <option value="">Choose a bookmaker</option>
                          {books.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm text-white/70">
                        Search markets
                        <input
                          className={`${control} mt-1 w-full`}
                          placeholder="Winner, total, team…"
                          value={marketSearch}
                          onChange={(e) => setMarketSearch(e.target.value)}
                        />
                      </label>
                    </div>
                    {!filteredSelections.length && (
                      <p className="text-sm text-white/60">
                        No outcomes from this bookmaker match the search.
                      </p>
                    )}
                    {groups.map((groupId) => {
                      const choices = filteredSelections.filter(
                        (s) => s.marketId === groupId,
                      );
                      const first = choices[0];
                      return (
                        <div
                          key={groupId}
                          className="mt-4 border-t border-white/10 pt-4"
                        >
                          <h3 className="text-sm font-medium">
                            {first.marketName}
                            {first.market === 'totals'
                              ? ` ${first.line}`
                              : ''}{' '}
                            <span className="font-normal text-white/50">
                              · {first.bookmaker.name}
                            </span>
                          </h3>
                          <p className="my-2 text-xs leading-5 text-white/50">
                            Full game · {first.settlement.label}
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {choices.map((selection) => {
                              const preview = addSelection(
                                line,
                                selection,
                                replaceId,
                              );
                              const replacementReturn =
                                replaceId && !preview.error
                                  ? calculateLine(preview.line, null, now)
                                      .totalReturn
                                  : null;
                              const originalReturn = calculateLine(
                                line,
                                null,
                                now,
                              ).totalReturn;
                              const previous = line.legs.find(
                                (leg) => leg.selection.id === replaceId,
                              )?.selection;
                              const lowerPrice =
                                previous?.decimal !== null &&
                                previous?.decimal !== undefined &&
                                selection.decimal !== null &&
                                selection.decimal < previous.decimal;
                              const disabled =
                                markets.stale ||
                                !quoteUsable(selection, now) ||
                                !!preview.error;
                              return (
                                <button
                                  key={selection.id}
                                  className="rounded-lg border border-white/15 bg-white/[.03] p-3 text-left hover:border-violet-400/50 focus-visible:outline-2 focus-visible:outline-violet-400 disabled:cursor-not-allowed disabled:opacity-45"
                                  disabled={disabled}
                                  onClick={() => choose(selection)}
                                >
                                  <span className="flex justify-between gap-3 text-sm">
                                    <span>
                                      {selection.outcome}
                                      {selection.line === null
                                        ? ''
                                        : ` ${selection.line > 0 && selection.market === 'spreads' ? '+' : ''}${selection.line}`}
                                    </span>
                                    <strong className="text-violet-200">
                                      {selection.decimal?.toFixed(2) ?? '—'}
                                    </strong>
                                  </span>
                                  <span className="mt-2 block text-xs leading-5 text-white/55">
                                    {selection.event.status === 'prematch'
                                      ? 'Pre-match'
                                      : 'In-play'}{' '}
                                    · Odds {displayTime(selection.quotedAt)}
                                    <br />
                                    {preview.error ??
                                      (disabled
                                        ? 'Expired / unavailable'
                                        : replaceId
                                          ? `Accept replacement${replacementReturn === null ? '' : ` · estimated return ${line.currency} ${replacementReturn.toFixed(2)}`}`
                                          : 'Add selection')}
                                    {replaceId && !preview.error && (
                                      <span className="mt-2 block">
                                        {replacementReturn === null
                                          ? 'Complete-line return unavailable until all issues are resolved.'
                                          : originalReturn === null
                                            ? 'The original line has no available return to compare.'
                                            : `Return change at the same stake: ${line.currency} ${(replacementReturn - originalReturn).toFixed(2)}.`}
                                        {lowerPrice &&
                                          ' Lower quoted odds imply a higher bookmaker probability and a smaller payout multiplier; they do not establish lower modelled risk.'}
                                      </span>
                                    )}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    <p className="mt-4 text-xs text-white/50">
                      Retrieved {displayTime(markets.fetchedAt)} · Decimal odds
                      · Source: The Odds API
                    </p>
                  </>
                )}
              </>
            ) : (
              <p className="mt-3 text-sm leading-6 text-white/55">
                Select a match above to see only the outcomes and prices
                returned by the odds provider.
              </p>
            )}
          </section>
          {analysisOpen && (
            <AnalysisPanel
              line={line}
              evidence={evidence}
              loading={analysing}
              error={analysisError}
              now={now}
              onReview={review}
              onRemove={(id) =>
                setLine((current) => ({
                  ...current,
                  legs: current.legs.filter((l) => l.selection.id !== id),
                }))
              }
              onRefresh={refresh}
            />
          )}
        </section>
        <aside
          className="fixed inset-x-2 bottom-[82px] z-40 rounded-2xl border border-violet-400/25 bg-[#100d19] shadow-2xl lg:sticky lg:inset-auto lg:top-20 lg:z-10 lg:self-start lg:shadow-none"
          aria-label="Current betting line"
        >
          <button
            className="flex min-h-14 w-full items-center justify-between p-4 text-sm font-semibold lg:hidden"
            aria-expanded={panelOpen}
            aria-controls="builder-panel"
            onClick={() => setPanelOpen((v) => !v)}
          >
            <span>
              Your line{' '}
              <span className="ml-2 text-violet-300">
                {line.legs.length} legs
              </span>
            </span>
            {panelOpen ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronUp className="size-4" />
            )}
          </button>
          <div
            id="builder-panel"
            className={`${panelOpen ? 'block' : 'hidden'} max-h-[65vh] overflow-y-auto p-4 lg:block lg:max-h-[calc(100vh-7rem)]`}
          >
            <LinePanel
              now={now}
              onReview={review}
              onRefresh={refresh}
              refreshing={refreshing && !!line.legs.length}
              onAnalyse={() => {
                void analyse();
                setPanelOpen(false);
              }}
              analysing={analysing}
              onSave={() => void save()}
              saving={saving}
              books={books}
            />
            <div className="mt-5 border-t border-white/10 pt-4">
              <h3 className="text-sm font-medium">Saved drafts</h3>
              <p className="mt-1 text-xs leading-5 text-white/50">
                Named drafts are shared on this server. Your current working
                copy is saved on this device.
              </p>
              {draftError && (
                <p className="mt-2 text-sm text-amber-200" role="alert">
                  {draftError}
                </p>
              )}
              {!drafts.length && (
                <p className="mt-3 text-sm text-white/45">
                  No named drafts yet.
                </p>
              )}
              <div className="mt-2 max-h-44 space-y-2 overflow-y-auto">
                {drafts.map((draft) => (
                  <button
                    key={draft.id}
                    className={`${control} w-full text-left`}
                    onClick={() => {
                      const restored = restoreLine(draft.line);
                      if (restored) {
                        setLine(restored);
                        setReplaceId(undefined);
                        setRefreshRevision((r) => r + 1);
                        setNotice(
                          'Draft reopened. Revalidating availability and odds.',
                        );
                      }
                    }}
                  >
                    <span className="block">
                      {draft.line.name} · {draft.line.legs.length} legs
                    </span>
                    <span className="text-xs text-white/45">
                      {displayTime(draft.savedAt)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>
      <p className="mt-6 text-xs leading-5 text-white/45">
        Builder prepares, analyses and saves lines. It does not place wagers.
        Prices are estimates until confirmed; no bookmaker combination quote
        service is connected.
      </p>
    </div>
  );
}
