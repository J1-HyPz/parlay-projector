/**
 * A player's record, and what may be concluded from it.
 *
 * The application refused to produce player markets for a stated reason: no
 * player statistics, and nothing to verify against. The first half of that is
 * no longer true — a finished game's box score carries every player's line —
 * so these cover the two places that refusal could come back as a different
 * kind of dishonesty.
 *
 * **An absent statistic is not a zero.** A quarterback with no rushing row did
 * not rush for no yards; he has no rushing row. Averaging the difference in
 * would drag every rate towards zero for everyone who sat a game out.
 *
 * **A short record must not read as a confident one.** Three similar games
 * measure a spread near zero, and a normal distribution that narrow returns a
 * near-certainty. That is exactly the small-sample overconfidence the team
 * model was recalibrated to remove, and it is guarded at the source here.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  normaliseBoxscore,
  splitStatColumn,
} from '../lib/providers/espn/boxscore.ts';
import {
  NFL_PLAYER_STATS,
  buildPlayerRatings,
  playerDataQuality,
  playerQualityReasons,
  probabilityOver,
} from '../lib/projections/player-model.ts';
import { poissonAtLeast, poissonCdf, poissonPmf } from '../lib/projections/math.ts';
import { evidenceFor, outcomeOf, settle } from '../lib/projections/settlement.ts';
import type { PlayerGame } from '../lib/players/history';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-21T00:00:00Z');

function statOf(key: string) {
  return NFL_PLAYER_STATS.find((s) => s.key === key)!;
}

// ---------------------------------------------------------------------------
// Reading a box score
// ---------------------------------------------------------------------------

describe('columns that carry two statistics', () => {
  it('splits a pair the provider joined', () => {
    // `completions/passingAttempts` arrives as "23/28".
    assert.deepEqual(splitStatColumn('completions/passingAttempts', '23/28'), [
      ['completions', '23'],
      ['passingAttempts', '28'],
    ]);
    assert.deepEqual(splitStatColumn('sacks-sackYardsLost', '4-23'), [
      ['sacks', '4'],
      ['sackYardsLost', '23'],
    ]);
  });

  it('leaves a single statistic alone', () => {
    assert.deepEqual(splitStatColumn('passingYards', '216'), [['passingYards', '216']]);
  });

  it('refuses to pair up a mismatch rather than guessing', () => {
    // Two names and one value is not a pair; splitting it would invent one.
    assert.deepEqual(splitStatColumn('a/b', '7'), [['a/b', '7']]);
  });
});

describe('a game box score', () => {
  const payload = {
    boxscore: {
      players: [
        {
          team: { id: '27' },
          statistics: [
            {
              name: 'passing',
              keys: ['completions/passingAttempts', 'passingYards', 'passingTouchdowns'],
              athletes: [
                {
                  athlete: { id: '1', displayName: 'A Passer' },
                  stats: ['23/28', '216', '2'],
                },
              ],
            },
            {
              name: 'rushing',
              keys: ['rushingAttempts', 'rushingYards', 'rushingTouchdowns'],
              athletes: [
                // The same player again: a passer who also ran.
                { athlete: { id: '1', displayName: 'A Passer' }, stats: ['5', '30', '1'] },
                { athlete: { id: '2', displayName: 'A Runner' }, stats: ['8', '45', '0'] },
              ],
            },
            {
              name: 'receiving',
              keys: ['receptions', 'receivingYards'],
              athletes: [
                // A column the provider had no value for.
                { athlete: { id: '3', displayName: 'A Receiver' }, stats: ['5', '-'] },
              ],
            },
          ],
        },
      ],
    },
  };

  const lines = normaliseBoxscore(payload);
  const byId = new Map(lines.map((line) => [line.athleteId, line]));

  it('returns one row per player, not one per statistical group', () => {
    assert.equal(lines.length, 3);
  });

  it('merges a player who appears in several groups', () => {
    const passer = byId.get('1')!;
    assert.equal(passer.stats.passingYards, 216);
    assert.equal(passer.stats.rushingYards, 30);
    assert.equal(passer.stats.completions, 23);
    assert.equal(passer.stats.passingAttempts, 28);
  });

  it('omits a statistic the provider had no value for', () => {
    const receiver = byId.get('3')!;
    assert.equal(receiver.stats.receptions, 5);
    // Not zero. The provider wrote `-`, which is "no value", and a zero here
    // would be a number nobody recorded.
    assert.equal('receivingYards' in receiver.stats, false);
  });

  it('keeps the team, so a player who moved is attributed to the right one', () => {
    assert.equal(byId.get('2')!.teamId, '27');
  });
});

// ---------------------------------------------------------------------------
// Building a record
// ---------------------------------------------------------------------------

/** `values` newest first; a null is a game the player recorded nothing in. */
function gamesFor(key: string, values: readonly (number | null)[]): PlayerGame[] {
  return values.map((value, index) => ({
    athleteId: 'p1',
    name: 'A Player',
    teamId: '27',
    position: 'WR',
    gameId: `espn-nfl-${index}`,
    date: NOW - (index + 1) * 7 * DAY,
    stats: value === null ? {} : { [key]: value },
  }));
}

