import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectTransitions, eventFor } from '../lib/notify/transitions.ts';
import {
  MAX_CONTENT,
  buildPayloads,
  escapeMarkdown,
  formatLine,
} from '../lib/notify/messages.ts';
import { parseState } from '../lib/notify/state-parse.ts';
import type { GameNotification, NotifyState } from '../lib/notify/types.ts';
import type { Game, GameStatus } from '../lib/home/types.ts';

const TODAY = '2026-09-02';

function game(id: string, status: GameStatus, overrides: Partial<Game> = {}): Game {
  return {
    id,
    sport: 'football',
    league: 'Premier League',
    league_badge: null,
    season: '2026',
    round: '3',
    start_time: `${TODAY}T14:00:00.000Z`,
    status,
    provider_status: null,
    home_team: { id: '1', name: 'Arsenal', logo: null },
    away_team: { id: '2', name: 'Chelsea', logo: null },
    venue: { name: 'Emirates', city: 'London', country: 'England' },
    broadcast: null,
    ...overrides,
  };
}

function state(statuses: Record<string, GameStatus>, date = TODAY): NotifyState {
  return { date, statuses };
}

describe('transition rules', () => {
  it('announces the forward transitions', () => {
    assert.equal(eventFor('scheduled', 'live'), 'kickoff');
    assert.equal(eventFor('live', 'finished'), 'final');
    assert.equal(eventFor('scheduled', 'finished'), 'final');
    assert.equal(eventFor('scheduled', 'postponed'), 'postponed');
    assert.equal(eventFor('live', 'cancelled'), 'cancelled');
  });

  it('says nothing when the status is unchanged', () => {
    for (const status of ['scheduled', 'live', 'finished'] as const) {
      assert.equal(eventFor(status, status), null);
    }
  });

  it('treats a recovery from unknown as a correction, not news', () => {
    // A provider hiccup reporting `unknown` mid-game must not fire a second
    // kick-off message when it recovers.
    assert.equal(eventFor('unknown', 'live'), null);
    assert.equal(eventFor('unknown', 'finished'), null);
  });

  it('never announces going backwards', () => {
    assert.equal(eventFor('finished', 'live'), null);
    assert.equal(eventFor('live', 'scheduled'), null);
    assert.equal(eventFor('finished', 'scheduled'), null);
  });
});

describe('detecting transitions', () => {
  it('reports a kick-off and records the new status', () => {
    const { notifications, next } = detectTransitions(
      state({ g1: 'scheduled' }),
      [game('g1', 'live')],
      TODAY,
    );
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].event, 'kickoff');
    assert.equal(notifications[0].home, 'Arsenal');
    assert.equal(next.statuses.g1, 'live');
  });

  it('carries the score on a final, and only on a final', () => {
    const finished = game('g1', 'finished', { score: { home: 2, away: 1 } });
    const { notifications } = detectTransitions(state({ g1: 'live' }), [finished], TODAY);
    assert.deepEqual(notifications[0].score, { home: 2, away: 1 });

    const live = game('g2', 'live', { score: { home: 1, away: 0 } });
    const kickoff = detectTransitions(state({ g2: 'scheduled' }), [live], TODAY);
    assert.equal(kickoff.notifications[0].score, null, 'a kick-off has no score to report');
  });

  it('never announces a game it has not seen before', () => {
    // The cold-start case: after a redeploy every game is new, and announcing
    // them would replay an entire afternoon into the channel at once.
    const { notifications, next } = detectTransitions(
      null,
      [game('g1', 'live'), game('g2', 'finished')],
      TODAY,
    );
    assert.deepEqual(notifications, []);
    assert.deepEqual(next.statuses, { g1: 'live', g2: 'finished' });
  });

  it('discards yesterday, so a stale id cannot fire', () => {
    const { notifications, next } = detectTransitions(
      state({ g1: 'scheduled' }, '2026-09-01'),
      [game('g1', 'live')],
      TODAY,
    );
    assert.deepEqual(notifications, [], 'a new day starts from scratch');
    assert.equal(next.date, TODAY);
  });

  it('is not fooled by a game id that collides with Object.prototype', () => {
    const { notifications } = detectTransitions(state({}), [game('constructor', 'live')], TODAY);
    assert.deepEqual(notifications, []);
  });
});

describe('discord message formatting', () => {
  const base: GameNotification = {
    event: 'kickoff',
    gameId: 'espn-epl-1',
    league: 'Premier League',
    sport: 'football',
    home: 'Arsenal',
    away: 'Chelsea',
    score: null,
  };

  it('renders a kick-off', () => {
    assert.equal(
      formatLine(base),
      '⚽ **Kick-off** — Arsenal v Chelsea · Premier League',
    );
  });

  it('renders a final with the score', () => {
    const line = formatLine({ ...base, event: 'final', score: { home: 2, away: 1 } });
    assert.ok(line.includes('**Final**'));
    assert.ok(line.includes('Arsenal 2–1 Chelsea'));
  });

  it('links to the game only when a base URL is configured', () => {
    assert.equal(formatLine(base).includes('/games/'), false);
    const linked = formatLine(base, 'https://example.test/');
    assert.ok(linked.includes('<https://example.test/games/espn-epl-1>'), linked);
  });

  it('escapes markdown in provider-supplied names', () => {
    assert.equal(escapeMarkdown('Inter*Milan_FC'), 'Inter\\*Milan\\_FC');
    const line = formatLine({ ...base, home: '**Real** Madrid' });
    assert.ok(line.includes('\\*\\*Real\\*\\* Madrid'));
  });

  it('blocks mentions on every payload', () => {
    const [payload] = buildPayloads([{ ...base, home: '@everyone' }]);
    assert.deepEqual(payload.allowed_mentions, { parse: [] });
  });

  it('sends nothing for an empty list', () => {
    assert.deepEqual(buildPayloads([]), []);
  });

  it('batches many notifications into one message', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...base, gameId: `g${i}` }));
    const payloads = buildPayloads(many);
    assert.equal(payloads.length, 1, 'a busy poll should not flood the channel');
    assert.equal(payloads[0].content.split('\n').length, 12);
  });

  it('splits rather than exceeding the Discord content limit', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      ...base,
      gameId: `g${i}`,
      home: 'A'.repeat(40),
      away: 'B'.repeat(40),
    }));
    const payloads = buildPayloads(many);
    assert.ok(payloads.length > 1);
    for (const payload of payloads) {
      assert.ok(
        payload.content.length <= MAX_CONTENT,
        `${payload.content.length} > ${MAX_CONTENT}`,
      );
    }
  });

  it('truncates a single oversized line instead of failing', () => {
    const [payload] = buildPayloads([{ ...base, home: 'X'.repeat(4000) }]);
    assert.ok(payload.content.length <= MAX_CONTENT);
  });
});

describe('persisted state', () => {
  it('accepts a well-formed file', () => {
    assert.deepEqual(parseState({ date: TODAY, statuses: { g1: 'live' } }), {
      date: TODAY,
      statuses: { g1: 'live' },
    });
  });

  it('rejects anything unusable', () => {
    assert.equal(parseState(null), null);
    assert.equal(parseState('nonsense'), null);
    assert.equal(parseState({ statuses: {} }), null, 'a date is required');
    assert.equal(parseState({ date: '02-09-2026', statuses: {} }), null);
    assert.equal(parseState({ date: TODAY }), null);
  });

  it('drops entries that are not real statuses', () => {
    const parsed = parseState({ date: TODAY, statuses: { g1: 'live', g2: 'winning', g3: 7 } });
    assert.deepEqual(parsed, { date: TODAY, statuses: { g1: 'live' } });
  });
});
