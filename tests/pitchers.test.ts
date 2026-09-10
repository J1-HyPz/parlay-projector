import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MIN_STARTS,
  blendedDefence,
  parseInnings,
  rateBefore,
} from '../lib/projections/pitchers.ts';
import type { PitcherStart } from '../lib/projections/pitchers.ts';

const DAY = 86_400_000;
const T0 = Date.parse('2026-04-01T00:00:00.000Z');

function start(overrides: Partial<PitcherStart> = {}): PitcherStart {
  return {
    event_id: Math.random().toString(36).slice(2),
    date: T0,
    innings: 6,
    runs: 3,
    ...overrides,
  };
}

describe('innings pitched', () => {
  it('reads the provider notation as thirds, not as a decimal', () => {
    /*
     * The trap this test exists for. Baseball writes partial innings in thirds
     * after the point: 6.1 is six and one third. Read as an ordinary decimal
     * every fractional start is understated, and every rate built on it comes
     * out too high.
     */
    assert.equal(parseInnings('6.0'), 6);
    assert.equal(parseInnings('7'), 7);

    const third = parseInnings('6.1');
    assert.ok(third !== null && Math.abs(third - 6 - 1 / 3) < 1e-9, `got ${third}`);

    const twoThirds = parseInnings('6.2');
    assert.ok(twoThirds !== null && Math.abs(twoThirds - 6 - 2 / 3) < 1e-9, `got ${twoThirds}`);
  });

  it('refuses a value that is not innings rather than guessing', () => {
    // There is no such thing as .3 of an inning in this notation, so a value
    // carrying one is a shape this code does not understand.
    assert.equal(parseInnings('6.3'), null);
    assert.equal(parseInnings('6.75'), null);
    assert.equal(parseInnings('-'), null);
    assert.equal(parseInnings(''), null);
    assert.equal(parseInnings(undefined), null);
    assert.equal(parseInnings(null), null);
  });
});

describe('a pitcher rate as at a moment', () => {
  const evenly = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      start({ date: T0 + index * DAY, innings: 6, runs: 3 }),
    );

  it('uses only starts that finished before the cut-off', () => {
    /*
     * The look-ahead rule, which is the whole reason this is computed rather
     * than read off a season-to-date ERA. The later starts here are far worse,
     * and a rate that saw them would be visibly different.
     */
    const starts = [
      ...evenly(6),
      ...Array.from({ length: 6 }, (_, index) =>
        start({ date: T0 + (20 + index) * DAY, innings: 3, runs: 12 }),
      ),
    ];

    const early = rateBefore(starts, T0 + 10 * DAY);
    assert.ok(early);
    assert.equal(early.starts, 6);
    // Six starts of three runs in six innings is exactly 4.50 per nine.
    assert.ok(Math.abs(early.runs_per_nine - 4.5) < 1e-9, `got ${early.runs_per_nine}`);

    const late = rateBefore(starts, T0 + 40 * DAY);
    assert.ok(late);
    assert.equal(late.starts, 12);
    assert.ok(late.runs_per_nine > early.runs_per_nine, 'the bad run must move the rate');
  });

  it('excludes a start beginning at the cut-off itself', () => {
    // A fixture is not evidence about itself.
    const starts = [...evenly(MIN_STARTS), start({ date: T0 + 99 * DAY, innings: 1, runs: 9 })];
    const rate = rateBefore(starts, T0 + 99 * DAY);
    assert.equal(rate?.starts, MIN_STARTS);
  });

  it('produces nothing below the minimum-starts threshold', () => {
    // Below this the team's own defence rate is used, exactly as before this
    // feature existed — never a rate from two afternoons.
    assert.equal(rateBefore(evenly(MIN_STARTS - 1), T0 + 99 * DAY), null);
    assert.ok(rateBefore(evenly(MIN_STARTS), T0 + 99 * DAY));
  });

  it('produces nothing from appearances with no innings', () => {
    const starts = Array.from({ length: 8 }, (_, index) =>
      start({ date: T0 + index * DAY, innings: 0, runs: 0 }),
    );
    assert.equal(rateBefore(starts, T0 + 99 * DAY), null, 'no innings is no rate');
  });

  it('reports mean innings per start, which sets how much of a game it covers', () => {
    const rate = rateBefore(evenly(6), T0 + 10 * DAY);
    assert.ok(rate);
    assert.ok(Math.abs(rate.innings_per_start - 6) < 1e-9);
  });
});

describe('blending a starter into the team defence', () => {
  const league = 4.3;

  it('moves the rate toward the pitcher without replacing the team outright', () => {
    // A starter covering six of nine innings carries two thirds of the weight;
    // the bullpen is not this pitcher and the team rate stands in for it.
    const rate = { runs_per_nine: 2.7, innings_per_start: 6, starts: 20 };
    const blended = blendedDefence(rate, 4.5, league);

    assert.ok(blended < 4.5, 'a good starter must lower it');
    assert.ok(blended > 2.7, 'but never all the way to the pitcher alone');
    const expected = (6 / 9) * 2.7 + (1 / 3) * 4.5;
    assert.ok(Math.abs(blended - expected) < 1e-9, `got ${blended}`);
  });

  it('raises it for a poor starter, by the same arithmetic', () => {
    const rate = { runs_per_nine: 6.5, innings_per_start: 6, starts: 20 };
    assert.ok(blendedDefence(rate, 4.5, league) > 4.5);
  });

  it('clamps an extreme rate rather than projecting a scoreline nobody sees', () => {
    // Five starts can carry a figure that says more about the opposition faced
    // than about the pitcher.
    const absurd = { runs_per_nine: 0.1, innings_per_start: 9, starts: 5 };
    const blended = blendedDefence(absurd, 4.5, league);
    assert.ok(blended >= league * 0.5 - 1e-9, `clamped to the floor, got ${blended}`);

    const dreadful = { runs_per_nine: 40, innings_per_start: 9, starts: 5 };
    assert.ok(blendedDefence(dreadful, 4.5, league) <= league * 1.8 + 1e-9);
  });

  it('leans on the team rate when a starter goes only a short way', () => {
    const short = { runs_per_nine: 2.7, innings_per_start: 2, starts: 20 };
    const long = { runs_per_nine: 2.7, innings_per_start: 8, starts: 20 };
    // The same pitcher moves the number further the more of the game they
    // actually pitch, which is the point of weighting by innings at all.
    assert.ok(blendedDefence(short, 4.5, league) > blendedDefence(long, 4.5, league));
  });
});
