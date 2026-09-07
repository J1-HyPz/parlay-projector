import { calculateLine, quoteUsable, sameEvent } from './line.ts';
import type { BuilderLine } from './types.ts';

/** Price arithmetic describes payout concentration, never estimated win confidence. */
export function analyseStructure(line: BuilderLine, now = Date.now()) {
  const risks: string[] = [];
  const counts = new Map<string, number>();
  const teams = new Map<string, Set<string>>();
  for (const { selection: s } of line.legs) {
    counts.set(s.event.competition, (counts.get(s.event.competition) ?? 0) + 1);
    for (const team of [s.event.home, s.event.away]) {
      if (!team) continue;
      const key = `${s.event.sport}:${team}`;
      const events = teams.get(key) ?? new Set<string>();
      events.add(s.event.id);
      teams.set(key, events);
    }
  }
  for (const [competition, count] of counts)
    if (count > 1)
      risks.push(
        `${count} legs are concentrated in ${competition}; shared conditions can affect several results.`,
      );
  for (const [team, events] of teams)
    if (events.size > 1)
      risks.push(
        `${team.split(':').slice(1).join(':')} appears in ${events.size} matches. Form, injuries and schedule effects can connect these legs.`,
      );
  if (
    line.legs.some((l, i) =>
      line.legs
        .slice(i + 1)
        .some((other) => sameEvent(l.selection, other.selection)),
    )
  )
    risks.push(
      'Several legs share a match. Their outcomes may be correlated; individual prices cannot price this combination.',
    );
  if (line.legs.length > 1)
    risks.push(
      'Every leg must succeed for an accumulator to win. Distinct matches do not establish statistical independence; cross-match correlation has not been measured.',
    );
  if (line.legs.some((l) => l.selection.settlement.scope === 'unknown'))
    risks.push(
      'The odds feed does not supply regulation / overtime settlement rules. Confirm each bookmaker market before treating the line as executable.',
    );
  const priced = line.legs.filter((l) => quoteUsable(l.selection, now));
  const largest = [...priced].sort(
    (a, b) => b.selection.decimal! - a.selection.decimal!,
  )[0];
  const comparisons = line.legs.map((leg) => {
    const shorter = {
      ...line,
      legs: line.legs.filter((l) => l.selection.id !== leg.selection.id),
    };
    return {
      id: leg.selection.id,
      name: `${leg.selection.event.name}: ${leg.selection.marketName} — ${leg.selection.outcome}`,
      result: calculateLine(shorter, null, now),
      remaining: shorter.legs.length,
    };
  });
  // Split the SAME total stake among singles (allocate remaining pennies explicitly).
  const stake = Number(line.stake);
  const cents = Math.round(stake * 100);
  const base = Math.floor(cents / Math.max(1, line.legs.length));
  const singles = line.legs.map((leg, i) => {
    const split = (base + (i < cents % line.legs.length ? 1 : 0)) / 100;
    const result = calculateLine(
      { ...line, stake: split.toFixed(2), legs: [leg] },
      null,
      now,
    );
    return { id: leg.selection.id, stake: split, result };
  });
  const allSinglesReturn =
    singles.length && singles.every((s) => s.result.totalReturn !== null)
      ? Math.round(
          singles.reduce((n, s) => n + s.result.totalReturn!, 0) * 100,
        ) / 100
      : null;
  return {
    risks,
    largest: largest
      ? `${largest.selection.event.name}: ${largest.selection.outcome} at ${largest.selection.decimal!.toFixed(2)} contributes the largest price multiplier. Its bookmaker-implied probability is ${(100 / largest.selection.decimal!).toFixed(1)}%, including margin; this is not model confidence or a quantified uncertainty estimate.`
      : 'No current prices are available to rank payout contributions.',
    uncertainty:
      'Leg uncertainty cannot be ranked reliably: confirmed lineups, injury data and a calibrated model for these exact bets are missing. Higher odds alone do not establish a reliable risk ranking.',
    comparisons,
    singles,
    allSinglesReturn,
  };
}
