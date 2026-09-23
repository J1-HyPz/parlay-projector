/**
 * Reading what a player did, against payloads the provider actually sent.
 *
 * Every fixture here is a real response, saved with a note of what was trimmed
 * out of it. That matters for what these tests may assert: repeated athletes
 * were cut to a handful per group, so a **count** in a fixture is not the count
 * the live response carried and is never asserted as one. Shape is.
 *
 * Four of these exist because the code asserted something about the provider
 * that turned out to be false. Each keeps a real payload behind the correction
 * so the same assumption cannot come back by reasoning.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  normaliseBoxscore,
  splitStatColumn,
} from '../lib/providers/espn/boxscore.ts';
import type { RawBoxscoreResponse } from '../lib/providers/espn/boxscore.ts';
import { normaliseGamelog } from '../lib/providers/espn/gamelog.ts';
import type { RawGamelogResponse } from '../lib/providers/espn/gamelog.ts';
import { parseInnings } from '../lib/projections/pitchers.ts';
import { scoreboardDates } from '../lib/providers/espn/pitchers.ts';

function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/espn/${name}.json`, import.meta.url), 'utf8'),
  ) as T;
}

const boxscore = (name: string) => normaliseBoxscore(fixture<RawBoxscoreResponse>(name));

// ---------------------------------------------------------------------------
// Composite columns
// ---------------------------------------------------------------------------

describe('splitting a column that carries two statistics', () => {
  it('splits on a slash', () => {
    assert.deepEqual(splitStatColumn('completions/passingAttempts', '23/28'), [
      ['completions', '23'],
      ['passingAttempts', '28'],
    ]);
  });

  it('splits on a hyphen', () => {
    assert.deepEqual(splitStatColumn('sacks-sackYardsLost', '4-23'), [
      ['sacks', '4'],
      ['sackYardsLost', '23'],
    ]);
  });

  it('splits baseball innings on the dot', () => {
    /*
     * The one that was missing. `"6.1"` is six innings and one out, so read as
     * an ordinary decimal every fractional start is understated and any rate
     * built on it overstated — which is the error `parseInnings` exists to
     * prevent, and it had been reintroduced here.
     */
    assert.deepEqual(splitStatColumn('fullInnings.partInnings', '6.1'), [
      ['fullInnings', '6'],
      ['partInnings', '1'],
    ]);
  });

  it('leaves a single statistic alone', () => {
    assert.deepEqual(splitStatColumn('passingYards', '216'), [['passingYards', '216']]);
  });

  it('leaves a pair alone when the halves do not correspond', () => {
    // Two names and three values is not a pair, and pairing them up by
    // guesswork would attach a number to the wrong statistic.
    assert.deepEqual(splitStatColumn('a-b', '1-2-3'), [['a-b', '1-2-3']]);
  });
});

// ---------------------------------------------------------------------------
// The real payloads
// ---------------------------------------------------------------------------

describe('a baseball box score', () => {
  const lines = boxscore('boxscore-mlb');

  it('decomposes a pitcher’s innings into whole innings and outs', () => {
    const pitcher = lines.find((line) => 'fullInnings' in line.stats);
    assert.ok(pitcher, 'the fixture carries at least one pitching line');

    // Both halves present and whole, which is what makes them combinable.
    assert.ok(Number.isInteger(pitcher.stats.fullInnings));
    assert.ok(Number.isInteger(pitcher.stats.partInnings));
    assert.ok(pitcher.stats.partInnings <= 2, 'there is no such thing as three outs over');
  });

  it('agrees with parseInnings about what the innings are', () => {
    // The two paths must not disagree: one feeds the team model's pitcher rate,
    // the other a player market on the same person.
    const pitcher = lines.find((line) => line.stats.fullInnings === 6);
    if (!pitcher) return;

    const combined = pitcher.stats.fullInnings + pitcher.stats.partInnings / 3;
    assert.equal(combined, parseInnings('6.1'));
    assert.notEqual(combined, 6.1, 'and emphatically not the decimal reading');
  });

  it('reads the position from the athlete’s line, where baseball puts it', () => {
    assert.ok(
      lines.every((line) => line.position !== null),
      'every baseball line carries a position',
    );
  });

  it('carries strikeouts, which is what the pilot market is about', () => {
    assert.ok(lines.some((line) => typeof line.stats.strikeouts === 'number'));
  });
});

describe('an American football box score', () => {
  it('has no position for anybody, and says so rather than inventing one', () => {
    /*
     * Zero of 84 NFL and zero of 81 NCAAF athlete lines carry a position or a
     * `shortName` in the live responses. The code read both and had been
     * silently returning null for the only sport it was implemented for.
     */
    assert.ok(boxscore('boxscore-nfl').every((line) => line.position === null));
  });

  it('still reads every player and their yardage', () => {
    const lines = boxscore('boxscore-nfl');
    assert.ok(lines.length > 10);
    assert.ok(lines.some((line) => typeof line.stats.passingYards === 'number'));
    assert.ok(lines.some((line) => typeof line.stats.receivingYards === 'number'));
    // Split out of `completions/passingAttempts`, so a composite reached through.
    assert.ok(lines.some((line) => typeof line.stats.completions === 'number'));
  });

  it('merges a player who appears in more than one group', () => {
    // A quarterback who also ran is one person, not two rows.
    const ids = boxscore('boxscore-nfl').map((line) => line.athleteId);
    assert.equal(ids.length, new Set(ids).size);
  });
});

