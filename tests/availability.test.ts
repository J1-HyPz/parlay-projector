import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  availabilityFromSummary,
  isAbsent,
  isInDoubt,
} from '../lib/games/availability-normalise.ts';

/**
 * Shapes here are copied from real ESPN responses captured while building
 * this, not invented — including the placeholder strings, which are the whole
 * reason two of these tests exist.
 */
function summary(overrides: Record<string, unknown> = {}) {
  return {
    injuries: [
      {
        team: { id: '15' },
        injuries: [
          {
            status: '60-Day-IL',
            date: '2026-09-01T12:00Z',
            type: { name: 'INJURY_STATUS_60DAYIL', description: '60-day IL' },
            details: { type: 'Elbow', detail: 'Soreness', side: 'Right', returnDate: '2026-09-18' },
            athlete: {
              id: '111',
              displayName: 'Robert Suarez',
              position: { abbreviation: 'RP' },
            },
          },
        ],
      },
      { team: { id: '30' }, injuries: [] },
    ],
    header: {
      competitions: [
        {
          competitors: [
            {
              homeAway: 'home',
              team: { id: '15' },
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
            { homeAway: 'away', team: { id: '30' }, probables: [] },
          ],
        },
      ],
    },
    ...overrides,
  };
}

describe('fixture availability', () => {
  it('reads a fixture into per-team lists and probable starters', () => {
    const result = availabilityFromSummary(summary(), '15', '30');
    assert.ok(result);

    assert.equal(result.home.players.length, 1);
    const player = result.home.players[0];
    assert.equal(player.name, 'Robert Suarez');
    assert.equal(player.status, 'out', 'a 60-day list is not playing this fixture');
    assert.equal(player.provider_status, '60-day IL', "the provider's own precision is kept");
    assert.equal(player.detail, 'Right Elbow — Soreness');
    assert.equal(player.expected_return, '2026-09-18');

    assert.equal(result.probables.home[0].name, 'Martin Perez');
    assert.equal(result.probables.home[0].role, 'Probable Starting Pitcher');
    assert.equal(result.probables.away.length, 0);
  });

  it('separates "no data published" from "nobody is missing"', () => {
    /*
     * The distinction the whole feature turns on. Football sends no `injuries`
     * key at all; a covered fixture with a healthy squad sends an empty list.
     * Reading the first as the second would tell a reader that a Premier
     * League side has a clean bill of health, which nothing has established.
     */
    assert.equal(availabilityFromSummary({ header: {} }, '1', '2'), null);

    const covered = availabilityFromSummary(summary(), '15', '30');
    assert.ok(covered);
    assert.deepEqual(covered.away.players, [], 'covered, and reporting nobody');
  });

  it('drops the provider placeholder instead of reading it out', () => {
    // Real entry: side and detail are both the literal "Not Specified", which
    // joined naively produces "Not Specified Groin — Not Specified".
    const payload = summary({
      injuries: [
        {
          team: { id: '15' },
          injuries: [
            {
              type: { name: 'INJURY_STATUS_OUT', description: 'Out' },
              details: { type: 'Groin', detail: 'Not Specified', side: 'Not Specified' },
              athlete: { id: '1', displayName: 'A Player' },
            },
          ],
        },
      ],
    });

    assert.equal(availabilityFromSummary(payload, '15', '30')?.home.players[0].detail, 'Groin');
  });

  it('keeps "Undisclosed", which is a report and not a placeholder', () => {
    // Eighty occurrences across the four covered leagues. It is the team
    // declining to say, which is information the reader should have.
    const payload = summary({
      injuries: [
        {
          team: { id: '15' },
          injuries: [
            {
              type: { name: 'INJURY_STATUS_QUESTIONABLE', description: 'Questionable' },
              details: { type: 'Undisclosed', detail: 'Not Specified', side: 'Not Specified' },
              athlete: { id: '1', displayName: 'A Player' },
            },
          ],
        },
      ],
    });

    assert.equal(
      availabilityFromSummary(payload, '15', '30')?.home.players[0].detail,
      'Undisclosed',
    );
  });

  it('keys status on the machine enum, not the free-text label', () => {
    // Baseball sends "suspension", hockey sends "Suspension". Switching on
    // that text would classify one of them and miss the other.
    for (const status of ['suspension', 'Suspension']) {
      const payload = summary({
        injuries: [
          {
            team: { id: '15' },
            injuries: [
              {
                status,
                type: { name: 'INJURY_STATUS_SUSPENSION', description: 'Suspension' },
                athlete: { id: '1', displayName: 'A Player' },
              },
            ],
          },
        ],
      });
      assert.equal(availabilityFromSummary(payload, '15', '30')?.home.players[0].status, 'suspended');
    }
  });

  it('keeps an unrecognised status rather than guessing at it', () => {
    const payload = summary({
      injuries: [
        {
          team: { id: '15' },
          injuries: [
            {
              status: 'Rehab Assignment',
              type: { name: 'INJURY_STATUS_SOMETHING_NEW', description: 'Rehab' },
              athlete: { id: '1', displayName: 'A Player' },
            },
          ],
        },
      ],
    });

    const player = availabilityFromSummary(payload, '15', '30')?.home.players[0];
    assert.equal(player?.status, 'listed', 'neither out nor available is established');
    assert.equal(player?.provider_status, 'Rehab', "so the provider's own word carries it");
  });

  it('does not treat a listed-but-playing player as an absence', () => {
    // The NFL's report is mostly this: 519 of 800 entries were ACTIVE.
    // Counting them as absences would overstate every squad's problems.
    const payload = summary({
      injuries: [
        {
          team: { id: '15' },
          injuries: [
            {
              type: { name: 'INJURY_STATUS_ACTIVE', description: 'Active' },
              athlete: { id: '1', displayName: 'A Player' },
            },
          ],
        },
      ],
    });

    const player = availabilityFromSummary(payload, '15', '30')?.home.players[0];
    assert.equal(player?.status, 'available');
    assert.equal(isAbsent('available'), false);
    assert.equal(isInDoubt('available'), false);
  });

  it('orders the worst news first', () => {
    const entry = (name: string, typeName: string) => ({
      type: { name: typeName, description: typeName },
      athlete: { id: name, displayName: name },
    });

    const payload = summary({
      injuries: [
        {
          team: { id: '15' },
          injuries: [
            entry('Fit', 'INJURY_STATUS_ACTIVE'),
            entry('Maybe', 'INJURY_STATUS_QUESTIONABLE'),
            entry('Gone', 'INJURY_STATUS_OUT'),
          ],
        },
      ],
    });

    assert.deepEqual(
      availabilityFromSummary(payload, '15', '30')?.home.players.map((p) => p.name),
      ['Gone', 'Maybe', 'Fit'],
    );
  });

  it('never attributes an absence to the wrong side', () => {
    // Ids that match neither competitor yield empty lists. Showing a team the
    // opponent's injuries is worse than showing it none.
    const result = availabilityFromSummary(summary(), 'unknown-a', 'unknown-b');
    assert.ok(result);
    assert.deepEqual(result.home.players, []);
    assert.deepEqual(result.away.players, []);
  });

  it('skips an entry with no named player', () => {
    const payload = summary({
      injuries: [
        {
          team: { id: '15' },
          injuries: [{ type: { name: 'INJURY_STATUS_OUT' }, athlete: { id: '9' } }],
        },
      ],
    });
    assert.deepEqual(availabilityFromSummary(payload, '15', '30')?.home.players, []);
  });
});
