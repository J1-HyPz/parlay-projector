import { MAX_LEGS, CURRENCIES } from './types.ts';
import type {
  BetSelection,
  BuilderLeg,
  BuilderLine,
  CombinationQuote,
  MarketResponse,
} from './types.ts';

export function quoteUsable(
  selection: BetSelection,
  now = Date.now(),
): boolean {
  const quoted = Date.parse(selection.quotedAt ?? '');
  return (
    selection.availability === 'available' &&
    selection.decimal !== null &&
    Number.isFinite(selection.decimal) &&
    selection.decimal > 1 &&
    Number.isFinite(quoted) &&
    quoted <= now + 30_000 &&
    Date.parse(selection.expiresAt) > now &&
    (selection.event.status === 'prematch' ||
      selection.event.status === 'live') &&
    // A pre-match quote does not become an in-play quote at kickoff.
    (selection.event.status !== 'prematch' ||
      Date.parse(selection.event.startTime ?? '') > now)
  );
}

export function sameEvent(a: BetSelection, b: BetSelection): boolean {
  return (
    a.event.id === b.event.id ||
    (a.provider === b.provider &&
      a.event.providerEventId === b.event.providerEventId)
  );
}

export function selectionConflict(
  a: BetSelection,
  b: BetSelection,
): string | null {
  if (!sameEvent(a, b)) return null;
  if (
    a.id === b.id ||
    (a.marketId === b.marketId && a.outcomeId === b.outcomeId)
  )
    return 'This selection is already in the line.';
  // Different settlement scopes are distinct bets, but cannot be assumed combinable.
  const compatibleRules =
    a.settlement.key === b.settlement.key ||
    (a.settlement.scope !== 'unknown' &&
      a.settlement.scope === b.settlement.scope);
  if (a.period !== b.period || !compatibleRules) return null;
  if (
    a.market === b.market &&
    a.marketId === b.marketId &&
    a.outcomeId !== b.outcomeId
  ) {
    return 'These outcomes are alternatives in the same market.';
  }
  if (a.market === 'h2h' && b.market === 'h2h' && a.side !== b.side)
    return 'Both match-winner selections cannot win.';
  if (
    a.market === 'totals' &&
    b.market === 'totals' &&
    a.direction !== b.direction &&
    a.line !== null &&
    b.line !== null
  ) {
    const over = a.direction === 'over' ? a : b;
    const under = a.direction === 'under' ? a : b;
    if (over.line! >= under.line!)
      return 'These over and under thresholds cannot both win.';
  }
  if (
    a.market === 'spreads' &&
    b.market === 'spreads' &&
    a.side !== b.side &&
    a.line !== null &&
    b.line !== null &&
    a.line + b.line <= 0
  ) {
    return 'These opposing handicaps cannot both win.';
  }
  const winner = a.market === 'h2h' ? a : b.market === 'h2h' ? b : null;
  const spread = a.market === 'spreads' ? a : b.market === 'spreads' ? b : null;
  if (
    winner &&
    spread &&
    spread.line !== null &&
    spread.line <= 0 &&
    winner.side !== spread.side
  ) {
    return 'The match winner conflicts with the opposing team covering this handicap.';
  }
  return null;
}

export function addSelection(
  line: BuilderLine,
  selection: BetSelection,
  replaceId?: string,
): { line: BuilderLine; error: string | null } {
  const remaining = line.legs.filter((l) => l.selection.id !== replaceId);
  if (replaceId && !line.legs.some((l) => l.selection.id === replaceId))
    return { line, error: 'The leg to replace is no longer present.' };
  if (remaining.length >= MAX_LEGS)
    return { line, error: `A line supports up to ${MAX_LEGS} legs.` };
  if (line.bookmakerId && line.bookmakerId !== selection.bookmaker.id)
    return { line, error: 'Choose an outcome from the selected bookmaker.' };
  for (const leg of remaining) {
    const error = selectionConflict(leg.selection, selection);
    if (error) return { line, error };
  }
  const leg: BuilderLeg = {
    selection,
    state: 'unverified',
    pending: null,
    checkedAt: null,
    reason: 'Refresh prices to revalidate this selection.',
  };
  const legs = replaceId
    ? line.legs.map((l) => (l.selection.id === replaceId ? leg : l))
    : [...remaining, leg];
  return {
    line: {
      ...line,
      bookmakerId: line.bookmakerId || selection.bookmaker.id,
      legs,
    },
    error: null,
  };
}

