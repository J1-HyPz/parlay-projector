/**
 * Fill the long-run history archive.
 *
 * Run by hand, not on a schedule and not over HTTP. A backfill walks several
 * years of fixtures for up to twenty competitions, which is far too heavy to
 * sit on the path of a page load and has no business being triggerable by a
 * request. Once a season is on disk it is never re-fetched, so the second run
 * of this costs almost nothing.
 *
 *   pnpm history:backfill                     every competition, five seasons
 *   pnpm history:backfill nfl,epl             just these
 *   SEASONS=3 pnpm history:backfill           a shallower archive
 *
 * Writes to `DATA_DIR/history/<league>/<season>.json`. In production that is
 * the mounted dataset, so the archive survives a redeploy — which is the whole
 * reason it is on disk rather than in the process cache.
 */

import { DEFAULT_SEASONS, archiveLeague } from '../lib/history/archive.ts';
import { LEAGUES, findLeague } from '../lib/leagues/registry.ts';
import { todayInAppTimezone } from '../lib/config.ts';
import type { League } from '../lib/leagues/registry.ts';

function requested(): League[] {
  const argument = process.argv[2];
  if (!argument) return [...LEAGUES];

  const leagues: League[] = [];
  for (const id of argument.split(',').map((entry) => entry.trim())) {
    const league = findLeague(id);
    if (!league) {
      console.error(`  unknown competition: ${id}`);
      continue;
    }
    leagues.push(league);
  }
  return leagues;
}

async function main(): Promise<void> {
  const today = todayInAppTimezone();
  const seasons = Number.parseInt(process.env.SEASONS ?? '', 10) || DEFAULT_SEASONS;
  const leagues = requested();

  if (leagues.length === 0) {
    console.error('Nothing to do.');
    process.exitCode = 1;
    return;
  }

  console.log(`Archiving ${leagues.length} competition(s), ${seasons} season(s) each, as at ${today}.\n`);

  let fetched = 0;
  let games = 0;
  let failed = 0;
  let empty = 0;

  for (const league of leagues) {
    const outcomes = await archiveLeague(league, today, seasons);
    // Nothing at all is a real answer for a competition younger than the
    // window — the AFLE and EFA were founded this year — so it is reported
    // rather than treated as a failure.
    const label = outcomes.length === 0 ? 'no completed seasons in range' : '';
    console.log(`${league.label} ${label}`);

    for (const outcome of outcomes) {
      games += outcome.games;
      if (outcome.state === 'written') fetched += 1;
      if (outcome.state === 'failed') failed += 1;
      // Not written, and not an error either, but emphatically not a success —
      // the run must not read as clean when a season came back with nothing.
      if (outcome.state === 'empty') empty += 1;

      const state =
        outcome.state === 'failed'
          ? `failed — ${outcome.error}`
          : outcome.state === 'written'
            ? 'fetched'
            : outcome.state === 'stored'
              ? 'already archived'
              : 'came back empty — not written, will retry';
      console.log(`  ${outcome.season}  ${String(outcome.games).padStart(5)} games  ${state}`);
    }
  }

  console.log(
    `\n${fetched} season(s) fetched, ${games} games archived, ${empty} empty, ${failed} failed.`,
  );
  // A partial archive is usable, so a provider failure is reported rather than
  // made fatal — but it must not pass silently in CI or a deploy step either.
  if (failed > 0) process.exitCode = 1;
}

await main();
