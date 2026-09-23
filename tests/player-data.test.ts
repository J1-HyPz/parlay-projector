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
import { MLB_PITCHER_STATS } from '../lib/projections/player-model.ts';
import { evidenceFor, settle } from '../lib/projections/settlement.ts';
import type { SettlementRule } from '../lib/markets/types.ts';

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

// ---------------------------------------------------------------------------
// Settling one, against a real box score
// ---------------------------------------------------------------------------

describe('settling a pitcher market from the game it was about', () => {
  /*
   * The gap that let a whole-pipeline break through. Every unit test of
   * `settle` handed it a `players` map already keyed by the model's canonical
   * statistic — so the translation from the provider's names was never
   * exercised, and there was none. A published prediction would have found no
   * such statistic and **voided**, for a game that was played normally.
   *
   * This starts from a real payload and ends at a settled result.
   */
  const lines = boxscore('boxscore-mlb');

  /** What the settlement job builds, through the model's own definitions. */
  function playersFrom(): Record<string, Record<string, number>> {
    const players: Record<string, Record<string, number>> = {};
    for (const line of lines) {
      const stats: Record<string, number> = {};
      for (const config of MLB_PITCHER_STATS) {
        const value = config.from(line.stats);
        if (value !== null) stats[config.key] = value;
      }
      if (Object.keys(stats).length > 0) players[line.athleteId] = stats;
    }
    return players;
  }

  const players = playersFrom();
  const pitcher = lines.find((line) => line.stats['pitching.strikeouts'] !== undefined);

  it('reads the pitcher’s strikeouts under the name the rule froze', () => {
    assert.ok(pitcher, 'the fixture carries a pitching line');
    assert.equal(
      players[pitcher.athleteId]?.pitcher_strikeouts,
      pitcher.stats['pitching.strikeouts'],
    );
  });

  it('takes the pitching strikeouts, never the batting ones', () => {
    /*
     * Baseball writes `strikeouts` in both groups meaning opposite things:
     * batters a pitcher struck out, and times a batter struck out. A position
     * player finishing a blowout on the mound appears in both, and the bare
     * name would resolve to whichever was read first.
     */
    const bothWays = {
      'pitching.strikeouts': 7,
      strikeouts: 2,
      'batting.strikeouts': 2,
    };
    assert.equal(MLB_PITCHER_STATS[0].from(bothWays), 7);
  });

  it('settles a won bet, a lost bet and a push from the same line', () => {
    assert.ok(pitcher);
    const recorded = pitcher.stats['pitching.strikeouts'];
    const rule = (line: number, direction: 'over' | 'under'): SettlementRule => ({
      kind: 'player_stat',
      athleteId: pitcher.athleteId,
      player: pitcher.name,
      stat: 'pitcher_strikeouts',
      statLabel: 'Strikeouts',
      direction,
      line,
    });

    const final = { home: 3, away: 1, status: 'finished' as const, players };

    assert.equal(settle(rule(recorded - 0.5, 'over'), final), 'won');
    assert.equal(settle(rule(recorded + 0.5, 'over'), final), 'lost');
    // A whole line can land level, and a push is a push.
    assert.equal(settle(rule(recorded, 'over'), final), 'push');
  });

  it('voids for a pitcher who did not take part', () => {
    // The commonest outcome a player market has that no other market does, and
    // the reason an unrecorded statistic is never written as a zero.
    const absent: SettlementRule = {
      kind: 'player_stat',
      athleteId: 'someone-who-did-not-play',
      player: 'Absent Pitcher',
      stat: 'pitcher_strikeouts',
      statLabel: 'Strikeouts',
      direction: 'over',
      line: 5.5,
    };
    assert.equal(settle(absent, { home: 3, away: 1, status: 'finished', players }), 'void');
  });

  it('leaves the prediction open when the box score has not been read', () => {
    // Absent is "not looked up", not "he did not play". Settling on the
    // difference would void every player leg the moment its game ended.
    const rule: SettlementRule = {
      kind: 'player_stat',
      athleteId: pitcher?.athleteId ?? '1',
      player: 'A Pitcher',
      stat: 'pitcher_strikeouts',
      statLabel: 'Strikeouts',
      direction: 'over',
      line: 5.5,
    };
    assert.equal(evidenceFor(rule, { status: 'finished', home: 3, away: 1 }), null);
  });
});