describe('a college football box score', () => {
  it('refuses the team pseudo-athlete the provider injects', () => {
    /*
     * NCAA football adds `{"id":"-7619","displayName":" Team"}` carrying the
     * side's own totals. Admitted, it becomes a player who out-produces every
     * real one — and it is one leading space away from looking legitimate, so
     * the negative id is what it is rejected on.
     */
    const raw = fixture<RawBoxscoreResponse>('boxscore-ncaaf');
    const present = (raw.boxscore?.players ?? []).some((team) =>
      (team.statistics ?? []).some((group) =>
        (group.athletes ?? []).some((line) => {
          const id = line.athlete?.id;
          return typeof id === 'string' && id.startsWith('-');
        }),
      ),
    );
    assert.ok(present, 'the fixture really does contain one');

    const lines = boxscore('boxscore-ncaaf');
    assert.ok(lines.every((line) => !line.athleteId.startsWith('-')));
    assert.ok(lines.every((line) => line.name.trim() !== 'Team'));
  });
});

describe('a football (soccer) box score', () => {
  it('carries no per-player statistics at this path, and yields none', () => {
    /*
     * `boxscore.players` is absent for every football competition — the data
     * lives in `rosters[].roster[].stats` in a different shape entirely. Until
     * that second normaliser exists, the honest output is nothing at all rather
     * than a partial read of the team totals that *are* there.
     */
    const raw = fixture<RawBoxscoreResponse>('boxscore-soccer-epl');
    assert.ok(!raw.boxscore?.players);
    assert.deepEqual(boxscore('boxscore-soccer-epl'), []);
  });
});

// ---------------------------------------------------------------------------
// The gamelog
// ---------------------------------------------------------------------------

describe('an athlete gamelog', () => {
  const current = normaliseGamelog(fixture<RawGamelogResponse>('gamelog-nfl-current'));
  const past = normaliseGamelog(fixture<RawGamelogResponse>('gamelog-nfl-season2025'));

  it('serves a past season at all, which the code used to deny', () => {
    /*
     * The claim replaced was "asked for an earlier season it returns nothing".
     * A count is not asserted — the fixtures are trimmed — but a past-season
     * request returning *more* appearances than the current one in September is
     * the shape that disproves the claim.
     */
    assert.ok(past.rows.length > 0);
    assert.ok(past.rows.length > current.rows.length);
  });

  it('dates every appearance and puts the newest first', () => {
    assert.ok(past.rows.every((row) => Number.isFinite(row.date) && row.date > 0));
    for (let i = 1; i < past.rows.length; i += 1) {
      assert.ok(past.rows[i - 1].date >= past.rows[i].date);
    }
  });

  it('ties each appearance to its fixture', () => {
    assert.ok(past.rows.every((row) => row.eventId.length > 0));
    const ids = past.rows.map((row) => row.eventId);
    assert.equal(ids.length, new Set(ids).size);
  });

  it('names the statistics rather than leaving them positional', () => {
    const row = past.rows[0];
    assert.ok('passingYards' in row.stats);
    assert.ok('passingTouchdowns' in row.stats);
  });

  it('keeps the provider’s own notation instead of parsing it', () => {
    /*
     * Deliberate: a gamelog carries innings as "6.1", time on ice as "18:14"
     * and completions as "23/28" — three notations that all survive `Number()`
     * and none of which it reads correctly. The caller knows which statistic it
     * asked for; this module does not.
     */
    assert.ok(Object.values(past.rows[0].stats).every((value) => typeof value === 'string'));
  });

  it('reports which seasons this athlete has, from the payload itself', () => {
    // Per athlete, not per league — a rookie offers one where a veteran offers
    // ten — so it is the only honest basis for deciding how far back to ask.
    assert.ok(past.seasons.length >= 2);
    assert.deepEqual([...past.seasons].sort((a, b) => b - a), past.seasons);
    assert.ok(past.seasons.every((year) => Number.isInteger(year) && year > 2000));
  });

  it('drops an appearance with no date rather than placing it', () => {
    const withoutDate: RawGamelogResponse = {
      names: ['strikeouts'],
      events: {},
      seasonTypes: [{ categories: [{ events: [{ eventId: '1', stats: ['7'] }] }] }],
    };
    // Every point-in-time rate filters on the date, so a row without one could
    // only be counted by pretending to know when it happened.
    assert.deepEqual(normaliseGamelog(withoutDate).rows, []);
  });
});

// ---------------------------------------------------------------------------
// Which scoreboard lists a fixture
// ---------------------------------------------------------------------------

describe('finding the scoreboard a baseball fixture is on', () => {
  it('asks for the day before as well as the UTC day', () => {
    /*
     * The scoreboard is keyed by US date. Event 401817044 starts at
     * 2026-09-23T01:40Z and is listed under the **22nd**, because 01:40 UTC is
     * half past nine the previous evening in the east. Asking only for the UTC
     * date found no announced starter for nearly every night game — which is
     * most of a baseball card, and had been true of the team model's pitcher
     * substitution since it shipped.
     */
    assert.deepEqual(scoreboardDates('2026-09-23T01:40:00.000Z'), ['20260923', '20260922']);
  });

  it('covers an afternoon fixture too, at no extra cost worth avoiding', () => {
    assert.deepEqual(scoreboardDates('2026-09-23T17:10:00.000Z'), ['20260923', '20260922']);
  });

  it('has nothing to ask for without a kick-off', () => {
    assert.deepEqual(scoreboardDates(null), []);
    assert.deepEqual(scoreboardDates('not a date'), []);
  });
});
