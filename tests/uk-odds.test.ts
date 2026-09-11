import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  creditsFor,
  joinToFixtures,
  marketsFor,
  oddsQuota,
  pricesLeague,
  recordQuota,
  resetOddsQuota,
  sportKeyFor,
  tournamentKeysFor,
} from '../lib/odds/uk-books.ts';
import { findLeague } from '../lib/leagues/registry.ts';
import { MAX_QUOTE_AGE_MS } from '../lib/markets/types.ts';
import { oddsApiConfig } from '../lib/config.ts';
import type { RawUkEvent } from '../lib/odds/uk-books.ts';
import { eligible } from '../lib/projections/optimiser.ts';
import { RISK_PROFILES } from '../lib/projections/config.ts';
import type { Game } from '../lib/home/types';
import type { Selection } from '../lib/projections/types';

const FETCHED = '2026-09-11T12:00:00.000Z';

function fixture(overrides: Partial<Game> = {}): Game {
  return {
    id: 'espn-epl-1',
    sport: 'football',
    league: 'Premier League',
    league_badge: null,
    season: '2026',
    round: null,
    start_time: '2026-09-12T14:00:00.000Z',
    status: 'scheduled',
    provider_status: 'Scheduled',
    home_team: { id: '1', name: 'Tottenham Hotspur', logo: null },
    away_team: { id: '2', name: 'Manchester United', logo: null },
    venue: { name: null, city: null, country: null, indoor: null },
    broadcast: null,
    ...overrides,
  } as Game;
}

function event(overrides: Partial<RawUkEvent> = {}): RawUkEvent {
  return {
    id: 'abc',
    commence_time: '2026-09-12T14:00:00Z',
    home_team: 'Tottenham Hotspur',
    away_team: 'Manchester United',
    bookmakers: [
      {
        key: 'skybet',
        title: 'Sky Bet',
        markets: [
          {
            key: 'h2h',
            outcomes: [
              { name: 'Tottenham Hotspur', price: 2.4 },
              { name: 'Manchester United', price: 3.1 },
              { name: 'Draw', price: 3.5 },
            ],
          },
          {
            key: 'totals',
            outcomes: [
              { name: 'Over', price: 1.9, point: 2.5 },
              { name: 'Under', price: 1.95, point: 2.5 },
            ],
          },
        ],
      },
    ],
    ...overrides,
  } as RawUkEvent;
}

