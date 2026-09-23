/**
 * A player leg reaching a parlay, and pricing correctly when it gets there.
 *
 * Every test here corresponds to something that was measurably broken. The
 * first version of this feature modelled players, priced them, settled them —
 * and then dropped every one at the optimiser while the bet builder reported a
 * 55% leg at 0.5% and volunteered an explanation for the gap. None of that
 * failed loudly; it produced confident wrong numbers, which is why these are
 * pinned rather than left to a live check.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RISK_PROFILES } from '../lib/projections/config.ts';
import { isCountable } from '../lib/projections/correlation.ts';
import { eligible } from '../lib/projections/optimiser.ts';
import {
  assembleSlip,
  conflicts,
  evaluateCombination,
  unmeasurableTogether,
} from '../lib/projections/same-game.ts';
import { WINNER_AWAY, WINNER_HOME } from '../lib/projections/model.ts';
import type { Distribution } from '../lib/projections/model.ts';
import type { Selection } from '../lib/projections/types.ts';
import type { SettlementRule } from '../lib/markets/types.ts';

/** A thousand simulated games, home ahead in most of them. */
function distribution(): Distribution {
  const homeScores: number[] = [];
  const awayScores: number[] = [];
  const winners: number[] = [];

  for (let i = 0; i < 1000; i += 1) {
    const home = 3 + (i % 9);
    const away = 2 + ((i * 7) % 8);
    homeScores.push(home);
    awayScores.push(away);
    winners.push(home >= away ? WINNER_HOME : WINNER_AWAY);
  }

  return {
    homeWin: 0.6,
    awayWin: 0.4,
    draw: 0,
    meanHome: 7,
    meanAway: 5,
    meanMargin: 2,
    meanTotal: 12,
    margins: [],
    totals: [],
    homeScores,
    awayScores,
    winners,
  } as unknown as Distribution;
}

function leg(
  id: string,
  rule: SettlementRule,
  probability: number,
  type: string,
  line: number | null,
): Selection {
  return {
    id,
    game_id: 'espn-mlb-1',
    sport: 'mlb',
    league: 'MLB',
    league_id: 'mlb',
    start_time: '2026-09-24T18:00:00.000Z',
    fixture: 'Nationals v Tigers',
    type: rule.kind === 'player_stat' ? 'player_performance' : 'winner',
    label: id,
    market: {
      type,
      period: 'full_game',
      label: 'Market',
      selection: id,
      line,
      availability: 'verified',
      price: { decimal: 1.9, american: -111, fractional: '9/10', implied: 0.526 },
      source: 'Sky Bet',
      fetchedAt: new Date().toISOString(),
      fairProbability: null,
      margin: null,
    },
    explanation: '',
    probability_label: '',
    probability,
    edge: null,
    confidence: 0.75,
    data_quality: 0.8,
    score: probability,
    correlation_group: 'espn-mlb-1',
    settlement: rule,
    reasoning: { supporting: [], opposing: [], context: [] },
  } as unknown as Selection;
}

const pitcher = (id: string, athleteId: string, line: number, probability: number) =>
  leg(
    id,
    {
      kind: 'player_stat',
      athleteId,
      player: `Pitcher ${athleteId}`,
      stat: 'pitcher_strikeouts',
      statLabel: 'Strikeouts',
      direction: 'over',
      line,
    },
    probability,
    'player_stat',
    line,
  );

const homeWin = leg('Home win', { kind: 'winner', side: 'home' }, 0.6, 'moneyline', null);

// ---------------------------------------------------------------------------
// Reaching a parlay at all
// ---------------------------------------------------------------------------

describe('a player leg and the risk gates', () => {
  const candidate = pitcher('Valdez over 5.5', '36581', 5.5, 0.62);

  it('is accepted by medium and high', () => {
    // It was accepted by none. `player_performance` appeared in no profile's
    // allowed types, so the optimiser dropped every player leg silently — the
    // same way the UFC and both tennis tours were once invisible.
    assert.equal(eligible([candidate], RISK_PROFILES.medium).length, 1);
    assert.equal(eligible([candidate], RISK_PROFILES.high).length, 1);
  });

  it('is refused by low, deliberately', () => {
    /*
     * Not an oversight. A player estimate cannot exceed 0.8 data quality however
     * long the record is, because the opposition is not in it — so the category
     * a reader trusts most is held to markets with no structural hole in their
     * evidence.
     */
    const strong = { ...candidate, probability: 0.8, data_quality: 0.8, confidence: 0.8 };
    assert.equal(eligible([strong], RISK_PROFILES.low).length, 0);
  });

  it('is still refused when no book is quoting it', () => {
    // Unconditional and upstream of everything else: a leg nobody offers cannot
    // go on a slip, whatever its probability.
    const unpriced = {
      ...candidate,
      market: { ...candidate.market, availability: 'model_only', price: null },
    } as Selection;
    assert.equal(eligible([unpriced], RISK_PROFILES.medium).length, 0);
  });
});

// ---------------------------------------------------------------------------
// Pricing it
// ---------------------------------------------------------------------------

