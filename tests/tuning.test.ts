import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PUBLIC_TEST_KEY,
  resolveTuning,
  tuningFor,
  tuningProfileFor,
} from '../lib/tuning.ts';

describe('tuning profile selection', () => {
  it('treats the public test key as the throttled profile', () => {
    assert.equal(tuningProfileFor(PUBLIC_TEST_KEY), 'test-key');
    assert.equal(tuningProfileFor('3'), 'test-key');
  });

  it('treats an absent key as throttled, not optimistically premium', () => {
    // No key means the app falls back to the test key, so it must not assume
    // premium limits it does not have.
    assert.equal(tuningProfileFor(''), 'test-key');
    assert.equal(tuningProfileFor('   '), 'test-key');
    assert.equal(tuningProfileFor(null), 'test-key');
    assert.equal(tuningProfileFor(undefined), 'test-key');
  });

  it('treats any other key as premium', () => {
    assert.equal(tuningProfileFor('1234567890'), 'premium');
    assert.equal(tuningProfileFor('  abc123  '), 'premium');
  });
});

describe('tuning values', () => {
  const test = tuningFor('test-key');
  const premium = tuningFor('premium');

  it('keeps the measured safe limits on the test key', () => {
    // 4 was measured as the ceiling before the test key starts returning 429s.
    assert.equal(test.scheduleConcurrency, 4);
    assert.equal(test.scheduleTtlSeconds, 900);
    assert.equal(test.todayCacheSeconds, 120);
  });

  it('raises concurrency and lowers cache lifetimes on a premium key', () => {
    assert.ok(
      premium.scheduleConcurrency > test.scheduleConcurrency,
      'premium must fetch more in parallel',
    );
    assert.ok(
      premium.scheduleTtlSeconds < test.scheduleTtlSeconds,
      'premium can refresh the schedule more often',
    );
    assert.ok(
      premium.todayCacheSeconds < test.todayCacheSeconds,
      "premium can refresh today's fixtures more often",
    );
  });

  it('stays within sane bounds rather than assuming unlimited quota', () => {
    // A paid tier still has limits; the defaults are a meaningful improvement,
    // not a maximal one.
    assert.ok(premium.scheduleConcurrency <= 16, 'concurrency must stay moderate');
    assert.ok(premium.scheduleTtlSeconds >= 60, 'cache must not effectively disable itself');
    assert.ok(premium.todayCacheSeconds >= 30);
  });

  it('reports the profile it produced', () => {
    assert.equal(test.profile, 'test-key');
    assert.equal(premium.profile, 'premium');
  });
});

describe('resolveTuning', () => {
  it('goes from key straight to values', () => {
    assert.equal(resolveTuning('3').scheduleConcurrency, 4);
    assert.equal(resolveTuning('a-real-key').scheduleConcurrency, 10);
  });

  it('never returns a zero or negative concurrency', () => {
    for (const key of ['3', '', 'real-key', null]) {
      assert.ok(resolveTuning(key).scheduleConcurrency >= 1, `bad concurrency for ${key}`);
    }
  });
});
