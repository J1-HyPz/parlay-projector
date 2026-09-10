import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  fixtureAvailability,
  isAbsent,
  isInDoubt,
  playersFrom,
  probablesFromSummary,
} from '../lib/games/availability-normalise.ts';
import type { PlayerAvailability } from '../lib/games/availability-normalise.ts';

/**
 * Shapes here are copied from real ESPN responses captured while building
 * this, not invented — including the placeholder strings and the differing
 * team-id positions, which are the reason several of these tests exist.
 */
function entry(overrides: Record<string, unknown> = {}) {
  return {
    status: '60-Day-IL',
    date: '2026-09-01T12:00Z',
    type: { name: 'INJURY_STATUS_60DAYIL', description: '60-day IL' },
    details: { type: 'Elbow', detail: 'Soreness', side: 'Right', returnDate: '2026-09-18' },
    athlete: { id: '111', displayName: 'Robert Suarez', position: { abbreviation: 'RP' } },
    ...overrides,
  };
}

function only(raw: unknown[]): PlayerAvailability {
  const players = playersFrom(raw);
  assert.equal(players.length, 1, 'expected exactly one usable entry');
  return players[0];
}

describe('player availability', () => {
  it('reads an entry into the fields a reader sees', () => {
    const player = only([entry()]);
    assert.equal(player.name, 'Robert Suarez');
    assert.equal(player.position, 'RP');
    assert.equal(player.status, 'out', 'a 60-day list is not playing this fixture');
    assert.equal(player.provider_status, '60-day IL', "the provider's own precision is kept");
    assert.equal(player.detail, 'Right Elbow — Soreness');
    assert.equal(player.expected_return, '2026-09-18');
  });

  it('drops the provider placeholder instead of reading it out', () => {
    // Real entry: side and detail are both the literal "Not Specified", which
    // joined naively produces "Not Specified Groin — Not Specified".
    const player = only([
      entry({
        type: { name: 'INJURY_STATUS_OUT', description: 'Out' },
        details: { type: 'Groin', detail: 'Not Specified', side: 'Not Specified' },
      }),
    ]);
    assert.equal(player.detail, 'Groin');
  });

  it('keeps "Undisclosed", which is a report and not a placeholder', () => {
    // Eighty occurrences across the four covered leagues. It is the team
    // declining to say, which is information the reader should have.
    const player = only([
      entry({
        type: { name: 'INJURY_STATUS_QUESTIONABLE', description: 'Questionable' },
        details: { type: 'Undisclosed', detail: 'Not Specified', side: 'Not Specified' },
      }),
    ]);
    assert.equal(player.detail, 'Undisclosed');
  });

  it('keys status on the machine enum, not the free-text label', () => {
    // Baseball sends "suspension", hockey sends "Suspension". Switching on
    // that text would classify one of them and miss the other.
    for (const status of ['suspension', 'Suspension']) {
      const player = only([
        entry({ status, type: { name: 'INJURY_STATUS_SUSPENSION', description: 'Suspension' } }),
      ]);
      assert.equal(player.status, 'suspended');
    }
  });

  it('keeps an unrecognised status rather than guessing at it', () => {
    const player = only([
      entry({
        status: 'Rehab Assignment',
        type: { name: 'INJURY_STATUS_SOMETHING_NEW', description: 'Rehab' },
      }),
    ]);
    assert.equal(player.status, 'listed', 'neither out nor available is established');
    assert.equal(player.provider_status, 'Rehab', "so the provider's own word carries it");
  });

  it('does not treat a listed-but-playing player as an absence', () => {
    // The NFL's report is mostly this: 519 of 800 entries were ACTIVE.
    // Counting them as absences would overstate every squad's problems.
    const player = only([
      entry({ type: { name: 'INJURY_STATUS_ACTIVE', description: 'Active' } }),
    ]);
    assert.equal(player.status, 'available');
    assert.equal(isAbsent('available'), false);
    assert.equal(isInDoubt('available'), false);
  });

  it('orders the worst news first', () => {
    const named = (name: string, typeName: string) =>
      entry({
        type: { name: typeName, description: typeName },
        athlete: { id: name, displayName: name },
      });

    assert.deepEqual(
      playersFrom([
        named('Fit', 'INJURY_STATUS_ACTIVE'),
        named('Maybe', 'INJURY_STATUS_QUESTIONABLE'),
        named('Gone', 'INJURY_STATUS_OUT'),
      ]).map((player) => player.name),
      ['Gone', 'Maybe', 'Fit'],
    );
  });

  it('skips an entry with no named player', () => {
    assert.deepEqual(playersFrom([entry({ athlete: { id: '9' } })]), []);
  });

  it('treats a non-array as nothing rather than throwing', () => {
    assert.deepEqual(playersFrom(undefined), []);
    assert.deepEqual(playersFrom({ injuries: [] }), []);
  });
});

describe('fixture availability', () => {
  const probables = { home: [], away: [] };

  it('separates "no data published" from "nobody is missing"', () => {
    /*
     * The distinction the whole feature turns on. A competition the provider
     * does not cover yields a null report; a covered fixture with a healthy
     * squad yields a team the report simply does not name. Reading the first
     * as the second would tell a reader a Premier League side has a clean bill
     * of health, which nothing has established.
     */
    assert.equal(fixtureAvailability(null, probables, '15', '30'), null);

    const covered = fixtureAvailability(new Map([['15', []]]), probables, '15', '30');
    assert.ok(covered);
    assert.deepEqual(covered.away.players, [], 'covered, and reporting nobody');
  });

  it('never attributes an absence to the wrong side', () => {
    // Ids matching neither side yield empty lists. Showing a club the
    // opponent's injuries is worse than showing it none.
    const report = new Map([['15', playersFrom([entry()])]]);

    const right = fixtureAvailability(report, probables, '15', '30');
    assert.equal(right?.home.players.length, 1);
    assert.equal(right?.away.players.length, 0);

    const wrong = fixtureAvailability(report, probables, 'unknown-a', 'unknown-b');
    assert.deepEqual(wrong?.home.players, []);
    assert.deepEqual(wrong?.away.players, []);
  });

  it('reads probable starters from the summary', () => {
    const found = probablesFromSummary({
      header: {
        competitions: [
          {
            competitors: [
              {
                homeAway: 'home',
                probables: [
                  {
                    displayName: 'Probable Starting Pitcher',
                    athlete: {
                      id: '222',
                      displayName: 'Martin Perez',
                      position: { abbreviation: 'SP' },
                    },
                  },
                ],
              },
              { homeAway: 'away', probables: [] },
            ],
          },
        ],
      },
    });

    assert.equal(found.home[0].name, 'Martin Perez');
    // The provider's word is "probable", and nothing upgrades it to confirmed.
    assert.equal(found.home[0].role, 'Probable Starting Pitcher');
    assert.deepEqual(found.away, []);
  });

  it('reports no starters rather than failing when the summary has none', () => {
    assert.deepEqual(probablesFromSummary(null), { home: [], away: [] });
    assert.deepEqual(probablesFromSummary({ header: {} }), { home: [], away: [] });
  });
});