describe('pricing a slip that contains a player leg', () => {
  const sims = distribution();

  it('reports a lone player leg at its own probability', () => {
    /*
     * This was 0.005 against a card reading 0.55. `same-game.ts` promises that
     * "a single-leg builder shows exactly the number the leg card shows", and
     * for player legs it did not.
     */
    const slip = assembleSlip([pitcher('A over 5.5', '1', 5.5, 0.55)], sims);
    assert.equal(slip.legs.length, 1);
    assert.equal(slip.assessment.joint, 0.55);
    assert.equal(slip.assessment.independent, 0.55);
  });

  it('multiplies two players and says the relationship is unmeasured', () => {
    const slip = assembleSlip(
      [pitcher('A over 5.5', '1', 5.5, 0.6), pitcher('B over 4.5', '2', 4.5, 0.5)],
      sims,
    );

    assert.equal(slip.legs.length, 2);
    assert.equal(slip.assessment.joint, 0.3);
    // No ratio, because there is nothing to take a ratio of.
    assert.equal(slip.assessment.correlation.ratio, null);
    assert.match(slip.assessment.correlation.note, /has not been measured/);
  });

  it('never claims two legs pull against each other when it could not count them', () => {
    // The precise sentence the broken version volunteered for a team-plus-player
    // slip, attached to an artefact rather than to a measurement.
    const slip = assembleSlip(
      [pitcher('A over 5.5', '1', 5.5, 0.6), pitcher('B over 4.5', '2', 4.5, 0.5)],
      sims,
    );
    assert.doesNotMatch(slip.assessment.correlation.note, /pull against each other/);
  });

  it('still counts a slip of scoreline legs, unchanged', () => {
    const total = leg(
      'Over 8.5',
      { kind: 'total', direction: 'over', line: 8.5 },
      0.5,
      'total',
      8.5,
    );
    const both = evaluateCombination([homeWin, total], sims);

    // A measured relationship, so it carries a ratio and says it was counted.
    assert.ok(both.correlation.ratio !== null);
    assert.notEqual(both.joint, both.independent);
  });
});

// ---------------------------------------------------------------------------
// What may not sit together
// ---------------------------------------------------------------------------

describe('which legs may share a slip', () => {
  const sims = distribution();

  it('keeps two different pitchers at the same line apart', () => {
    /*
     * `conflicts` keyed on market type plus line, so two people quoted at 5.5
     * strikeouts read as two sides of one bet and the second was dropped. Two
     * players' anytime touchdown, both at 0.5, had the same problem.
     */
    const a = pitcher('A over 5.5', '1', 5.5, 0.6);
    const b = pitcher('B over 5.5', '2', 5.5, 0.55);

    assert.equal(conflicts(a, b), false);
    assert.equal(assembleSlip([a, b], sims).legs.length, 2);
  });

  it('still refuses the same pitcher twice on the same line', () => {
    const a = pitcher('A over 5.5', '1', 5.5, 0.6);
    const again = pitcher('A over 5.5 again', '1', 5.5, 0.6);
    assert.equal(conflicts(a, again), true);
  });

  it('allows the same pitcher at a different line to be a different bet', () => {
    assert.equal(
      conflicts(pitcher('A over 5.5', '1', 5.5, 0.6), pitcher('A over 6.5', '1', 6.5, 0.4)),
      false,
    );
  });

  it('refuses a player leg beside a scoreline leg from the same fixture', () => {
    /*
     * They are genuinely linked — a pitcher striking more batters out is a
     * pitcher conceding fewer runs — and the simulations cannot count the pair
     * because they contain no people. So the combination is refused rather than
     * multiplied, which is the same choice the one-leg-per-fixture rule makes
     * everywhere else evidence is missing.
     */
    const player = pitcher('A over 5.5', '1', 5.5, 0.6);
    assert.equal(unmeasurableTogether(player, homeWin), true);

    const slip = assembleSlip([homeWin, player], sims);
    assert.equal(slip.legs.length, 1);
    assert.equal(slip.dropped, 1);
    assert.equal(slip.dropped_reasons.length, 1);
    assert.match(slip.dropped_reasons[0], /has not been measured/);
  });

  it('says why a leg was dropped rather than only counting it', () => {
    const a = pitcher('A over 5.5', '1', 5.5, 0.6);
    const slip = assembleSlip([a, pitcher('A again', '1', 5.5, 0.6)], sims);
    assert.equal(slip.dropped, 1);
    assert.match(slip.dropped_reasons[0], /same bet/);
  });
});

// ---------------------------------------------------------------------------
// The distinction underneath all of it
// ---------------------------------------------------------------------------

describe('what a simulated scoreline can be asked', () => {
  it('answers about the score and refuses everything else', () => {
    assert.equal(isCountable({ kind: 'winner', side: 'home' }), true);
    assert.equal(isCountable({ kind: 'total', direction: 'over', line: 8.5 }), true);
    assert.equal(isCountable({ kind: 'finish_position', entrant: 'A', within: 3 }), false);
    assert.equal(
      isCountable({
        kind: 'player_stat',
        athleteId: '1',
        player: 'A',
        stat: 'pitcher_strikeouts',
        statLabel: 'Strikeouts',
        direction: 'over',
        line: 5.5,
      }),
      false,
    );
  });
});
