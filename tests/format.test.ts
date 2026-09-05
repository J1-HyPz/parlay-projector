/**
 * Turning a probability into something a person reads.
 *
 * One function, because there used to be two conventions and the homepage
 * picked the wrong one: the accuracy widget printed the stored fraction with a
 * `%` after it, so a model settling at 76.5% was shown as `0.8%` and the ring
 * beside it drew a sliver. The figure was right the whole time — only the last
 * step was wrong, which is exactly the kind of bug that survives a check of the
 * API.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { percent, signedPercent } from '../lib/utils.ts';

describe('formatting a probability', () => {
  it('reads a fraction as a percentage', () => {
    assert.equal(percent(0.7647, 1), '76.5%');
    assert.equal(percent(0.75), '75%');
    assert.equal(percent(1), '100%');
    assert.equal(percent(0), '0%');
  });

  it('never prints the fraction itself', () => {
    // The regression, stated as the thing it must not do.
    assert.notEqual(percent(0.7647, 1), '0.8%');
    assert.notEqual(percent(0.75, 1), '0.8%');
  });

  it('keeps a small but real figure visible', () => {
    // A genuinely poor model reads as 0.8%, and must still be distinguishable
    // from a good one that was formatted wrongly.
    assert.equal(percent(0.008, 1), '0.8%');
  });

  it('signs a difference, because the direction is the point', () => {
    assert.equal(signedPercent(0.0339), '+3.4%');
    assert.equal(signedPercent(-0.1729), '−17.3%');
    assert.equal(signedPercent(0), '+0.0%');
  });
});
