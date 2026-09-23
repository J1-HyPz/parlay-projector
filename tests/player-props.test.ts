/**
 * Reading player prices, and refusing to guess whose they are.
 *
 * Two failures here would be invisible downstream. A quote attached to the
 * wrong player settles against a record the model never had an opinion about,
 * and nothing later could detect it. And an "anytime touchdown" read as a
 * different shape of market from an over/under would settle by a second rule
 * that has to be kept in step with the first — so it is deliberately read as
 * the same rule with a line of 0.5.
 *
 * Pure, and the parsing is exported for that reason: none of this judgement
 * should only ever run against a live key.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bestPlayerQuotes,
  playerQuotesFrom,
} from '../lib/odds/player-props.ts';
import {
  buildPlayerRatings,
  normalisePlayerName,
  playerResolver,
} from '../lib/projections/player-model.ts';
import type { PlayerGame } from '../lib/players/history';

const AT = '2026-09-21T12:00:00.000Z';

/** Everybody resolves to their own name, for the parsing tests. */
const identity = (name: string) => name;

function book(markets: unknown[]) {
  return { key: 'skybet', title: 'Sky Bet', markets } as never;
}

describe('reading a player price', () => {
  it('takes the player from the description, not the outcome name', () => {
    // The provider puts "Over"/"Under" in `name` and the person in
    // `description`. Reading `name` as the player would price nobody.
    const quotes = playerQuotesFrom(
      book([
        {
          key: 'player_reception_yds',
          outcomes: [{ name: 'Over', description: 'Puka Nacua', point: 59.5, price: 1.9 }],
        },
      ]),
      AT,
      identity,
    );

    assert.equal(quotes.length, 1);
    const rule = quotes[0].settlement;
    assert.equal(rule.kind, 'player_stat');
    if (rule.kind !== 'player_stat') return;
    assert.equal(rule.player, 'Puka Nacua');
    assert.equal(rule.stat, 'receiving_yards');
    assert.equal(rule.direction, 'over');
    assert.equal(rule.line, 59.5);
  });

  it('reads both sides of the same line', () => {
    const quotes = playerQuotesFrom(
      book([
        {
          key: 'player_receptions',
          outcomes: [
            { name: 'Over', description: 'A Player', point: 4.5, price: 1.8 },
            { name: 'Under', description: 'A Player', point: 4.5, price: 2.0 },
          ],
        },
      ]),
      AT,
      identity,
    );
    assert.deepEqual(
      quotes.map((q) => (q.settlement.kind === 'player_stat' ? q.settlement.direction : null)),
      ['over', 'under'],
    );
  });

  it('reads a yes/no market as the same rule at half a unit', () => {
    /*
     * An anytime touchdown quotes Yes/No against no number. Treating it as a
     * separate kind of settlement would mean two rules to keep in step; it is
     * "more than nought", so it becomes a line of 0.5 and the ordinary rule.
     */
    const quotes = playerQuotesFrom(
      book([
        {
          key: 'player_anytime_td',
          outcomes: [
            { name: 'Yes', description: 'A Scorer', price: 2.5 },
            { name: 'No', description: 'A Scorer', price: 1.5 },
          ],
        },
      ]),
      AT,
      identity,
    );

    const yes = quotes.find(
      (q) => q.settlement.kind === 'player_stat' && q.settlement.direction === 'over',
    );
    assert.ok(yes);
    if (yes.settlement.kind !== 'player_stat') return;
    assert.equal(yes.settlement.line, 0.5);
    assert.equal(yes.settlement.stat, 'anytime_touchdown');
  });

  it('ignores a market this model cannot price', () => {
    // Having a price is not having an opinion. A market the model says
    // nothing about must not appear as one it has a view on.
    const quotes = playerQuotesFrom(
      book([
        {
          key: 'player_field_goals',
          outcomes: [{ name: 'Over', description: 'A Kicker', point: 1.5, price: 1.9 }],
        },
      ]),
      AT,
      identity,
    );
    assert.equal(quotes.length, 0);
  });

  it('drops a quote whose player cannot be resolved', () => {
    const quotes = playerQuotesFrom(
      book([
        {
          key: 'player_rush_yds',
          outcomes: [{ name: 'Over', description: 'Nobody At All', point: 40.5, price: 1.9 }],
        },
      ]),
      AT,
      () => null,
    );
    assert.equal(quotes.length, 0, 'an unresolvable player is dropped, not guessed at');
  });

  it('takes the best price across books for the same bet', () => {
    const event = {
      bookmakers: [
        book([
          {
            key: 'player_rush_yds',
            outcomes: [{ name: 'Over', description: 'A Runner', point: 59.5, price: 1.8 }],
          },
        ]),
        {
          key: 'paddypower',
          title: 'Paddy Power',
          markets: [
            {
              key: 'player_rush_yds',
              outcomes: [{ name: 'Over', description: 'A Runner', point: 59.5, price: 2.1 }],
            },
          ],
        },
      ],
    } as never;

    const quotes = bestPlayerQuotes(event, AT, identity);
    assert.equal(quotes.length, 1);
    assert.equal(quotes[0].price.decimal, 2.1);
    assert.equal(quotes[0].source, 'Paddy Power', 'the book that gave the price travels with it');
  });

  it('keeps different lines on the same player apart', () => {
    const event = {
      bookmakers: [
        book([
          {
            key: 'player_rush_yds',
            outcomes: [
              { name: 'Over', description: 'A Runner', point: 49.5, price: 1.6 },
              { name: 'Over', description: 'A Runner', point: 59.5, price: 1.9 },
            ],
          },
        ]),
      ],
    } as never;

    // Two lines are two bets, and collapsing them would price one as the other.
    assert.equal(bestPlayerQuotes(event, AT, identity).length, 2);
  });
});

