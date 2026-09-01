import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_SCHEDULE_DATES,
  addDays,
  dateInTimezone,
  gameDate,
  isWithinRange,
  scheduleRange,
} from '../lib/schedule/range.ts';
import {
  ALL_LEAGUES,
  applyFilters,
  availableLeagues,
  formatDateHeading,
  formatDayTab,
  formatKickoff,
  groupByDate,
  matchesSearch,
  separatorFor,
  summarise,
} from '../lib/schedule/filters.ts';
import { normaliseEvents, SPORT_DEFINITIONS } from '../lib/home/sports/normalise.ts';
import type { SportDefinition } from '../lib/home/sports/normalise.ts';
import type { Game } from '../lib/home/types';

const LONDON = 'Europe/London';

// ---------------------------------------------------------------------------
// Date range
// ---------------------------------------------------------------------------

describe('schedule date range', () => {
  const now = new Date('2026-09-01T12:00:00Z');

  it('covers today through today + 7, inclusive', () => {
    const range = scheduleRange(LONDON, now);
    assert.equal(range.start, '2026-09-01');
    assert.equal(range.end, '2026-09-08');
    assert.equal(range.dates.length, 8);
  });

  it('includes today and today + 7, and excludes today + 8', () => {
    const range = scheduleRange(LONDON, now);
    assert.ok(range.dates.includes('2026-09-01'), 'today must be included');
    assert.ok(range.dates.includes('2026-09-08'), 'today + 7 must be included');
    assert.equal(range.dates.includes('2026-09-09'), false, 'today + 8 must be excluded');
  });

  it('runs from the same weekday to the same weekday next week', () => {
    const range = scheduleRange(LONDON, now);
    const day = (d: string) =>
      new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(
        new Date(`${d}T00:00:00Z`),
      );
    assert.equal(day(range.start), day(range.end));
  });

  it('reports membership correctly', () => {
    const range = scheduleRange(LONDON, now);
    assert.equal(isWithinRange('2026-09-01', range), true);
    assert.equal(isWithinRange('2026-09-08', range), true);
    assert.equal(isWithinRange('2026-09-09', range), false);
    assert.equal(isWithinRange('2026-08-31', range), false);
  });

  it('never exceeds the maximum number of dates', () => {
    assert.equal(scheduleRange(LONDON, now, 365).dates.length, MAX_SCHEDULE_DATES);
    assert.equal(scheduleRange(LONDON, now, -5).dates.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Timezone boundaries - the case that silently breaks a schedule
// ---------------------------------------------------------------------------

describe('midnight boundary', () => {
  it('uses the London date, not the UTC date, just after midnight in BST', () => {
    // 00:30 Tuesday in London (BST, UTC+1) is still 23:30 Monday in UTC.
    const justAfterMidnight = new Date('2026-09-01T23:30:00Z');
    assert.equal(dateInTimezone(justAfterMidnight, 'UTC'), '2026-09-01');
    assert.equal(dateInTimezone(justAfterMidnight, LONDON), '2026-09-02');

    const range = scheduleRange(LONDON, justAfterMidnight);
    assert.equal(range.start, '2026-09-02', 'schedule must start on the London date');
    assert.equal(range.end, '2026-09-09');
  });

  it('does not become Monday to Monday for a user already on Tuesday', () => {
    const range = scheduleRange(LONDON, new Date('2026-09-01T23:30:00Z'));
    const weekday = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      timeZone: 'UTC',
    }).format(new Date(`${range.start}T00:00:00Z`));
    assert.equal(weekday, 'Wednesday');
  });

  it('uses the UTC date just before midnight in London during GMT', () => {
    // In January London is UTC+0, so the two agree.
    const winter = new Date('2026-01-15T23:30:00Z');
    assert.equal(dateInTimezone(winter, LONDON), '2026-01-15');
  });

  it('adds days without drifting across a DST transition', () => {
    // BST ends on 25 October 2026.
    assert.equal(addDays('2026-10-24', 1), '2026-10-25');
    assert.equal(addDays('2026-10-25', 1), '2026-10-26');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  });

  it('files a late kick-off under the London day, not the UTC day', () => {
    // 00:30 BST on 2 September is 23:30Z on 1 September.
    assert.equal(gameDate('2026-09-01T23:30:00.000Z', LONDON), '2026-09-02');
    assert.equal(gameDate('2026-09-01T23:30:00.000Z', 'UTC'), '2026-09-01');
    assert.equal(gameDate(null, LONDON), null);
    assert.equal(gameDate('nonsense', LONDON), null);
  });
});

// ---------------------------------------------------------------------------
// Game normalisation reused from the Home page service
// ---------------------------------------------------------------------------

const soccer = SPORT_DEFINITIONS.find((d) => d.id === 'football') as SportDefinition;
const nfl = SPORT_DEFINITIONS.find((d) => d.id === 'nfl') as SportDefinition;

function raw(overrides: Record<string, unknown> = {}) {
  return {
    idEvent: '1',
    strSport: 'Soccer',
    strLeague: 'Premier League',
    strSeason: '2026',
    intRound: '4',
    strHomeTeam: 'Arsenal',
    strAwayTeam: 'Tottenham',
    idHomeTeam: '133604',
    idAwayTeam: '133616',
    strHomeTeamBadge: 'https://example.test/h.png',
    strAwayTeamBadge: 'https://example.test/a.png',
    strVenue: 'Emirates Stadium',
    strCity: 'London',
    strCountry: 'England',
    strTimestamp: '2026-09-01T19:00:00',
    strStatus: 'NS',
    strPostponed: 'no',
    ...overrides,
  };
}

function gamesFrom(overrides: Record<string, unknown> = {}, def = soccer): Game[] {
  return normaliseEvents({ events: [raw(overrides)] }, def);
}

describe('schedule game normalisation', () => {
  it('normalises a scheduled game with season, round and venue', () => {
    const game = gamesFrom()[0];
    assert.equal(game.status, 'scheduled');
    assert.equal(game.season, '2026');
    assert.equal(game.round, '4');
    assert.equal(game.venue.name, 'Emirates Stadium');
    assert.equal(game.venue.city, 'London');
    assert.equal(game.venue.country, 'England');
    assert.equal(game.start_time, '2026-09-01T19:00:00.000Z');
  });

  it('keeps a live game that started today', () => {
    assert.equal(gamesFrom({ strStatus: '2H' })[0].status, 'live');
  });

  it('keeps a finished game from today', () => {
    assert.equal(gamesFrom({ strStatus: 'FT' })[0].status, 'finished');
  });

  it('surfaces postponed and cancelled games rather than dropping them', () => {
    assert.equal(gamesFrom({ strStatus: 'PPD' })[0].status, 'postponed');
    assert.equal(gamesFrom({ strPostponed: 'yes' })[0].status, 'postponed');
    assert.equal(gamesFrom({ strStatus: 'CANC' })[0].status, 'cancelled');
  });

  it('exposes no betting fields', () => {
    const game = gamesFrom()[0];
    for (const key of ['odds', 'moneyline', 'spread', 'totals', 'bookmaker', 'markets']) {
      assert.equal(key in game, false, `game must not expose "${key}"`);
    }
  });

  it('returns no games for an empty or invalid provider response', () => {
    assert.deepEqual(normaliseEvents({ events: null }, soccer), []);
    assert.deepEqual(normaliseEvents({}, soccer), []);
    assert.deepEqual(normaliseEvents(null, soccer), []);
    assert.deepEqual(normaliseEvents({ events: [{}] }, soccer), []);
  });

  it('supports tennis as a sport identifier', () => {
    const tennis = SPORT_DEFINITIONS.find((d) => d.id === 'tennis');
    assert.ok(tennis, 'tennis must be registered');
    assert.equal(tennis.providerSport, 'Tennis');
  });
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const week: Game[] = [
  ...gamesFrom({ idEvent: 'a', strTimestamp: '2026-09-01T19:00:00' }),
  ...gamesFrom({
    idEvent: 'b',
    strTimestamp: '2026-09-03T19:00:00',
    strLeague: 'Champions League',
    strHomeTeam: 'Chelsea',
    strAwayTeam: 'Barcelona',
    strVenue: 'Stamford Bridge',
  }),
  ...normaliseEvents(
    {
      events: [
        raw({
          idEvent: 'c',
          strSport: 'American Football',
          strLeague: 'NFL',
          strHomeTeam: 'Buffalo Bills',
          strAwayTeam: 'Kansas City Chiefs',
          strVenue: 'Highmark Stadium',
          strCity: 'Orchard Park',
          strTimestamp: '2026-09-01T18:00:00',
        }),
      ],
    },
    nfl,
  ),
];

const noFilters = { date: null, sport: 'all' as const, league: ALL_LEAGUES, search: '' };

describe('schedule filters', () => {
  it('returns everything with no filters applied', () => {
    assert.equal(applyFilters(week, noFilters, LONDON).length, 3);
  });

  it('filters by date', () => {
    const day1 = applyFilters(week, { ...noFilters, date: '2026-09-01' }, LONDON);
    assert.equal(day1.length, 2);
    const day3 = applyFilters(week, { ...noFilters, date: '2026-09-03' }, LONDON);
    assert.equal(day3.length, 1);
    assert.equal(day3[0].id, 'b');
  });

  it('filters by sport', () => {
    assert.equal(applyFilters(week, { ...noFilters, sport: 'nfl' }, LONDON).length, 1);
    assert.equal(applyFilters(week, { ...noFilters, sport: 'football' }, LONDON).length, 2);
    assert.equal(applyFilters(week, { ...noFilters, sport: 'nhl' }, LONDON).length, 0);
  });

  it('filters by league', () => {
    const cl = applyFilters(week, { ...noFilters, league: 'Champions League' }, LONDON);
    assert.equal(cl.length, 1);
    assert.equal(cl[0].id, 'b');
  });

  it('searches team, league and venue', () => {
    assert.equal(applyFilters(week, { ...noFilters, search: 'Arsenal' }, LONDON).length, 1);
    assert.equal(applyFilters(week, { ...noFilters, search: 'chiefs' }, LONDON).length, 1);
    assert.equal(applyFilters(week, { ...noFilters, search: 'Emirates' }, LONDON).length, 1);
    assert.equal(applyFilters(week, { ...noFilters, search: 'Champions' }, LONDON).length, 1);
    assert.equal(applyFilters(week, { ...noFilters, search: 'zzz' }, LONDON).length, 0);
  });

  it('combines filters rather than replacing them', () => {
    const combined = applyFilters(
      week,
      { date: '2026-09-01', sport: 'football', league: 'Premier League', search: 'Arsenal' },
      LONDON,
    );
    assert.equal(combined.length, 1);
    assert.equal(combined[0].id, 'a');

    // Same day and search, but the wrong sport yields nothing.
    assert.equal(
      applyFilters(
        week,
        { date: '2026-09-01', sport: 'nfl', league: ALL_LEAGUES, search: 'Arsenal' },
        LONDON,
      ).length,
      0,
    );
  });

  it('ignores case and surrounding whitespace when searching', () => {
    assert.equal(matchesSearch(week[0], '  ARSENAL '), true);
    assert.equal(matchesSearch(week[0], ''), true);
  });

  it('lists only leagues present in the loaded window', () => {
    const leagues = availableLeagues(week);
    assert.equal(leagues[0], ALL_LEAGUES);
    assert.deepEqual(leagues.slice(1), ['Champions League', 'NFL', 'Premier League']);
    assert.equal(availableLeagues([]).length, 1);
  });

  it('groups games by their local calendar date', () => {
    const grouped = groupByDate(week, LONDON);
    assert.equal(grouped.get('2026-09-01')?.length, 2);
    assert.equal(grouped.get('2026-09-03')?.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

describe('schedule summary', () => {
  const dates = scheduleRange(LONDON, new Date('2026-09-01T12:00:00Z')).dates;

  it('counts the whole window, distinct sports, today and tomorrow', () => {
    const summary = summarise(week, dates, LONDON);
    assert.equal(summary.games_this_week, 3);
    assert.equal(summary.sports_tracked, 2);
    assert.equal(summary.today, 2);
    assert.equal(summary.tomorrow, 0);
  });

  it('is all zeroes for an empty schedule', () => {
    const summary = summarise([], dates, LONDON);
    assert.equal(summary.games_this_week, 0);
    assert.equal(summary.sports_tracked, 0);
    assert.equal(summary.today, 0);
  });
});

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

describe('presentation', () => {
  it('formats the day selector', () => {
    assert.deepEqual(formatDayTab('2026-09-01'), { weekday: 'TUE', label: 'SEP 1' });
    assert.deepEqual(formatDayTab('nonsense'), { weekday: '--', label: 'nonsense' });
  });

  it('formats a date heading', () => {
    assert.equal(formatDateHeading('2026-09-01'), 'Tuesday, 1 September');
  });

  it('formats kick-off in the schedule timezone', () => {
    // 19:00Z in September is 20:00 in London (BST).
    assert.equal(formatKickoff('2026-09-01T19:00:00.000Z', LONDON), '20:00');
    assert.equal(formatKickoff('2026-09-01T19:00:00.000Z', 'UTC'), '19:00');
    assert.equal(formatKickoff(null, LONDON), '--:--');
    assert.equal(formatKickoff('nonsense', LONDON), '--:--');
  });

  it('uses sport-appropriate matchup wording', () => {
    assert.equal(separatorFor('football'), 'vs');
    assert.equal(separatorFor('tennis'), 'vs');
    assert.equal(separatorFor('nfl'), '@');
    assert.equal(separatorFor('nba'), '@');
  });
});