describe('a player record', () => {
  it('says nothing about a statistic with too short a sample', () => {
    const config = statOf('receiving_yards');
    const ratings = buildPlayerRatings(gamesFor('receivingYards', [70, 80, 90]));
    // Three games against a minimum of four. A player with no rated statistic
    // at all is dropped, so either the player is absent or the statistic is.
    assert.equal(ratings.players.get('p1')?.stats.get(config.key), undefined);
  });

  it('counts only the games the statistic was actually recorded in', () => {
    const ratings = buildPlayerRatings(
      gamesFor('receivingYards', [70, null, 80, null, 90, 100]),
    );
    const rating = ratings.players.get('p1')!.stats.get('receiving_yards')!;
    assert.equal(rating.games, 4, 'a game with no line is not a game with a zero');
    // A zero would have pulled this under 60.
    assert.ok(rating.mean > 70, `mean ${rating.mean} was dragged down by absent games`);
  });

  it('weights recent games more heavily than old ones', () => {
    const recent = buildPlayerRatings(gamesFor('receivingYards', [100, 100, 20, 20, 20, 20]));
    const older = buildPlayerRatings(gamesFor('receivingYards', [20, 20, 20, 20, 100, 100]));
    const a = recent.players.get('p1')!.stats.get('receiving_yards')!.mean;
    const b = older.players.get('p1')!.stats.get('receiving_yards')!.mean;
    assert.ok(a > b, `recent-heavy ${a} should exceed old-heavy ${b}`);
  });
});

describe('a short record does not become a confident one', () => {
  it('floors the spread when the measured one is implausibly narrow', () => {
    const config = statOf('receiving_yards');
    const ratings = buildPlayerRatings(gamesFor('receivingYards', [80, 80, 80, 80]));
    const rating = ratings.players.get('p1')!.stats.get('receiving_yards')!;

    assert.equal(rating.measuredSpread, 0, 'four identical games measure no spread');
    assert.ok(rating.spread >= config.minSpread * 80, `spread ${rating.spread} was not floored`);

    // The guard is the point: without it this is a certainty.
    const over = probabilityOver(rating, config, 60.5);
    assert.ok(over < 0.95, `four identical games should not price 60.5 at ${over}`);
  });

  it('says so, rather than only doing it quietly', () => {
    const config = statOf('receiving_yards');
    const ratings = buildPlayerRatings(gamesFor('receivingYards', [80, 80, 80, 80]));
    const profile = ratings.players.get('p1')!;
    const reasons = playerQualityReasons(
      profile,
      profile.stats.get('receiving_yards')!,
      config,
      NOW,
    );
    assert.ok(reasons.some((r) => r.includes('spread')), reasons.join(' | '));
  });
});

// ---------------------------------------------------------------------------
// The two distributions
// ---------------------------------------------------------------------------

