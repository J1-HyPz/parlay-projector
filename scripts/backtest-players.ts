#!/usr/bin/env node
/**
 * Run the player market's gate.
 *
 *   pnpm backtest:players            # 2025, the most recent complete season
 *   pnpm backtest:players 2024
 *
 * A player market ships only if it is calibrated at the lines it is scored on
 * and beats the player's own plain average with the same distribution. This
 * prints both, from real appearances, and says plainly whether the gate passed.
 *
 * WHAT IT FETCHES. The pilot is baseball's starting-pitcher strikeouts, so it
 * needs two things and nothing else:
 *
 *   1. Who actually starts. Taken from the scoreboard's own `probables`, which
 *      is what the live path reads — sampled every few days rather than daily,
 *      because a starter pitches roughly every fifth game and a sample of dates
 *      already names nearly all of them.
 *   2. Each of those pitchers' appearances, from the gamelog, for the season
 *      being scored and the one before it. The earlier season is what lets an
 *      April start be scored at all rather than skipped for a short record.
 *
 * Everything is cached by the application's own cache, so a second run inside
 * the cache lifetime costs nothing. No API key is involved.
 */

import { MLB_PITCHER_STATS } from '../lib/projections/player-model.ts';
import { backtestPlayerStat, DEFAULT_LINES } from '../lib/projections/player-backtest.ts';
import type { Scored } from '../lib/projections/player-backtest.ts';
import { athleteGamelog } from '../lib/providers/espn/gamelog.ts';
import { announcedStarters } from '../lib/providers/espn/pitchers.ts';
import type { PlayerGame } from '../lib/players/history.ts';

const season = Number(process.argv[2] ?? 2025);
if (!Number.isInteger(season) || season < 2015) {
  console.error('Usage: pnpm backtest:players [season]');
  process.exit(2);
}

/** Baseball runs late March to early November. */
const FIRST = new Date(Date.UTC(season, 2, 25));
const LAST = new Date(Date.UTC(season, 10, 5));

/** Days between sampled scoreboards. A starter pitches every fifth game. */
const STRIDE = 4;

/** Pitchers to gather. Enough for a few thousand appearances. */
const MAX_PITCHERS = 120;

const CONCURRENCY = 4;

function compact(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function dates(): string[] {
  const out: string[] = [];
  const d = new Date(FIRST);
  for (; d <= LAST; d.setUTCDate(d.getUTCDate() + STRIDE)) {
    out.push(compact(d));
  }
  return out;
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        if (item !== undefined) results.push(await run(item));
      }
    }),
  );
  return results;
}

function table(label: string, scored: Scored): void {
  console.log(
    `  ${label.padEnd(10)} brier ${String(scored.brier).padEnd(7)} ` +
      `log loss ${String(scored.log_loss).padEnd(7)} ` +
      `bias ${String(scored.bias).padEnd(8)} ` +
      `accuracy ${scored.accuracy}`,
  );
}

console.log(`Season ${season}. Lines scored: ${DEFAULT_LINES.join(', ')}\n`);

// --- who starts ---------------------------------------------------------------
const sampled = dates();
console.log(`Reading ${sampled.length} scoreboards for announced starters…`);

const starters = new Map<string, string>();
const boards = await mapLimit(sampled, CONCURRENCY, (date) => announcedStarters([date]));
for (const board of boards) {
  for (const fixture of board.values()) {
    for (const side of [fixture.home, fixture.away]) {
      if (side?.name && !starters.has(side.id)) starters.set(side.id, side.name);
    }
  }
}

console.log(`Distinct announced starters found: ${starters.size}`);
if (starters.size === 0) {
  console.error(
    'None. That is a provider answer, not a model finding — a season with no ' +
      'announced starters cannot be used to gate this market.',
  );
  process.exit(1);
}

const pitchers = [...starters.entries()].slice(0, MAX_PITCHERS);
console.log(`Reading gamelogs for ${pitchers.length} of them, seasons ${season - 1} and ${season}…`);

// --- what they did -----------------------------------------------------------
const appearances: PlayerGame[] = [];

await mapLimit(pitchers, CONCURRENCY, async ([athleteId, name]) => {
  for (const year of [season - 1, season]) {
    const { rows } = await athleteGamelog('baseball/mlb', athleteId, {
      season: year,
      category: 'pitching',
    });

    for (const row of rows) {
      const strikeouts = Number(row.stats.strikeouts);
      if (!Number.isFinite(strikeouts)) continue;
      appearances.push({
        athleteId,
        name,
        teamId: null,
        position: 'SP',
        gameId: `espn-mlb-${row.eventId}`,
        date: row.date,
        stats: { strikeouts },
      });
    }
  }
});

// A start can appear in both seasons' payloads at a boundary; keep one of each.
const unique = new Map<string, PlayerGame>();
for (const appearance of appearances) unique.set(`${appearance.athleteId}:${appearance.gameId}`, appearance);
const all = [...unique.values()];

console.log(`Appearances gathered: ${all.length}\n`);
if (all.length === 0) {
  console.error('No appearances. Nothing to gate against.');
  process.exit(1);
}

// --- the gate ----------------------------------------------------------------
const config = MLB_PITCHER_STATS[0];
const report = backtestPlayerStat(all, config);

console.log(`Evaluated ${report.evaluated} appearances, skipped ${report.skipped} for a short record.`);
console.log(`Scored ${report.pairs} (appearance, line) pairs.\n`);

table('model', report.model);
table('baseline', report.baseline);

console.log(`\nDispersion (variance / mean, within player): ${report.dispersion}`);
if (report.dispersion !== null && report.dispersion > 1.15) {
  console.log(
    '  Above one by a real margin, so this count varies more than Poisson allows.\n' +
      '  That is a distribution problem, not a rate problem — set `dispersion` on the\n' +
      '  statistic and re-run, exactly as baseball’s scoring model needed.',
  );
}