describe('reading UK bookmaker prices', () => {
  it('joins an event to the fixture it is actually about', () => {
    const markets = joinToFixtures([event()], [fixture()], FETCHED);
    assert.equal(markets.size, 1);
    assert.equal(markets.get('espn-epl-1')?.gameId, 'espn-epl-1');
  });

  it('matches a book’s shorthand against the fixtures feed’s full name', () => {
    // A book writes "Spurs" where a fixtures feed writes "Tottenham Hotspur".
    const markets = joinToFixtures(
      [event({ home_team: 'Spurs', away_team: 'Man Utd' })],
      [fixture()],
      FETCHED,
    );
    assert.equal(markets.size, 1);
  });

  it('drops an event on a different day', () => {
    // Same two clubs, different fixture. Guessing here would attach one
    // match's prices to another.
    const markets = joinToFixtures(
      [event({ commence_time: '2026-11-30T14:00:00Z' })],
      [fixture()],
      FETCHED,
    );
    assert.equal(markets.size, 0);
  });

  it('drops an event whose teams do not both match', () => {
    const markets = joinToFixtures(
      [event({ away_team: 'Everton' })],
      [fixture()],
      FETCHED,
    );
    assert.equal(markets.size, 0);
  });

  it('reads the draw, which names neither side', () => {
    const quotes = joinToFixtures([event()], [fixture()], FETCHED).get('espn-epl-1')!.markets;
    const draw = quotes.find((quote) => quote.side === 'draw');
    assert.ok(draw, 'a football market without a draw is missing a third of itself');
    assert.equal(draw.settlement.kind, 'winner');
    assert.equal(draw.price.decimal, 3.5);
  });

  it('keeps over and under apart, with their line', () => {
    const quotes = joinToFixtures([event()], [fixture()], FETCHED).get('espn-epl-1')!.markets;
    const over = quotes.find((q) => q.market === 'total' && q.direction === 'over');
    const under = quotes.find((q) => q.market === 'total' && q.direction === 'under');
    assert.equal(over?.line, 2.5);
    assert.equal(under?.line, 2.5);
    assert.notEqual(over?.price.decimal, under?.price.decimal);
  });

  it('takes the best price across books, and says which book gave it', () => {
    /*
     * Best is unambiguous here: a higher decimal pays more for the same
     * outcome. Which book it came from travels with the quote, so a slip never
     * implies one book offered all of it.
     */
    const twoBooks = event({
      bookmakers: [
        {
          key: 'skybet',
          title: 'Sky Bet',
          markets: [{ key: 'h2h', outcomes: [{ name: 'Tottenham Hotspur', price: 2.4 }] }],
        },
        {
          key: 'williamhill',
          title: 'William Hill',
          markets: [{ key: 'h2h', outcomes: [{ name: 'Tottenham Hotspur', price: 2.9 }] }],
        },
      ],
    } as Partial<RawUkEvent>);

    const game = joinToFixtures([twoBooks], [fixture()], FETCHED).get('espn-epl-1')!;
    const home = game.markets.find((quote) => quote.side === 'home');
    assert.equal(home?.price.decimal, 2.9);
    assert.equal(home?.source, 'William Hill');
    // The fixture-level summary must not name one book when two contributed.
    assert.equal(game.source, 'William Hill');
  });

  it('names several books when several contributed', () => {
    const twoBooks = event({
      bookmakers: [
        {
          key: 'skybet',
          title: 'Sky Bet',
          markets: [{ key: 'h2h', outcomes: [{ name: 'Tottenham Hotspur', price: 2.9 }] }],
        },
        {
          key: 'williamhill',
          title: 'William Hill',
          markets: [{ key: 'h2h', outcomes: [{ name: 'Manchester United', price: 3.4 }] }],
        },
      ],
    } as Partial<RawUkEvent>);
    const game = joinToFixtures([twoBooks], [fixture()], FETCHED).get('espn-epl-1')!;
    assert.match(game.source, /2 UK books/);
  });

  it('ignores a price that cannot pay anything', () => {
    // A decimal of 1 returns the stake. Nothing quotes it, and treating it as a
    // price would put a 100% implied probability into the comparison.
    const broken = event({
      bookmakers: [
        {
          key: 'skybet',
          title: 'Sky Bet',
          markets: [{ key: 'h2h', outcomes: [{ name: 'Tottenham Hotspur', price: 1 }] }],
        },
      ],
    } as Partial<RawUkEvent>);
    assert.equal(joinToFixtures([broken], [fixture()], FETCHED).size, 0);
  });

  it('knows which competitions this provider prices, and admits the rest', () => {
    assert.equal(sportKeyFor('epl'), 'soccer_epl');
    assert.equal(sportKeyFor('ufc'), 'mma_mixed_martial_arts');
    // Keyed per tournament rather than per tour, so there is no fixed key.
    assert.equal(sportKeyFor('atp'), null);
    assert.equal(sportKeyFor('f1'), null);

    // But the tours are still priced, by the other route.
    assert.equal(pricesLeague('atp'), true);
    assert.equal(pricesLeague('wta'), true);
    assert.equal(pricesLeague('f1'), false);
  });
});

describe('finding this week’s tennis tournaments', () => {
  /*
   * This provider keys tennis per tournament — `tennis_atp_us_open` — and
   * which of them exist changes as the calendar moves on. Hard-coding a list
   * would price the ATP for a fortnight and then quietly stop, so the keys in
   * play are read from the provider's own sports list instead.
   */
  const sports = [
    { key: 'tennis_atp_us_open', active: true },
    { key: 'tennis_atp_shanghai_masters', active: true },
    { key: 'tennis_wta_us_open', active: true },
    { key: 'tennis_atp_wimbledon', active: false },
    { key: 'tennis_atp_aus_open_winner', active: true, has_outrights: true },
    { key: 'soccer_epl', active: true },
  ];

  it('takes only the tour asked for', () => {
    assert.deepEqual(tournamentKeysFor('atp', sports), [
      'tennis_atp_shanghai_masters',
      'tennis_atp_us_open',
    ]);
    assert.deepEqual(tournamentKeysFor('wta', sports), ['tennis_wta_us_open']);
  });

  it('skips a tournament that is over', () => {
    // An inactive key returns no events, so asking for it spends a credit to
    // learn nothing.
    assert.ok(!tournamentKeysFor('atp', sports).includes('tennis_atp_wimbledon'));
  });

  it('skips an outright, which holds no match prices to join to a fixture', () => {
    assert.ok(!tournamentKeysFor('atp', sports).includes('tennis_atp_aus_open_winner'));
  });

  it('gives nothing for a competition priced by a single key', () => {
    assert.deepEqual(tournamentKeysFor('epl', sports), []);
  });
});

