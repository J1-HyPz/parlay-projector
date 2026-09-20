/**
 * What a competition publishes, and what it merely failed to deliver.
 *
 * Three hubs reported "unable to load fighters right now" about a competitor
 * list that is never published: the UFC and both tennis tours answer their
 * team endpoint with an empty array, and the service collapsed that into the
 * same `null` a timeout produces. A reader cannot act on the difference if the
 * application cannot state it, and a fault that will never clear is the worse
 * of the two things to claim.
 *
 * These guard the catalogue's own record of coverage, which is what every
 * such message is now derived from.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LEAGUES, findLeague } from '../lib/leagues/registry.ts';

describe('the catalogue records what is published', () => {
  it('answers for every competition, one way or the other', () => {
    // A missing flag would read as `undefined` and behave as "not published",
    // which would silently hide a section that works.
    for (const league of LEAGUES) {
      assert.equal(
        typeof league.hasTeams,
        'boolean',
        `${league.id} does not say whether a competitor list is published`,
      );
    }
  });

  it('knows the three competitions that publish no competitor list', () => {
    // Measured against the provider, not inferred from the sport: each of
    // these answers 200 with an empty `teams` array.
    for (const id of ['ufc', 'atp', 'wta']) {
      assert.equal(findLeague(id)?.hasTeams, false, `${id} should publish no list`);
    }
  });

  it('keeps Formula 1 listed, because its drivers come off the championship', () => {
    // No teams endpoint at all, but the hub still has competitors to show —
    // which is why this is a separate flag from `hasStandings`.
    const f1 = findLeague('f1');
    assert.equal(f1?.hasTeams, true);
    assert.equal(f1?.hasStandings, true);
  });

  it('does not confuse a thin tier with an absent feed', () => {
    /*
     * The CFL, the AFLE and the EFA return nothing for teams and standings on
     * the public provider key, and that is a credentials limit rather than a
     * competition that publishes none. They stay listed so the failure keeps
     * reporting as a failure — which is the honest answer and the one that
     * changes when a real key is set.
     */
    for (const id of ['cfl', 'afle', 'efa']) {
      assert.equal(findLeague(id)?.hasTeams, true, `${id} should still claim a list`);
    }
  });

  it('separates a competitor list from a table', () => {
    // The two absences are independent: the UFC publishes neither, Formula 1
    // publishes both, and the AFLE publishes competitors but no table.
    const afle = findLeague('afle');
    assert.equal(afle?.hasTeams, true);
    assert.equal(afle?.hasStandings, false);
  });
});