console.log('\nCalibration — model, folded onto the favoured side:');
for (const band of report.model.bands) {
  console.log(
    `  ${(band.from * 100).toFixed(0)}-${(band.to * 100).toFixed(0)}%  n=${String(band.count).padStart(5)}` +
      `  says ${(band.predicted * 100).toFixed(1)}%  happened ${(band.actual * 100).toFixed(1)}%`,
  );
}

/**
 * Is the model's advantage over the baseline real, or is it noise?
 *
 * Clustered by appearance, and that is not a nicety. Each appearance is scored
 * at up to four lines, so the raw pair count overstates the evidence roughly
 * fourfold — treating 15,000 correlated pairs as 15,000 independent
 * observations would make any difference at all look significant. The unit of
 * evidence is one start, so each start's lines are averaged first and the test
 * runs across starts.
 */
function pairedTest(cases: readonly { gameId: string; athleteId: string; model: number; baseline: number; went_over: boolean }[]) {
  const byAppearance = new Map<string, number[]>();
  for (const entry of cases) {
    const key = `${entry.athleteId}:${entry.gameId}`;
    const delta =
      (entry.model - (entry.went_over ? 1 : 0)) ** 2 -
      (entry.baseline - (entry.went_over ? 1 : 0)) ** 2;
    const list = byAppearance.get(key);
    if (list) list.push(delta);
    else byAppearance.set(key, [delta]);
  }

  const perStart = [...byAppearance.values()].map(
    (deltas) => deltas.reduce((a, b) => a + b, 0) / deltas.length,
  );
  const n = perStart.length;
  if (n < 2) return { n, delta: null, t: null };

  const average = perStart.reduce((a, b) => a + b, 0) / n;
  const variance = perStart.reduce((sum, d) => sum + (d - average) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);

  return {
    n,
    delta: Number(average.toFixed(5)),
    t: se > 0 ? Number((average / se).toFixed(2)) : null,
  };
}

// --- the verdict -------------------------------------------------------------
const model = report.model;
const baseline = report.baseline;
const test = pairedTest(report.cases);

console.log(
  `\nPaired Brier difference, clustered by start: ${test.delta} over ${test.n} starts, t = ${test.t}`,
);
console.log('  Negative favours the model. The unit is a start, not an (appearance, line) pair.');

const beatsBaseline = test.delta !== null && test.delta < 0 && test.t !== null && test.t <= -2;
const calibrated = model.bias !== null && Math.abs(model.bias) <= 0.03;

console.log('\n--- verdict ---');
console.log(
  `Beats the baseline, established: ${beatsBaseline ? 'yes' : 'no'} ` +
    `(brier ${model.brier} against ${baseline.brier}, t = ${test.t})`,
);
console.log(`Calibrated to within 3 points of bias: ${calibrated ? 'yes' : 'no'} (${model.bias})`);
console.log(
  beatsBaseline && calibrated
    ? 'PASSES. Record the numbers in docs/specs/player-performance.md and switch it on.'
    : 'DOES NOT PASS as configured. The statistic stays unpublished, and the docs say why.',
);

// --- would the measured dispersion fix it? ------------------------------------
if (report.dispersion !== null && report.dispersion > 1.05) {
  const fitted = backtestPlayerStat(all, config, { dispersion: report.dispersion });
  const fittedTest = pairedTest(fitted.cases);

  console.log(`\n=== same run with dispersion ${report.dispersion} applied ===`);
  table('model', fitted.model);
  table('baseline', fitted.baseline);
  console.log(
    `  paired brier difference ${fittedTest.delta} over ${fittedTest.n} starts, t = ${fittedTest.t}`,
  );
  console.log('\n  Calibration:');
  for (const band of fitted.model.bands) {
    console.log(
      `    ${(band.from * 100).toFixed(0)}-${(band.to * 100).toFixed(0)}%  n=${String(band.count).padStart(5)}` +
        `  says ${(band.predicted * 100).toFixed(1)}%  happened ${(band.actual * 100).toFixed(1)}%`,
    );
  }

  const fittedBeats =
    fittedTest.delta !== null && fittedTest.delta < 0 && fittedTest.t !== null && fittedTest.t <= -2;
  const fittedCalibrated = fitted.model.bias !== null && Math.abs(fitted.model.bias) <= 0.03;
  console.log(
    `\n  verdict with dispersion: ${fittedBeats && fittedCalibrated ? 'PASSES' : 'DOES NOT PASS'}` +
      ` (bias ${fitted.model.bias}, t = ${fittedTest.t})`,
  );

  /*
   * Swept rather than taken on faith.
   *
   * The measured ratio is within-player, so unlike baseball's scoring figure it
   * does not already mix in how much pitchers differ from one another — which is
   * the double-count that made the raw number wrong there. But a within-player
   * variance still contains real variation in a pitcher's *expected* strikeouts
   * between starts, some of which the recency weighting already carries, so the
   * measurement is an upper bound on what should be applied. The sweep says
   * where bias actually crosses zero.
   */
  console.log('\n  sweep — bias should cross zero where the width is right:');
  for (const value of [1, 1.08, 1.16, 1.25, 1.35, 1.5]) {
    const run = backtestPlayerStat(all, config, { dispersion: value });
    const swept = pairedTest(run.cases);
    console.log(
      `    dispersion ${String(value).padEnd(5)} bias ${String(run.model.bias).padStart(8)}` +
        `  brier ${run.model.brier}  log loss ${run.model.log_loss}  t ${swept.t}`,
    );
  }
}