export function revalidateLeg(
  leg: BuilderLeg,
  response: MarketResponse,
  now = Date.now(),
): BuilderLeg {
  const next = response.selections.find(
    (s) =>
      s.id === leg.selection.id &&
      s.bookmaker.id === leg.selection.bookmaker.id,
  );
  const checkedAt = new Date(now).toISOString();
  if (!next || response.stale || !quoteUsable(next, now))
    return {
      ...leg,
      state: 'unavailable',
      pending: next ?? null,
      checkedAt,
      reason:
        response.message ??
        'Price missing, suspended, expired, or not a current provider quote.',
    };
  // Identity includes line/settlement, but compare them defensively too.
  if (
    next.decimal !== leg.selection.decimal ||
    next.line !== leg.selection.line ||
    next.settlement.key !== leg.selection.settlement.key ||
    next.event.status !== leg.selection.event.status ||
    next.event.startTime !== leg.selection.event.startTime
  ) {
    return {
      ...leg,
      state: 'changed',
      pending: next,
      checkedAt,
      reason:
        'The price or event details changed. Review and accept the update.',
    };
  }
  return {
    selection: next,
    state: 'current',
    pending: null,
    checkedAt,
    reason: null,
  };
}

export function acceptPrice(leg: BuilderLeg, now = Date.now()): BuilderLeg {
  if (leg.state !== 'changed' || !leg.pending || !quoteUsable(leg.pending, now))
    return leg;
  return {
    ...leg,
    selection: leg.pending,
    pending: null,
    state: 'current',
    reason: null,
  };
}

export function calculateLine(
  line: BuilderLine,
  combination: CombinationQuote | null = null,
  now = Date.now(),
) {
  const issues: string[] = [];
  const selections = line.legs.map((l) => l.selection);
  const sameGame = selections.some((s, i) =>
    selections.slice(i + 1).some((other) => sameEvent(s, other)),
  );
  const kind =
    selections.length <= 1
      ? 'Single'
      : sameGame
        ? 'Same-game / mixed combination'
        : 'Multi-match accumulator';
  if (!selections.length)
    issues.push('Choose a specific outcome to add a leg.');
  if (selections.some((s) => s.bookmaker.id !== line.bookmakerId))
    issues.push('Every leg must be quoted by the selected bookmaker.');
  for (let i = 0; i < selections.length; i++)
    for (let j = i + 1; j < selections.length; j++) {
      const conflict = selectionConflict(selections[i], selections[j]);
      if (conflict) issues.push(conflict);
    }
  if (line.legs.some((l) => l.state === 'changed'))
    issues.push('Accept or replace changed prices before calculating.');
  if (
    line.legs.some(
      (l) => l.state === 'unavailable' || !quoteUsable(l.selection, now),
    )
  )
    issues.push(
      'One or more prices are unavailable, expired, or only reference prices.',
    );
  const ids = selections.map((s) => s.id).sort();
  const quoteValid =
    combination !== null &&
    combination.bookmakerId === line.bookmakerId &&
    combination.selectionIds.length === ids.length &&
    [...combination.selectionIds].sort().every((id, i) => id === ids[i]) &&
    Number.isFinite(combination.decimal) &&
    combination.decimal > 1 &&
    Date.parse(combination.quotedAt) <= now + 30_000 &&
    Date.parse(combination.expiresAt) > now &&
    line.legs.every((l) => l.state === 'current');
  if (sameGame && !quoteValid)
    issues.push(
      'Same-game selections require an actual bookmaker combination quote. Combined price unavailable.',
    );
  const stake = line.stake.trim() === '' ? NaN : Number(line.stake);
  const stakeValid =
    Number.isFinite(stake) &&
    stake > 0 &&
    stake <= 1_000_000 &&
    /^\d+(\.\d{1,2})?$/.test(line.stake) &&
    CURRENCIES.includes(line.currency as (typeof CURRENCIES)[number]);
  const product = selections.reduce((n, s) => n * (s.decimal ?? 0), 1);
  if (!Number.isFinite(product) || product > 1e12)
    issues.push('Combined odds exceed the supported calculation range.');
  const decimal = issues.length
    ? null
    : quoteValid
      ? combination!.decimal
      : product;
  const totalReturn =
    decimal !== null && stakeValid
      ? Math.round(stake * decimal * 100) / 100
      : null;
  const executable = decimal !== null && quoteValid;
  return {
    kind,
    sameGame,
    issues: [...new Set(issues)],
    decimal,
    stakeValid,
    totalReturn,
    profit:
      totalReturn === null
        ? null
        : Math.round((totalReturn - stake) * 100) / 100,
    implied: decimal === null ? null : 1 / decimal,
    executable,
    label: executable
      ? 'Provider combination quote'
      : 'Estimate — bookmaker combination acceptance unconfirmed',
  };
}
