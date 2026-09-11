/**
 * A fight and a tennis match, from the model to a settled leg.
 *
 * The engine had been built, calibrated and backtested for both sports and
 * then wired to nothing: no projection on a fixture's page, no selection in a
 * parlay, and no settlement — so a prediction, had one ever been published,
 * would have sat open until the abandonment rule quietly voided it. These
 * tests cover the seam that was missing rather than the model, which
 * `bouts.test.ts` and `tennis.test.ts` already cover.
 *
 * The thing most worth guarding is what a contest does *not* have. It has no
 * score, so nothing may invent one; it has no simulations, so nothing may
 * count two legs jointly; and it can end without being settled at all, which
 * is a void rather than a loss.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BOUT_CONFIG,
  TENNIS_CONFIG,
  WTA_CONFIG,
  buildBoutRatings,
  toBoutResults,
} from '../lib/projections/bout-model.ts';
import {
  boutConfidence,
  boutSelections,
  projectContest,
} from '../lib/projections/bout-selections.ts';
import { assembleSlip } from '../lib/projections/same-game.ts';
import { eligible } from '../lib/projections/optimiser.ts';
import { RISK_PROFILES } from '../lib/projections/config.ts';
import { evidenceFor, outcomeOf, settle } from '../lib/projections/settlement.ts';
import { parsePredictions } from '../lib/projections/store-parse.ts';
import { contestDetailFrom } from '../lib/games/contest-detail.ts';
import { isProjectable, resolveScope } from '../lib/leagues/catalogue.ts';
import { findLeague } from '../lib/leagues/registry.ts';
import { priceFromDecimal } from '../lib/markets/price.ts';
import { whatNeedsToHappen } from '../lib/markets/explain.ts';
import type { GameMarkets } from '../lib/markets/types.ts';
import type { Game } from '../lib/home/types.ts';
import type { PredictionRecordV2 } from '../lib/projections/types.ts';

const NOW = new Date('2026-09-11T12:00:00.000Z');

function fight(overrides: Partial<Game> = {}): Game {
  return {
    id: 'espn-ufc-1',
    sport: 'mma',
    league: 'UFC',
    league_badge: null,
    season: '2026',
    round: null,
    start_time: '2026-09-19T21:00:00.000Z',
    status: 'scheduled',
    provider_status: 'Scheduled',
    home_team: { id: 'pantoja', name: 'Alexandre Pantoja', logo: null },
    away_team: { id: 'van', name: 'Joshua Van', logo: null },
    venue: { name: null, city: null, country: null, indoor: null },
    broadcast: null,
    winner: null,
    division: 'Flyweight',
    scheduledRounds: 5,
    title: 'UFC 331',
    ...overrides,
  } as Game;
}

/** `wins` completed fights for one fighter, all before the fixture above. */
function history(id: string, wins: number, division = 'Flyweight'): Game[] {
  const games: Game[] = [];
  for (let i = 0; i < wins; i += 1) {
    games.push(
      fight({
        id: `${id}-${i}`,
        start_time: `2025-0${(i % 9) + 1}-01T00:00:00.000Z`,
        status: 'finished',
        home_team: { id, name: id, logo: null },
        away_team: { id: `foe-${id}-${i}`, name: `Foe ${i}`, logo: null },
        winner: 'home',
        division,
      }),
    );
  }
  return games;
}

function ratingsFor(games: readonly Game[], config = BOUT_CONFIG) {
  return buildBoutRatings(toBoutResults(games, Number.POSITIVE_INFINITY), config);
}

/** A card both fighters have a real record on, so the fixture is projectable. */
const CARD = [...history('pantoja', 8), ...history('van', 4)];

function outcomeFor(game: Game = fight(), config = BOUT_CONFIG) {
  const projected = projectContest(game, ratingsFor(CARD, config), config, { now: NOW });
  assert.ok(projected, 'the fixture should have been projectable');
  return projected;
}