describe('paying only for markets the model can use', () => {
  /*
   * This provider bills markets × regions per call, so every market asked for
   * is paid for whether or not anything reads it.
   */
  it('buys the winner alone for a fight or a tennis match', () => {
    // `boutSelections` reads h2h quotes and ignores every other kind, so
    // handicaps and totals there were two thirds of each call, thrown away.
    for (const id of ['ufc', 'atp', 'wta']) {
      const league = findLeague(id)!;
      assert.equal(marketsFor(league), 'h2h');
      assert.equal(creditsFor(league), 1);
    }
  });

  it('still buys all three where the scoring model prices all three', () => {
    for (const id of ['epl', 'nfl', 'mlb']) {
      const league = findLeague(id)!;
      assert.equal(marketsFor(league), 'h2h,spreads,totals');
      assert.equal(creditsFor(league), 3);
    }
  });

  it('makes a tour three times cheaper, where it costs the most', () => {
    /*
     * A tour is several tournament keys at once, so the saving compounds
     * exactly where the bill was largest.
     */
    const atp = findLeague('atp')!;
    const epl = findLeague('epl')!;
    assert.equal(creditsFor(epl) / creditsFor(atp), 3);
  });
});

describe('knowing what is left', () => {
  /*
   * A quota nobody can see is one that runs out mid-month without warning.
   * These figures come from headers the provider sends on every priced call,
   * and the accounting should not be checkable only against a live key.
   */
  const headers = (entries: Record<string, string>) => new Headers(entries);

  it('reads the budget the provider reports', () => {
    resetOddsQuota();
    recordQuota(
      headers({
        'x-requests-remaining': '19946',
        'x-requests-used': '54',
        'x-requests-last': '3',
      }),
    );

    const quota = oddsQuota();
    assert.equal(quota.remaining, 19946);
    assert.equal(quota.used, 54);
    assert.equal(quota.lastCost, 3);
    assert.equal(quota.exhausted, false);
    assert.ok(quota.at);
  });

  it('notices when there is nothing left to spend', () => {
    resetOddsQuota();
    recordQuota(headers({ 'x-requests-remaining': '0', 'x-requests-used': '20000' }));
    assert.equal(oddsQuota().exhausted, true);
  });

  it('keeps the last known figure when a response omits the headers', () => {
    // Losing the number because one response was shaped differently would
    // report the budget as unknown rather than as what it last was.
    resetOddsQuota();
    recordQuota(headers({ 'x-requests-remaining': '500' }));
    recordQuota(headers({}));
    assert.equal(oddsQuota().remaining, 500);
  });

  it('survives a header that is not a number', () => {
    resetOddsQuota();
    recordQuota(headers({ 'x-requests-remaining': 'unlimited' }));
    assert.equal(oddsQuota().remaining, null);
    assert.equal(oddsQuota().exhausted, false);
  });
});

describe('a cached price does not pretend to be a fresh one', () => {
  it('leaves room for a quote to still be verified when it is read', () => {
    /*
     * Two caches sit between a fetch and a reader: the odds cache, and the
     * five-minute candidate build in front of it. So the oldest a served quote
     * can be is one lifetime plus five minutes, and past MAX_QUOTE_AGE_MS it
     * stops counting as verified — bought, then discarded for being stale.
     *
     * This asserts the relationship rather than the number, so changing the
     * lifetime cannot quietly push it past the cliff.
     */
    const candidateCacheMs = 5 * 60_000;
    assert.ok(
      oddsApiConfig.cacheTtlMs + candidateCacheMs < MAX_QUOTE_AGE_MS,
      `a quote could reach ${(oddsApiConfig.cacheTtlMs + candidateCacheMs) / 60_000} minutes old, ` +
        `past the ${MAX_QUOTE_AGE_MS / 60_000}-minute freshness limit`,
    );
  });
});

describe('a parlay only contains bets that exist', () => {
  const selection = (availability: 'verified' | 'model_only'): Selection =>
    ({
      id: `s-${availability}`,
      game_id: 'g1',
      correlation_group: 'g1',
      type: 'winner',
      label: 'Someone to win',
      probability: 0.8,
      confidence: 0.9,
      data_quality: 0.9,
      score: 0.8,
      market: { availability, price: null, source: null },
    }) as unknown as Selection;

  it('drops a leg no bookmaker offers, whatever else was asked for', () => {
    /*
     * There used to be an `any` setting that allowed these, and it was the
     * default. A parlay is a thing a person intends to place, so a leg nobody
     * quotes has no business in one.
     */
    const kept = eligible(
      [selection('verified'), selection('model_only')],
      RISK_PROFILES.low,
      'available',
    );
    assert.equal(kept.length, 1);
    assert.equal(kept[0].market.availability, 'verified');
  });

  it('drops it under the main-lines filter too', () => {
    const kept = eligible([selection('model_only')], RISK_PROFILES.low, 'main');
    assert.equal(kept.length, 0);
  });
});

describe('how many legs a risk level asks for', () => {
  it('grows with the risk, because the two are the same trade-off', () => {
    // Shorter, likelier legs at low risk; longer-priced, less likely ones at
    // high. The control used to open at three whatever was chosen.
    assert.ok(RISK_PROFILES.low.defaultLegs < RISK_PROFILES.medium.defaultLegs);
    assert.ok(RISK_PROFILES.medium.defaultLegs < RISK_PROFILES.high.defaultLegs);
  });
});