describe('pricing a line', () => {
  it('prices a yardage line off the normal, centred on the mean', () => {
    const config = statOf('receiving_yards');
    const ratings = buildPlayerRatings(gamesFor('receivingYards', [60, 80, 40, 100, 70, 50]));
    const rating = ratings.players.get('p1')!.stats.get('receiving_yards')!;

    // A line at the mean is a coin toss, whatever the spread.
    const atMean = probabilityOver(rating, config, rating.mean);
    assert.ok(Math.abs(atMean - 0.5) < 0.02, `line at the mean priced ${atMean}`);

    // And it is monotonic: a higher line is never likelier.
    assert.ok(probabilityOver(rating, config, 100) < probabilityOver(rating, config, 40));
  });

  it('prices an anytime touchdown as one minus the chance of none', () => {
    const config = statOf('anytime_touchdown');
    const games = gamesFor('rushingTouchdowns', [1, 0, 1, 0, 1, 0, 1, 0]);
    const ratings = buildPlayerRatings(games);
    const rating = ratings.players.get('p1')!.stats.get('anytime_touchdown')!;

    const over = probabilityOver(rating, config, 0.5);
    const expected = 1 - Math.exp(-rating.mean);
    assert.ok(
      Math.abs(over - expected) < 0.005,
      `anytime ${over} should be 1 - e^-${rating.mean} = ${expected}`,
    );
  });

  it('reads an integer count line as "more than", never as a push', () => {
    const config = statOf('receptions');
    const ratings = buildPlayerRatings(gamesFor('receptions', [5, 5, 5, 5, 5, 5]));
    const rating = ratings.players.get('p1')!.stats.get('receptions')!;

    // Over 1 must mean two or more, which is strictly likelier than three or
    // more. A push has nobody to adjudicate it here, so it is not offered.
    assert.ok(probabilityOver(rating, config, 1) > probabilityOver(rating, config, 2));
  });

  it('does not turn "never happened" into "certain to happen"', () => {
    /*
     * The worst bug this feature could have had, and it had it.
     *
     * `poissonPmf` treated a rate of zero as a missing distribution and
     * returned 0 for every k, so the cumulative function was 0 and "at least
     * one" came out as 1. A receiver with eight blank games was priced at
     * 99.5% to score — a certainty derived from it never once happening.
     */
    const config = statOf('anytime_touchdown');
    const ratings = buildPlayerRatings(gamesFor('rushingTouchdowns', [0, 0, 0, 0, 0, 0, 0, 0]));
    const rating = ratings.players.get('p1')!.stats.get('anytime_touchdown')!;

    assert.equal(rating.mean, 0, 'eight blank games average zero');
    const over = probabilityOver(rating, config, 0.5);
    assert.ok(over < 0.15, `a player who has never scored was priced at ${over}`);
    // Nor the opposite overconfidence: eight games cannot rule it out either.
    assert.ok(over > 0, 'eight games cannot establish that it is impossible');
  });

  it('prices a rare event lower the longer it has not happened', () => {
    const config = statOf('anytime_touchdown');
    const short = buildPlayerRatings(gamesFor('rushingTouchdowns', [0, 0, 0, 0, 0, 0]));
    const long = buildPlayerRatings(
      gamesFor('rushingTouchdowns', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    );
    const a = probabilityOver(short.players.get('p1')!.stats.get(config.key)!, config, 0.5);
    const b = probabilityOver(long.players.get('p1')!.stats.get(config.key)!, config, 0.5);
    assert.ok(b < a, `twelve blank games (${b}) should price below six (${a})`);
  });

  it('never returns a certainty', () => {
    const config = statOf('receiving_yards');
    const ratings = buildPlayerRatings(gamesFor('receivingYards', [200, 210, 190, 205]));
    const rating = ratings.players.get('p1')!.stats.get('receiving_yards')!;
    const over = probabilityOver(rating, config, 1);
    assert.ok(over < 1, 'a probability of exactly 1 is not an estimate');
  });
});

// ---------------------------------------------------------------------------
// How much it rests on
// ---------------------------------------------------------------------------

describe('how far a player record can be trusted', () => {
  const config = statOf('receiving_yards');

  it('grows with the sample', () => {
    const few = buildPlayerRatings(gamesFor('receivingYards', [60, 70, 80, 90]));
    const many = buildPlayerRatings(
      gamesFor('receivingYards', [60, 70, 80, 90, 65, 75, 85, 95, 70, 80]),
    );
    const a = few.players.get('p1')!;
    const b = many.players.get('p1')!;
    assert.ok(
      playerDataQuality(b, b.stats.get(config.key)!, config, NOW) >
        playerDataQuality(a, a.stats.get(config.key)!, config, NOW),
    );
  });

  it('discounts a player who has not been seen for a month', () => {
    const fresh = buildPlayerRatings(gamesFor('receivingYards', [60, 70, 80, 90, 65, 75]));
    const stale = buildPlayerRatings(
      gamesFor('receivingYards', [60, 70, 80, 90, 65, 75]).map((game) => ({
        ...game,
        date: game.date - 60 * DAY,
      })),
    );

    const a = fresh.players.get('p1')!;
    const b = stale.players.get('p1')!;
    const qa = playerDataQuality(a, a.stats.get(config.key)!, config, NOW);
    const qb = playerDataQuality(b, b.stats.get(config.key)!, config, NOW);

    assert.ok(qb < qa, `a stale record scored ${qb} against a fresh ${qa}`);
  });

  it('names the opponent it cannot see', () => {
    // The largest thing missing from this model, said every time rather than
    // buried in documentation.
    const ratings = buildPlayerRatings(gamesFor('receivingYards', [60, 70, 80, 90]));
    const profile = ratings.players.get('p1')!;
    const reasons = playerQualityReasons(profile, profile.stats.get(config.key)!, config, NOW);
    assert.ok(reasons.some((r) => r.includes('opponent')), reasons.join(' | '));
  });
});

// ---------------------------------------------------------------------------
// The distribution underneath
// ---------------------------------------------------------------------------

describe('a Poisson rate of zero', () => {
  it('puts all of its mass on zero, rather than none anywhere', () => {
    // The mathematically correct degenerate case, and the one the helper got
    // wrong: it guarded `lambda > 0` and returned 0 for every k, which made
    // the cumulative function 0 and "at least one" a certainty.
    assert.equal(poissonPmf(0, 0), 1);
    assert.equal(poissonPmf(1, 0), 0);
    assert.equal(poissonCdf(0, 0), 1);
    assert.equal(poissonAtLeast(1, 0), 0);
  });

  it('still behaves for an ordinary rate', () => {
    // 1 - e^-1, to four places.
    assert.ok(Math.abs(poissonAtLeast(1, 1) - 0.6321) < 0.001);
  });
});

// ---------------------------------------------------------------------------
// Settling a player leg
// ---------------------------------------------------------------------------

describe('settling a player market', () => {
  const rule = {
    kind: 'player_stat' as const,
    athleteId: '1',
    player: 'A Player',
    stat: 'receiving_yards',
    statLabel: 'Receiving yards',
    direction: 'over' as const,
    line: 59.5,
  };

  const finished = (players?: Record<string, Record<string, number>>) => ({
    home: 24,
    away: 17,
    status: 'finished' as const,
    ...(players ? { players } : {}),
  });

  it('wins and loses on the number', () => {
    assert.equal(settle(rule, finished({ '1': { receiving_yards: 70 } })), 'won');
    assert.equal(settle(rule, finished({ '1': { receiving_yards: 40 } })), 'lost');
  });

  it('reads the other side of the same line', () => {
    const under = { ...rule, direction: 'under' as const };
    assert.equal(settle(under, finished({ '1': { receiving_yards: 40 } })), 'won');
    assert.equal(settle(under, finished({ '1': { receiving_yards: 70 } })), 'lost');
  });

  it('voids when the player did not take part', () => {
    /*
     * The decision that matters most here. A scratch, an inactive list or a
     * benching means the bet was never tested — settling it as a loss would
     * count the projection wrong for something it never claimed.
     */
    assert.equal(settle(rule, finished({ '2': { receiving_yards: 80 } })), 'void');
  });

  it('keeps an absence and a genuine zero apart', () => {
    // Nought yards is a result and loses; no line at all is not.
    assert.equal(settle(rule, finished({ '1': { receiving_yards: 0 } })), 'lost');
    assert.equal(settle(rule, finished({ '1': {} })), 'void');
  });

  it('pushes on a whole-number line that lands level', () => {
    const whole = { ...rule, line: 60 };
    assert.equal(settle(whole, finished({ '1': { receiving_yards: 60 } })), 'push');
  });

  it('will not settle before the box score has been read', () => {
    // `players` absent is "not looked up", and settling on it would void every
    // player leg the moment its game ended.
    assert.equal(evidenceFor(rule, { status: 'finished', home: 24, away: 17 }), null);
    assert.ok(
      evidenceFor(rule, {
        status: 'finished',
        home: 24,
        away: 17,
        players: { '1': { receiving_yards: 70 } },
      }),
    );
  });

  it('records the number it was judged against', () => {
    const { actual, text } = outcomeOf(rule, finished({ '1': { receiving_yards: 70 } }));
    assert.equal(actual.player_value, 70);
    assert.match(text, /70/);

    // And says plainly when there was none, rather than leaving it absent.
    const missing = outcomeOf(rule, finished({ '2': {} }));
    assert.equal(missing.actual.player_value, null);
    assert.match(missing.text, /did not record/);
  });
});
