#!/usr/bin/env node
/**
 * Does our odds provider quote player props we can actually use?
 *
 * The documentation says coverage is "mainly limited to US sports and US
 * bookmakers", and the UK bookmaker list carries no stated player-prop
 * coverage. That is a strong hint and not a measurement, and this application
 * does not build on hints — so this asks the provider directly and prints what
 * comes back.
 *
 *   node scripts/measure-player-props.mjs            # uk, both sports
 *   node scripts/measure-player-props.mjs us         # for comparison
 *   node scripts/measure-player-props.mjs uk,us      # both regions at once
 *   node scripts/measure-player-props.mjs uk mlb     # one sport only
 *
 * **Baseball is the one that matters.** The pilot market is a starting
 * pitcher's strikeouts, chosen because a pitcher is the only individual the
 * stats provider actually announces before a fixture. American football is
 * measured alongside it because its model is already built and waiting on
 * exactly this answer.
 *
 * The key is read from ODDS_API_KEY and never printed, and no URL is logged
 * either, because the provider takes the key in the query string. Put it in a
 * local `.env` (which is gitignored) or set it for one command:
 *
 *   ODDS_API_KEY=... node scripts/measure-player-props.mjs
 *
 * WHAT IT COSTS. The provider charges markets-returned x regions *per event*,
 * and charges nothing for a market it does not return. So if the answer is
 * "the UK books quote none of this", this costs one credit per sport for the
 * event list and nothing for the events themselves. It reads at most three
 * fixtures per sport.
 */

import { readFileSync } from 'node:fs';

const BASE = 'https://api.the-odds-api.com/v4';

/**
 * The markets each sport's model can actually price.
 *
 * Kept in step with `MARKETS_BY_LEAGUE` in lib/odds/player-props.ts. Asking for
 * more would cost nothing, and would tell us about markets this application
 * must not appear to have an opinion on.
 */
const SPORTS = {
  mlb: {
    key: 'baseball_mlb',
    label: 'MLB — the pilot',
    markets: ['pitcher_strikeouts'],
  },
  nfl: {
    key: 'americanfootball_nfl',
    label: 'NFL — built, gated off pending this',
    markets: [
      'player_pass_yds',
      'player_pass_tds',
      'player_rush_yds',
      'player_reception_yds',
      'player_receptions',
      'player_anytime_td',
    ],
  },
};

/** Fixtures inspected. Enough to tell coverage from one odd fixture. */
const MAX_EVENTS = 3;

/** Read the key from the environment, falling back to a local .env file. */
function apiKey() {
  if (process.env.ODDS_API_KEY) return process.env.ODDS_API_KEY.trim();
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const match = /^\s*ODDS_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
      if (match) return match[1].replace(/^["']|["']$/g, '');
    }
  } catch {
    // No .env, which is the normal case.
  }
  return '';
}

const KEY = apiKey();
if (!KEY) {
  console.error(
    'No ODDS_API_KEY found.\n' +
      'Set it for one command, or put it in a local .env file (gitignored):\n' +
      '  ODDS_API_KEY=... node scripts/measure-player-props.mjs',
  );
  process.exit(2);
}

/** Quota, which the provider reports on every priced call. */
function quota(response) {
  return {
    remaining: response.headers.get('x-requests-remaining'),
    used: response.headers.get('x-requests-used'),
    last: response.headers.get('x-requests-last'),
  };
}

async function get(path, params) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('apiKey', KEY);

  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    // The path only — the key travels in the query string.
    const body = await response.text();
    throw new Error(`${path} -> HTTP ${response.status}: ${body.slice(0, 200)}`);
  }
  return { body: await response.json(), quota: quota(response) };
}

const regions = (process.argv[2] ?? 'uk').trim();
const wanted = (process.argv[3] ?? '').trim();
const sports = wanted ? [wanted] : Object.keys(SPORTS);

for (const name of sports) {
  if (!SPORTS[name]) {
    console.error(`Unknown sport "${name}". Known: ${Object.keys(SPORTS).join(', ')}`);
    process.exit(2);
  }
}

console.log(`Region(s): ${regions}\n`);

let lastQuota = null;

for (const name of sports) {
  const sport = SPORTS[name];
  console.log(`=== ${sport.label} ===`);
  console.log(`Markets asked for: ${sport.markets.join(', ')}`);

  let events;
  try {
    const result = await get(`/sports/${sport.key}/events`, {});
    events = result.body;
    lastQuota = result.quota;
    console.log(`Upcoming fixtures: ${events.length}  (quota left: ${result.quota.remaining})`);
  } catch (error) {
    console.log(`  could not list events: ${error.message}\n`);
    continue;
  }

  if (events.length === 0) {
    console.log('  no upcoming fixtures to ask about — try again closer to a game week.\n');
    continue;
  }

  const marketsSeen = new Map();
  const booksSeen = new Set();

  for (const event of events.slice(0, MAX_EVENTS)) {
    const label = `${event.away_team} at ${event.home_team}`;
    let result;
    try {
      result = await get(`/sports/${sport.key}/events/${event.id}/odds`, {
        regions,
        markets: sport.markets.join(','),
        oddsFormat: 'decimal',
      });
    } catch (error) {
      console.log(`\n  ${label}\n    request failed: ${error.message}`);
      continue;
    }

    lastQuota = result.quota;
    const books = result.body.bookmakers ?? [];
    console.log(`\n  ${label}`);
    console.log(`    bookmakers returning anything: ${books.length}`);

    for (const book of books) {
      booksSeen.add(book.title ?? book.key);
      for (const market of book.markets ?? []) {
        const outcomes = market.outcomes ?? [];
        marketsSeen.set(market.key, (marketsSeen.get(market.key) ?? 0) + outcomes.length);

        // One real example, so the shape is visible rather than described.
        const sample = outcomes[0];
        if (sample) {
          console.log(
            `      ${book.title}: ${market.key} — ` +
              `${sample.description ?? sample.name} ${sample.name ?? ''} ` +
              `${sample.point ?? ''} @ ${sample.price}`,
          );
        }
      }
    }
    if (books.length === 0) console.log('      (no bookmaker quoted any of these markets)');
  }

  console.log(`\n  --- ${name} result ---`);
  if (marketsSeen.size === 0) {
    console.log(`  No player markets returned for region "${regions}".`);
    console.log('  Charged nothing for them: the provider bills markets *returned*.');
  } else {
    console.log(`  Player markets returned for region "${regions}":`);
    for (const [key, outcomes] of [...marketsSeen].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`    ${key.padEnd(24)} ${outcomes} outcomes across the fixtures read`);
    }
    console.log(`  Bookmakers quoting them: ${[...booksSeen].join(', ')}`);
  }
  console.log();
}

if (lastQuota) {
  console.log(
    `Quota: ${lastQuota.remaining} remaining, ${lastQuota.used} used, ` +
      `last call cost ${lastQuota.last}.`,
  );
}

console.log(
  '\nWhat to do with this:\n' +
    '  - markets returned for uk  -> nothing to change; they are already live.\n' +
    '  - nothing for uk, some for us -> set ODDS_API_PLAYER_REGION=us. That moves\n' +
    '    player props only; the match markets stay on UK books.\n' +
    '  - nothing anywhere -> player selections stay unverified analysis, which is\n' +
    '    what they are built to be. The projections still show on a fixture page.',
);