/** A book quoting both sides of the winner market. */
function quotes(overrides: Partial<GameMarkets> = {}): GameMarkets {
  const home = priceFromDecimal(1.6);
  const away = priceFromDecimal(2.4);
  assert.ok(home && away);

  return {
    gameId: 'espn-ufc-1',
    source: 'Sky Bet',
    fetchedAt: NOW.toISOString(),
    markets: [
      {
        market: 'moneyline',
        period: 'full_game',
        selection: 'Alexandre Pantoja',
        side: 'home',
        direction: null,
        line: null,
        price: home,
        source: 'Sky Bet',
        fetchedAt: NOW.toISOString(),
        settlement: { kind: 'winner', side: 'home' },
      },
      {
        market: 'moneyline',
        period: 'full_game',
        selection: 'Joshua Van',
        side: 'away',
        direction: null,
        line: null,
        price: away,
        source: 'Sky Bet',
        fetchedAt: NOW.toISOString(),
        settlement: { kind: 'winner', side: 'away' },
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The projection
// ---------------------------------------------------------------------------

describe('projecting a contest for the page', () => {
  const { projection } = outcomeFor();

  it('never invents a scoreline, because the sport has none', () => {
    /*
     * The whole reason this model does not go through `projectGame`. A fight
     * has one discrete outcome and nothing to accumulate, so there is no
     * expected score, no margin and no total anywhere on the projection.
     */
    const fields = Object.keys(projection);
    for (const banned of [
      'expected_home_score',
      'expected_away_score',
      'expected_margin',
      'expected_total',
      'model_spread',
      'typical_score',
    ]) {
      assert.ok(!fields.includes(banned), `a fight projection must not carry ${banned}`);
    }
  });

  it('gives the two probabilities and nothing between them', () => {
    // No draw probability: the model has none, and a market it cannot price
    // is one it must not appear to have an opinion on.
    assert.ok(Math.abs(projection.outcome.home + projection.outcome.away - 1) < 1e-9);
    assert.ok(projection.outcome.home > 0.5, 'the longer record should be favoured');
  });

  it('carries the record each rating was built from', () => {
    // What the number rests on, and the whole of what it rests on. This takes
    // the place of the scoreline on the page, so it has to be real.
    assert.equal(projection.records.home.contests, 8);
    assert.equal(projection.records.home.wins, 8);
    assert.equal(projection.records.away.contests, 4);
    assert.ok(projection.records.home.rating > projection.records.away.rating);
    assert.ok(projection.records.home.last_contest);
  });

  it('names the card, the division and the two people', () => {
    assert.equal(projection.event, 'UFC 331');
    assert.equal(projection.division, 'Flyweight');
    assert.equal(projection.home_team, 'Alexandre Pantoja');
    assert.equal(projection.away_team, 'Joshua Van');
  });

  it('stamps the competition’s own model version, not the team model’s', () => {
    /*
     * Per competition, as the v2 spec requires. A UFC prediction and a WTA one
     * are made by different constants, and one label across both would make
     * the accuracy breakdown average two models together silently.
     */
    assert.equal(projection.model_version, BOUT_CONFIG.modelVersion);
    assert.notEqual(TENNIS_CONFIG.modelVersion, WTA_CONFIG.modelVersion);
    assert.notEqual(BOUT_CONFIG.modelVersion, TENNIS_CONFIG.modelVersion);
  });

  it('explains itself in the sport’s own words', () => {
    const text = [...projection.factors.map((f) => f.text), ...projection.quality_reasons].join(' ');
    assert.ok(text.includes('fight'), 'a fight projection should talk about fights');
    assert.ok(!text.includes('match'), `MMA wording leaked tennis: ${text}`);

    const tennisWords = projectContest(
      fight({
        id: 'espn-atp-1',
        sport: 'tennis',
        league: 'ATP Tour',
        division: null,
        round: 'Quarterfinal',
        title: 'US Open',
      }),
      buildBoutRatings(
        toBoutResults(
          [
            ...history('pantoja', 12, 'unknown').map((g) => ({ ...g, division: null })),
            ...history('van', 12, 'unknown').map((g) => ({ ...g, division: null })),
          ] as Game[],
          Number.POSITIVE_INFINITY,
        ),
        TENNIS_CONFIG,
      ),
      TENNIS_CONFIG,
      { now: NOW },
    );
    assert.ok(tennisWords);
    const tennisText = tennisWords.projection.factors.map((f) => f.text).join(' ');
    assert.ok(tennisText.includes('match'), `tennis wording was wrong: ${tennisText}`);
  });

  it('says nothing at all when either record is below the floor', () => {
    // The answer for most of a card. A prospect with two fights gets
    // "insufficient data", not a confident guess.
    const thin = ratingsFor([...history('pantoja', 8), ...history('van', 1)]);
    assert.equal(projectContest(fight(), thin, BOUT_CONFIG, { now: NOW }), null);
  });

  it('refuses a fixture with no start time', () => {
    const undated = fight({ start_time: null });
    assert.equal(projectContest(undated, ratingsFor(CARD), BOUT_CONFIG, { now: NOW }), null);
  });

  it('keeps confidence below certainty and inside the model’s own range', () => {
    const { estimate } = outcomeFor();
    const confidence = boutConfidence(estimate);
    assert.ok(confidence > 0 && confidence <= 0.95);
    // Confidence is about the estimate, not the outcome, so a lopsided fight
    // is not automatically a confident one.
    assert.notEqual(confidence, projection.outcome.home);
  });

  it('warns about a layoff rather than quietly discounting it', () => {
    const stale = [
      ...history('pantoja', 8).map((game) => ({ ...game, start_time: '2022-01-01T00:00:00.000Z' })),
      ...history('van', 4),
    ] as Game[];
    const projected = projectContest(fight(), ratingsFor(stale), BOUT_CONFIG, { now: NOW });
    assert.ok(projected);
    const layoff = projected.projection.factors.find((factor) =>
      factor.text.includes('has not fought'),
    );
    assert.ok(layoff, 'a fighter idle for years should be flagged');
    assert.ok(
      layoff.text.includes('does not adjust'),
      'and the projection must say it did not price the layoff',
    );
  });
});

// ---------------------------------------------------------------------------
// Selections
// ---------------------------------------------------------------------------

describe('selections from a contest', () => {
  it('offers the model’s side alone when no book has quoted it', () => {
    const selections = boutSelections(fight(), outcomeFor(), null, NOW.getTime());
    assert.equal(selections.length, 1);
    assert.equal(selections[0].label, 'Alexandre Pantoja');
    assert.equal(selections[0].market.availability, 'model_only');
    assert.equal(selections[0].market.price, null);
  });

  it('offers both sides when a book quotes both', () => {
    /*
     * The model's job is to say which of the available bets it likes, not to
     * be shown only the one it already agrees with — the same rule the scoring
     * model follows.
     */
    const selections = boutSelections(fight(), outcomeFor(), quotes(), NOW.getTime());
    assert.equal(selections.length, 2);
    assert.deepEqual(
      selections.map((selection) => selection.market.availability),
      ['verified', 'verified'],
    );
    assert.ok(selections.every((selection) => selection.market.price));
  });

  it('prices only the winner, because that is all the model prices', () => {
    /*
     * The provider also quotes handicaps and totals on these sports. The model
     * has no probability for either, and a market it cannot put a number
     * against must not become a selection.
     */
    const withTotals = quotes({
      markets: [
        ...quotes().markets,
        {
          market: 'total',
          period: 'full_game',
          selection: 'Over',
          side: null,
          direction: 'over',
          line: 2.5,
          price: priceFromDecimal(1.9)!,
          source: 'Sky Bet',
          fetchedAt: NOW.toISOString(),
          settlement: { kind: 'total', direction: 'over', line: 2.5 },
        },
      ],
    });

    const selections = boutSelections(fight(), outcomeFor(), withTotals, NOW.getTime());
    assert.equal(selections.length, 2);
    assert.ok(selections.every((selection) => selection.type === 'winner'));
  });

  it('has no opinion on a quoted draw', () => {
    // Some books price a drawn fight. The model produces no draw probability,
    // so it says nothing rather than inventing one.
    const withDraw = quotes({
      markets: [
        ...quotes().markets,
        {
          market: 'moneyline',
          period: 'full_game',
          selection: 'Draw',
          side: 'draw',
          direction: null,
          line: null,
          price: priceFromDecimal(26)!,
          source: 'Sky Bet',
          fetchedAt: NOW.toISOString(),
          settlement: { kind: 'winner', side: 'draw' },
        },
      ],
    });

    const selections = boutSelections(fight(), outcomeFor(), withDraw, NOW.getTime());
    assert.equal(selections.length, 2);
    assert.ok(!selections.some((selection) => selection.label === 'Draw'));
  });

  it('treats a stale price as no price rather than as a current one', () => {
    const old = quotes({ fetchedAt: '2026-09-11T09:00:00.000Z' });
    const selections = boutSelections(fight(), outcomeFor(), old, NOW.getTime());
    assert.ok(selections.every((selection) => selection.market.availability === 'model_only'));
  });

  it('sets both sides against the price it was quoted at', () => {
    const selections = boutSelections(fight(), outcomeFor(), quotes(), NOW.getTime());
    for (const selection of selections) {
      assert.ok(selection.edge, 'a quoted selection can be compared with its price');
      assert.ok(selection.market.fairProbability, 'both sides known means the margin comes out');
      assert.ok(
        Math.abs(selection.edge.edge - (selection.probability - selection.market.price!.implied)) <
          1e-9,
      );
    }
  });

  it('keeps both sides of one contest in a single correlation group', () => {
    // They are the two sides of the same coin: the optimiser must never take
    // both, and one group per contest is what stops it.
    const selections = boutSelections(fight(), outcomeFor(), quotes(), NOW.getTime());
    assert.equal(new Set(selections.map((s) => s.correlation_group)).size, 1);
  });

  it('keeps its id stable across a refresh, so publishing stays idempotent', () => {
    const first = boutSelections(fight(), outcomeFor(), quotes(), NOW.getTime());
    const again = boutSelections(fight(), outcomeFor(), quotes(), NOW.getTime() + 60_000);
    assert.deepEqual(
      first.map((s) => s.id),
      again.map((s) => s.id),
    );
  });

  it('says what voids the bet before it is placed, not after', () => {
    const selections = boutSelections(fight(), outcomeFor(), null, NOW.getTime());
    assert.match(selections[0].explanation, /no-contest voids/);

    const tennisText = whatNeedsToHappen(
      { kind: 'winner', side: 'home' },
      { homeTeam: 'Zverev', awayTeam: 'Khachanov', sport: 'tennis' },
    );
    assert.match(tennisText, /retirement or a walkover voids/);
  });

  it('can reach a parlay, which is the point of all of it', () => {
    // The gap this work closed: a calibrated model that produced nothing a
    // reader could ever be offered.
    const selections = boutSelections(fight(), outcomeFor(), quotes(), NOW.getTime());
    const qualified = eligible(selections, RISK_PROFILES.high, 'available');
    assert.ok(qualified.length > 0, 'a verified fight selection must be usable in a line');
  });

  it('carries the projection so a leg can explain itself', () => {
    const [selection] = boutSelections(fight(), outcomeFor(), null, NOW.getTime());
    assert.ok(selection.bout);
    assert.equal(selection.projection, undefined, 'a fight has no scoring projection');
    assert.equal(selection.race, undefined);
    assert.ok(selection.reasoning.support.length + selection.reasoning.risks.length > 0);
  });
});

// ---------------------------------------------------------------------------
// A slip with no simulations behind it
// ---------------------------------------------------------------------------

describe('building a slip on a contest', () => {
  it('takes one leg and refuses to multiply a second it cannot count', () => {
    /*
     * Every joint probability in this application is counted across a shared
     * set of simulated games. A fight has none — its probability *is* the
     * answer — so a second leg could only be priced by multiplying two related
     * numbers, which is the one thing the same-game module exists not to do.
     */
    const selections = boutSelections(fight(), outcomeFor(), quotes(), NOW.getTime());
    const slip = assembleSlip(selections, null);

    assert.equal(slip.legs.length, 1);
    assert.equal(slip.dropped, 1);
    assert.equal(slip.assessment.joint, slip.assessment.independent);
    assert.equal(slip.assessment.correlation.ratio, 1);
  });
});

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

describe('settling a contest', () => {
  const rule = { kind: 'winner', side: 'home' } as const;
  const finished = (winner: 'home' | 'away' | null, completion?: 'retired' | 'walkover') => ({
    status: 'finished' as const,
    home: null,
    away: null,
    winner,
    ...(completion ? { completion } : {}),
  });

  it('settles on who won, with no score in sight', () => {
    const won = evidenceFor(rule, finished('home'));
    assert.ok(won);
    assert.equal(settle(rule, won), 'won');

    const lost = evidenceFor(rule, finished('away'));
    assert.ok(lost);
    assert.equal(settle(rule, lost), 'lost');
  });

  it('voids a retirement rather than failing the player who stopped', () => {
    /*
     * §4.8.b of the v2 spec. The match happened, but nothing about who was
     * better was settled, so counting it as a miss would understate the model
     * as surely as counting it as a hit would flatter it.
     */
    const retired = evidenceFor(rule, finished('away', 'retired'));
    assert.ok(retired);
    assert.equal(settle(rule, retired), 'void');
    // Even for the player who was still standing.
    assert.equal(settle({ kind: 'winner', side: 'away' }, retired), 'void');
  });

  it('voids a walkover, because nothing was played', () => {
    const walkover = evidenceFor(rule, finished('home', 'walkover'));
    assert.ok(walkover);
    assert.equal(settle(rule, walkover), 'void');
  });

  it('voids a draw or a no-contest, which is neither side winning', () => {
    const drawn = evidenceFor(rule, finished(null));
    assert.ok(drawn);
    assert.equal(settle(rule, drawn), 'void');
  });

  it('waits rather than voiding when the result has not arrived', () => {
    // Null is "not yet", never "no". A finished fight the provider has not
    // called yet must stay open.
    assert.equal(evidenceFor(rule, { status: 'finished', home: null, away: null }), null);
    assert.equal(evidenceFor(rule, { status: 'live', home: null, away: null, winner: null }), null);
  });

  it('never reads a scored fixture as a contest, or the reverse', () => {
    /*
     * The guard that keeps three settlement paths apart. A football result
     * carries no `winner`, so it settles on its margin exactly as before.
     */
    const football = evidenceFor(rule, { status: 'finished', home: 2, away: 1 });
    assert.ok(football);
    assert.equal(football.winner, undefined);
    assert.equal(settle(rule, football), 'won');
  });

  it('describes the result by name rather than by code', () => {
    const evidence = evidenceFor(rule, finished('home'))!;
    const described = outcomeOf(rule, evidence, { home: 'Pantoja', away: 'Van' });
    assert.equal(described.text, 'Pantoja won');
    assert.equal(described.actual.winner, 'home');
    // Zeros, and they must never be shown as a scoreline.
    assert.equal(described.actual.home_score, 0);

    const retired = evidenceFor(rule, finished('home', 'retired'))!;
    assert.match(outcomeOf(rule, retired, { home: 'Zverev', away: 'Khachanov' }).text, /retirement/);

    const drawn = evidenceFor(rule, finished(null))!;
    assert.match(outcomeOf(rule, drawn, { home: 'A', away: 'B' }).text, /No winner/);
  });

  it('keeps the winner when the store is read back', () => {
    /*
     * The failure this mirrors is real and recent: every Formula 1 prediction
     * was written to disk and silently discarded on the next read because the
     * store did not recognise its shape. A result the parser drops is a result
     * that never happened.
     */
    const record: PredictionRecordV2 = {
      id: 'espn-ufc-1:winner:Alexandre Pantoja',
      game_id: 'espn-ufc-1',
      sport: 'mma',
      league: 'UFC',
      selection_type: 'winner',
      selection: 'Alexandre Pantoja',
      settlement: { kind: 'winner', side: 'home' },
      model_probability: 0.62,
      model_confidence: 0.6,
      data_quality: 0.6,
      model_version: BOUT_CONFIG.modelVersion,
      risk: 'medium',
      created_at: NOW.toISOString(),
      game_start: '2026-09-19T21:00:00.000Z',
      status: 'won',
      result: 'Alexandre Pantoja won',
      settled_at: NOW.toISOString(),
      final_pre_game: true,
      parlay_id: null,
      projected: null,
      actual: { home_score: 0, away_score: 0, margin: 0, total: 0, winner: 'home' },
      attempts: 0,
      next_attempt_at: null,
      audit: [],
    };

    const [back] = parsePredictions({ predictions: [record] });
    assert.ok(back);
    assert.equal(back.actual?.winner, 'home');
  });
});

// ---------------------------------------------------------------------------
// The page a contest opens on
// ---------------------------------------------------------------------------

describe('a contest’s detail page', () => {
  const detail = contestDetailFrom(
    fight({ status: 'finished', winner: 'away', completion: 'played' }),
  );

  it('is built from the fixture, because the summary endpoint has no such event', () => {
    // Checked live 2026-09-11: the summary path answers with an error for both
    // a fight id and a match id. Building the page from the scoreboard is what
    // makes these fixtures openable at all.
    assert.ok(detail);
    assert.equal(detail.id, 'espn-ufc-1');
    assert.equal(detail.home_team.name, 'Alexandre Pantoja');
  });

  it('shows no score, and says who won instead', () => {
    assert.equal(detail?.score, null);
    assert.equal(detail?.winner, 'away');
  });

  it('claims no table, no meetings and no injury report', () => {
    // None exists for an individual on this provider. Reporting them as absent
    // is what stops the page rendering three sections that look broken.
    assert.equal(detail?.standings.home, null);
    assert.equal(detail?.head_to_head.length, 0);
    assert.equal(detail?.availability, null);
  });

  it('carries the card and the division a fight belongs to', () => {
    assert.equal(detail?.title, 'UFC 331');
    assert.equal(detail?.division, 'Flyweight');
    assert.equal(detail?.scheduledRounds, 5);
  });
});

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

describe('the three competitions are offered like any other', () => {
  it('counts a fight and a tennis match as projectable', () => {
    for (const id of ['ufc', 'atp', 'wta']) {
      const league = findLeague(id);
      assert.ok(league && isProjectable(league), `${id} must be projectable`);
    }
  });

  it('resolves a request for either sport', () => {
    const mma = resolveScope('mma', 'ufc');
    assert.ok(mma);
    assert.deepEqual(mma.leagues.map((league) => league.id), ['ufc']);

    const tennis = resolveScope('tennis', null);
    assert.ok(tennis);
    assert.deepEqual(tennis.leagues.map((league) => league.id).sort(), ['atp', 'wta']);
  });

  it('still refuses a competition from the wrong sport', () => {
    assert.equal(resolveScope('mma', 'atp'), null);
    assert.equal(resolveScope('tennis', 'ufc'), null);
  });
});
