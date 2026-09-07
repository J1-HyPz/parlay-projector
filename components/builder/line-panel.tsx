'use client';
import { useState } from 'react';
import { Copy, Download, RefreshCw, Trash2 } from 'lucide-react';
import { useBuilder } from './builder-context';
import { action, control, displayTime } from './ui';
import { acceptPrice, calculateLine, quoteUsable } from '@/lib/builder/line';
import { CURRENCIES } from '@/lib/builder/types';
import { exportLine } from '@/lib/builder/drafts';

export function LinePanel({
  now,
  onReview,
  onRefresh,
  refreshing,
  onAnalyse,
  analysing,
  onSave,
  saving,
  books,
}: {
  now: number;
  onReview: (id: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  onAnalyse: () => void;
  analysing: boolean;
  onSave: () => void;
  saving: boolean;
  books: { id: string; name: string }[];
}) {
  const { line, setLine, ready } = useBuilder();
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const price = calculateLine(line, null, now);
  const money = (n: number | null) =>
    n === null ? 'Unavailable' : `${line.currency} ${n.toFixed(2)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportLine(line, now));
      setCopyStatus('Line summary copied.');
    } catch {
      setCopyStatus('Clipboard unavailable. Download the summary below.');
    }
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([exportLine(line, now)], { type: 'text/plain;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'parlay-builder-line.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section aria-busy={refreshing}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          Your line{' '}
          <span className="text-violet-300">({line.legs.length})</span>
        </h2>
        <span className="text-xs text-white/50">{price.kind}</span>
      </div>
      {!ready ? (
        <output className="py-5 text-sm text-white/60">
          Restoring working copy…
        </output>
      ) : !line.legs.length ? (
        <p className="my-4 rounded-xl border border-dashed border-violet-400/20 p-5 text-sm leading-6 text-white/55">
          Your line starts with a specific outcome. Choose a match, bookmaker
          and market to add the first leg.
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {line.legs.map((leg, i) => {
            const s = leg.selection;
            const expired = !quoteUsable(s, now);
            return (
              <li
                key={s.id}
                className="rounded-xl border border-white/10 bg-white/[.025] p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <a
                    href={`/games/${encodeURIComponent(s.event.id)}`}
                    className="text-sm font-medium leading-5 hover:text-violet-300"
                  >
                    {i + 1}. {s.event.name}
                  </a>
                  <button
                    className="shrink-0 rounded-lg p-2 text-white/50 hover:text-rose-300 focus-visible:outline-2 focus-visible:outline-violet-400"
                    aria-label={`Remove ${s.outcome} from ${s.event.name}`}
                    onClick={() =>
                      setLine((current) => ({
                        ...current,
                        legs: current.legs.filter(
                          (l) => l.selection.id !== s.id,
                        ),
                      }))
                    }
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <p className="mt-1 text-xs leading-5 text-white/50">
                  {s.event.competition} · {displayTime(s.event.startTime)} ·{' '}
                  {s.event.status === 'prematch'
                    ? 'Pre-match'
                    : s.event.status === 'live'
                      ? 'In-play'
                      : s.event.status}
                </p>
                <p className="mt-2 text-sm text-violet-200">
                  {s.marketName}: {s.outcome}
                  {s.line === null
                    ? ''
                    : ` ${s.line > 0 && s.market === 'spreads' ? '+' : ''}${s.line}`}
                </p>
                <p className="mt-1 text-xs leading-5 text-white/50">
                  {s.period === 'full_game' ? 'Full game' : s.period} ·{' '}
                  {s.settlement.label}
                </p>
                <div className="mt-2 flex justify-between gap-2 text-sm">
                  <span>{s.bookmaker.name}</span>
                  <strong className="tabular-nums">
                    {s.decimal?.toFixed(2) ?? 'Unavailable'}
                  </strong>
                </div>
                <p className="mt-1 text-xs leading-5 text-white/50">
                  Odds timestamp: {displayTime(s.quotedAt)}
                  <br />
                  Retrieved: {displayTime(s.fetchedAt)}
                  <br />
                  Availability: {s.availability} · {leg.state}
                  {expired ? ' · expired / unusable' : ''}
                </p>
                {(leg.reason || expired) && (
                  <p className="mt-2 text-xs leading-5 text-amber-200">
                    {leg.reason ??
                      'This price has expired. Refresh before using it.'}
                  </p>
                )}
                {s.bookmaker.id !== line.bookmakerId && (
                  <p className="mt-2 text-xs text-amber-200">
                    This leg is from a different bookmaker. Replace or remove
                    it.
                  </p>
                )}
                {leg.state === 'changed' && leg.pending && (
                  <div className="mt-3 rounded-lg border border-amber-400/20 p-2 text-sm">
                    <p>
                      Update: {s.decimal?.toFixed(2)} →{' '}
                      {leg.pending.decimal?.toFixed(2)}
                    </p>
                    <p className="mt-1 text-xs text-white/60">
                      {leg.pending.event.status} ·{' '}
                      {displayTime(leg.pending.event.startTime)}
                    </p>
                    <button
                      className={`${action} mt-2 w-full`}
                      disabled={!quoteUsable(leg.pending, now)}
                      onClick={() =>
                        setLine((current) => ({
                          ...current,
                          legs: current.legs.map((l) =>
                            l.selection.id === s.id ? acceptPrice(l) : l,
                          ),
                        }))
                      }
                    >
                      Accept updated price
                    </button>
                  </div>
                )}
                <button
                  className="mt-2 min-h-9 text-sm text-violet-300 underline focus-visible:outline-2 focus-visible:outline-violet-400"
                  onClick={() => onReview(s.id)}
                >
                  Review / replace selection
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-4 space-y-3">
        <label className="block text-sm text-white/65">
          Line name
          <input
            className={`${control} mt-1 w-full`}
            maxLength={100}
            value={line.name}
            onChange={(e) =>
              setLine((current) => ({ ...current, name: e.target.value }))
            }
          />
        </label>
        <label className="block text-sm text-white/65">
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
            <option value="">Choose bookmaker</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-[1fr_100px] gap-2">
          <label className="text-sm text-white/65">
            Total stake
            <input
              inputMode="decimal"
              className={`${control} mt-1 w-full`}
              value={line.stake}
              maxLength={20}
              onChange={(e) =>
                setLine((current) => ({ ...current, stake: e.target.value }))
              }
            />
          </label>
          <label className="text-sm text-white/65">
            Currency
            <select
              className={`${control} mt-1 w-full`}
              value={line.currency}
              onChange={(e) =>
                setLine((current) => ({ ...current, currency: e.target.value }))
              }
            >
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        {!price.stakeValid && (
          <p className="text-xs text-amber-200">
            Enter a stake above zero, up to 1,000,000, with at most two decimal
            places.
          </p>
        )}
        <div className="rounded-xl border border-violet-400/20 bg-violet-500/10 p-4">
          <p className="text-xs uppercase tracking-wide text-violet-300">
            Estimated line
          </p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt>Combined decimal odds</dt>
              <dd className="font-semibold tabular-nums">
                {price.decimal?.toFixed(2) ?? 'Unavailable'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Return including stake</dt>
              <dd className="font-semibold tabular-nums">
                {money(price.totalReturn)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Net profit</dt>
              <dd className="tabular-nums">{money(price.profit)}</dd>
            </div>
          </dl>
          {price.implied !== null && (
            <p className="mt-3 text-xs leading-5 text-white/60">
              Price-implied probability: {(price.implied * 100).toFixed(2)}%,
              including bookmaker margin. Model probability unavailable.
            </p>
          )}
          <p className="mt-3 text-xs leading-5 text-white/55">
            {price.label}. Distinct-match prices are multiplied only within one
            bookmaker. Settlement and combination acceptance are unconfirmed.
          </p>
        </div>
        {!!price.issues.length && (
          <ul
            className="list-disc space-y-1 pl-4 text-xs leading-5 text-amber-200"
            aria-label="Line issues"
          >
            {price.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
        <button
          className={`${action} w-full`}
          disabled={!line.legs.length || analysing}
          onClick={onAnalyse}
        >
          {analysing ? 'Analysing…' : 'Analyse line'}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            className={action}
            disabled={!line.legs.length || refreshing}
            onClick={onRefresh}
          >
            <RefreshCw className="size-4" />
            {refreshing ? 'Checking…' : 'Refresh prices'}
          </button>
          <button
            className={action}
            disabled={
              !ready || !line.legs.length || !line.name.trim() || saving
            }
            onClick={onSave}
          >
            {saving ? 'Saving…' : 'Save named draft'}
          </button>
        </div>
        <p className="text-xs leading-5 text-white/45">
          Refresh shares the server cache to respect provider quotas. It never
          changes your selected outcome or accepts a moved price automatically.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            className={control}
            disabled={!line.legs.length}
            onClick={() => void copy()}
          >
            <Copy className="mr-1 inline size-4" />
            Copy summary
          </button>
          <button
            className={control}
            disabled={!line.legs.length}
            onClick={download}
          >
            <Download className="mr-1 inline size-4" />
            Export .txt
          </button>
        </div>
        {copyStatus && (
          <output className="text-xs text-violet-200">{copyStatus}</output>
        )}
      </div>
    </section>
  );
}