// ---------------------------------------------------------------------------
// Whose price is it
// ---------------------------------------------------------------------------

describe('matching a name to a player', () => {
  it('ignores the differences that are not about identity', () => {
    assert.equal(normalisePlayerName('Tyrone Tracy Jr.'), normalisePlayerName('Tyrone Tracy'));
    assert.equal(normalisePlayerName('A.J. Brown'), normalisePlayerName('AJ Brown'));
    assert.equal(normalisePlayerName('  Puka   Nacua '), 'puka nacua');
  });

  function ratingsFor(names: readonly { id: string; name: string }[]) {
    const lines: PlayerGame[] = names.flatMap(({ id, name }) =>
      Array.from({ length: 6 }, (_, index) => ({
        athleteId: id,
        name,
        teamId: '27',
        position: 'WR',
        gameId: `espn-nfl-${id}-${index}`,
        date: Date.parse(AT) - (index + 1) * 7 * 86_400_000,
        stats: { receivingYards: 60 + index },
      })),
    );
    return buildPlayerRatings(lines);
  }

  it('resolves a player a book spelled differently', () => {
    const resolve = playerResolver(ratingsFor([{ id: '1', name: 'Tyrone Tracy' }]));
    assert.equal(resolve('Tyrone Tracy Jr.'), '1');
  });

  it('refuses a near miss rather than guessing', () => {
    const resolve = playerResolver(ratingsFor([{ id: '1', name: 'Josh Allen' }]));
    // A different person entirely, and one letter from a real one.
    assert.equal(resolve('Josh Allens'), null);
    assert.equal(resolve('Joshua Allen'), null);
  });

  it('refuses both when two players share a name', () => {
    /*
     * The NFL has had two Josh Allens at once. Resolving to either would
     * attach a price to a record that might not be his, so neither resolves.
     */
    const resolve = playerResolver(
      ratingsFor([
        { id: '1', name: 'Josh Allen' },
        { id: '2', name: 'Josh Allen' },
      ]),
    );
    assert.equal(resolve('Josh Allen'), null);
  });
});
