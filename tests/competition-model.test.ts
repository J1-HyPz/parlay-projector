/**
 * A competition's model, and the threshold that decides whether it says
 * anything at all.
 *
 * NCAA Football produced no projection for any fixture for the first third of
 * every season, and two separate causes were behind it. Its data-quality
 * threshold was calibrated against a sample its own rating window can never
 * reach, so the floor was unclearable; and the game detail page asked for the
 * model by *sport*, which cannot tell college football from the NFL because
 * they share a sport id — so where a projection did appear, the page and the
 * parlay build were quietly using different parameters for it.
 *
 * These guard both, and the arithmetic of the threshold, which is the part
 * that will drift silently if `targetGames` is ever changed again.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  modelConfigFor,
  modelConfigForLeague,
} from '../lib/projections/config.ts';
import { dataQuality, gamesNeeded } from '../lib/projections/features.ts';
import { MIN_DATA_QUALITY } from '../lib/projections/types.ts';
import type { TeamRating } from '../lib/projections/features';

/** A side with `games` completed games and nothing else notable. */
function side(games: number): TeamRating {
  return {
    team: 'Side',
    games,
    elo: 1500,
    attack: 25,
    defence: 25,
    adjustedAttack: 25,
    adjustedDefence: 25,
    scoreVariability: 10,
    // Null below eight games either way, which is what a split needs.
    homeAttack: null,
    awayAttack: null,
    lastPlayed: null,
    recentForm: [],
  };
}

const NONE = { hasStandings: false, hasHeadToHead: false };

describe('a competition can have its own model', () => {
  const bySport = modelConfigFor('nfl')!;
  const ncaaf = modelConfigForLeague('ncaaf', 'nfl')!;
  const cfl = modelConfigForLeague('cfl', 'nfl')!;

  it('is not the sport default, for the competitions that were fitted', () => {
    // Four competitions share the `nfl` sport id and none of them score
    // alike. Asking by sport is what made the detail page project a college
    // fixture at the NFL's baseline while the parlay build used NCAAF's.
    assert.notEqual(ncaaf.baselineTotal, bySport.baselineTotal);
    assert.notEqual(ncaaf.homeAdvantage, bySport.homeAdvantage);
    assert.notEqual(cfl.baselineTotal, bySport.baselineTotal);
  });

  it('falls back to the sport where a competition was not fitted', () => {
    assert.equal(modelConfigForLeague('nfl', 'nfl'), bySport);
  });
});

describe('how much history a projection needs', () => {
  it('is the count that first clears the floor, never below the minimum', () => {
    for (const config of [
      modelConfigForLeague('ncaaf', 'nfl')!,
      modelConfigFor('nfl')!,
      modelConfigFor('nba')!,
      modelConfigFor('football')!,
    ]) {
      const needed = gamesNeeded(config);

      // Clears at the stated count...
      assert.ok(
        dataQuality(side(needed), side(needed), config, NONE) >=
          MIN_DATA_QUALITY,
        `${needed} games should clear the floor`,
      );
      // ...and does not, one game short. Anything else means the sentence the
      // game page prints is telling a reader the wrong number.
      assert.ok(
        dataQuality(side(needed - 1), side(needed - 1), config, NONE) <
          MIN_DATA_QUALITY,
        `${needed - 1} games should not clear the floor`,
      );
    }
  });

  it('is driven by the weaker side, not the pair', () => {
    const config = modelConfigForLeague('ncaaf', 'nfl')!;
    const needed = gamesNeeded(config);
    assert.equal(
      dataQuality(side(30), side(needed - 1), config, NONE),
      0,
      'one side short of the minimum is a fixture with no projection',
    );
  });
});

describe('college football in September', () => {
  const config = modelConfigForLeague('ncaaf', 'nfl')!;

  it('reaches the floor on the sample its own window holds', () => {
    /*
     * A 300-day window's tail is bowl season, not a full previous campaign,
     * so a college side holds about four in-window games in September. Under
     * the NFL's `targetGames` of 12 that scored 0.25 against a floor of 0.35
     * and the whole competition went dark until late October.
     */
    const quality = dataQuality(side(4), side(4), config, NONE);
    assert.ok(quality >= MIN_DATA_QUALITY, `four games scored ${quality}`);
  });

  it('still says the projection is a thin one', () => {
    // Clearing the floor is not the same as being trusted. Four games must
    // stay below every risk profile's gate, so such a fixture is shown on its
    // own page and cannot become a parlay leg.
    const quality = dataQuality(side(4), side(4), config, NONE);
    assert.ok(quality < 0.45, `four games scored ${quality}`);
  });

  it('does not reach the floor on the sample the window cannot hold', () => {
    // Three games is below `minGames`, and that boundary has not moved.
    assert.equal(dataQuality(side(3), side(4), config, NONE), 0);
  });
});
