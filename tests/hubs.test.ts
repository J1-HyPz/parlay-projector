import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FOOTBALL_GROUPS,
  HUBS,
  SIDEBAR_HUBS,
  divisionFor,
  hubGroups,
  hubSlugs,
  isFootballHub,
  leaguesForHub,
  resolveHub,
  singleLeagueFor,
} from '../lib/sports/hubs.ts';
import {
  LEAGUES,
  findLeague,
  leaguesByProvider,
  supportsEditorialData,
} from '../lib/leagues/registry.ts';
import { previewSections, seasonLabel, splitGames } from '../lib/sports/split.ts';
import {
  competitorLabel,
  hasRank,
  standingsColumns,
} from '../lib/sports/standings-columns.ts';
import {
  classifyTransaction,
  normaliseTransactions,
  teamIdFromRef,
} from '../lib/leagues/transactions-normalise.ts';
import { normaliseEspnNews } from '../lib/leagues/news-normalise.ts';
import type { Game, GameStatus } from '../lib/home/types.ts';
import type { StandingsRow } from '../lib/leagues/types.ts';

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

describe('hub slugs', () => {
  it('serves every competition in the catalogue', () => {
    // ncaam and ncaaw are covered by the combined hub rather than pages of
    // their own, so the count is one lower than the catalogue.
    assert.equal(HUBS.length, LEAGUES.length - 1);

    const covered = new Set(HUBS.flatMap((hub) => hub.leagues));
    for (const league of LEAGUES) {
      assert.ok(covered.has(league.id), `${league.id} has no hub`);
    }
  });

  it('exposes the expected slugs', () => {
    assert.deepEqual(hubSlugs(), [
      'nfl', 'ncaaf', 'cfl', 'afle', 'efa', 'nba', 'wnba', 'ncaab', 'mlb', 'nhl',
      'epl', 'championship', 'league-one', 'ucl', 'uel', 'uecl',
      'laliga', 'bundesliga', 'seriea',
      'f1',
    ]);
  });

  it('resolves a valid slug', () => {
    const resolved = resolveHub('nba');
    assert.equal(resolved?.hub.slug, 'nba');
    assert.deepEqual(resolved?.hub.leagues, ['nba']);
  });

  it('returns null for an unknown or malformed slug', () => {
    assert.equal(resolveHub('tennis'), null, 'no verified tennis competition exists');
    assert.equal(resolveHub('rugby'), null);
    assert.equal(resolveHub(''), null);
    assert.equal(resolveHub('../../etc/passwd'), null);
    assert.equal(resolveHub(null), null);
    assert.equal(resolveHub('a'.repeat(64)), null);
  });

  it('is case and whitespace tolerant', () => {
    assert.equal(resolveHub('  NBA  ')?.hub.slug, 'nba');
  });
});

// ---------------------------------------------------------------------------
// NCAA basketball
// ---------------------------------------------------------------------------

describe('the combined NCAA basketball hub', () => {
  const hub = resolveHub('ncaab')!.hub;

  it('covers both divisions', () => {
    assert.deepEqual(hub.leagues, ['ncaam', 'ncaaw']);
  });

  it('is not itself a league', () => {
    // ncaab is a UI grouping; treating it as a registry id would send it to the
    // provider as a path segment.
    assert.equal(findLeague('ncaab'), null);
  });

  it('maps All to both underlying leagues', () => {
    const all = divisionFor(hub, 'all');
    assert.deepEqual(
      leaguesForHub(hub, all).map((league) => league.id),
      ['ncaam', 'ncaaw'],
    );
  });

  it("maps Men's to ncaam only", () => {
    const mens = divisionFor(hub, 'mens');
    assert.deepEqual(
      leaguesForHub(hub, mens).map((league) => league.id),
      ['ncaam'],
    );
    assert.equal(singleLeagueFor(hub, mens)?.id, 'ncaam');
  });

  it("maps Women's to ncaaw only", () => {
    const womens = divisionFor(hub, 'womens');
    assert.deepEqual(
      leaguesForHub(hub, womens).map((league) => league.id),
      ['ncaaw'],
    );
    assert.equal(singleLeagueFor(hub, womens)?.id, 'ncaaw');
  });

  it('has no single league while All is selected', () => {
    // Standings and team lists are per-division; merging hundreds of college
    // teams into one table would help nobody.
    assert.equal(singleLeagueFor(hub, divisionFor(hub, 'all')), null);
  });

  it('falls back to the default for an unknown division', () => {
    assert.equal(divisionFor(hub, 'juniors')?.id, 'all');
  });

  it('resolves the underlying league ids to the combined hub', () => {
    const mens = resolveHub('ncaam');
    assert.equal(mens?.hub.slug, 'ncaab');
    assert.equal(mens?.division?.id, 'mens', 'opens on the requested division');

    const womens = resolveHub('ncaaw');
    assert.equal(womens?.hub.slug, 'ncaab');
    assert.equal(womens?.division?.id, 'womens');
  });

  it('gives an ordinary hub no divisions', () => {
    const nba = resolveHub('nba')!.hub;
    assert.equal(nba.divisions, undefined);
    assert.equal(singleLeagueFor(nba, null)?.id, 'nba');
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe('navigation', () => {
  it('points every sidebar shortcut at a real hub', () => {
    for (const entry of SIDEBAR_HUBS) {
      assert.ok(resolveHub(entry.slug), `sidebar entry "${entry.slug}" has no hub`);
    }
  });

  it('keeps the sidebar curated rather than exhaustive', () => {
    assert.ok(SIDEBAR_HUBS.length < HUBS.length, 'every competition would be unusable');
    assert.deepEqual(
      SIDEBAR_HUBS.map((entry) => entry.slug),
      ['nfl', 'ncaaf', 'nba', 'wnba', 'ncaab', 'mlb', 'nhl', 'epl', 'ucl', 'f1'],
    );
  });

  it('reaches every football competition from the switcher', () => {
    const reachable = new Set(FOOTBALL_GROUPS.flatMap((group) => group.slugs));
    const football = LEAGUES.filter((league) => league.group === 'football');

    assert.equal(reachable.size, football.length);
    for (const league of football) {
      assert.ok(reachable.has(league.id), `${league.id} is unreachable`);
      assert.ok(resolveHub(league.id), `${league.id} has no hub`);
    }
  });

  it('shows the switcher on football hubs only', () => {
    assert.equal(isFootballHub(resolveHub('epl')!.hub), true);
    assert.equal(isFootballHub(resolveHub('uecl')!.hub), true);
    assert.equal(isFootballHub(resolveHub('nba')!.hub), false);
  });

  it('lists every hub in the competition index', () => {
    // The index is the only way to reach a hub on mobile: the sidebar is
    // desktop-only, so anything missing here is unreachable on a phone.
    const listed = hubGroups().flatMap((group) => group.hubs.map((hub) => hub.slug));
    assert.deepEqual(listed.sort(), hubSlugs().sort());
  });

  it('includes every sidebar shortcut in the index', () => {
    const listed = new Set(hubGroups().flatMap((group) => group.hubs.map((h) => h.slug)));
    for (const entry of SIDEBAR_HUBS) {
      assert.ok(listed.has(entry.slug), `${entry.slug} is missing from the index`);
    }
  });

  it('groups the index by sport', () => {
    const groups = hubGroups();
    assert.deepEqual(
      groups.map((group) => group.id),
      ['american-football', 'basketball', 'baseball', 'hockey', 'football', 'motorsport'],
    );
    // Football carries nine competitions; the sidebar only has room for two.
    assert.equal(groups.find((group) => group.id === 'football')?.hubs.length, 9);
    assert.equal(groups.find((group) => group.id === 'basketball')?.hubs.length, 3);
    // NFL, NCAA, CFL and the two European competitions.
    assert.equal(groups.find((group) => group.id === 'american-football')?.hubs.length, 5);
    // Formula 1 stands alone: the only competition contested by a field.
    assert.equal(groups.find((group) => group.id === 'motorsport')?.hubs.length, 1);
  });

  it('puts each hub in exactly one group', () => {
    const listed = hubGroups().flatMap((group) => group.hubs.map((hub) => hub.slug));
    assert.equal(new Set(listed).size, listed.length);
  });

  it('uses a chip id that Schedule and Live understand', () => {
    // Hubs link to /schedule?sport=<chip>; the chip ids live with the filters.
    for (const hub of HUBS) {
      assert.equal(typeof hub.chip, 'string');
      assert.ok(hub.chip.length > 0);
    }
  });
});

// ---------------------------------------------------------------------------
// Terminology
// ---------------------------------------------------------------------------

describe('sport-appropriate terminology', () => {
  it('uses football words on football hubs', () => {
    const epl = resolveHub('epl')!.hub.terminology;
    assert.equal(epl.games, 'Fixtures');
    assert.equal(epl.teams, 'Clubs');
    assert.equal(epl.standings, 'Table');
    assert.equal(epl.transactions, 'Transfers');
  });

  it('uses American words elsewhere', () => {
    const nba = resolveHub('nba')!.hub.terminology;
    assert.equal(nba.games, 'Games');
    assert.equal(nba.teams, 'Teams');
    assert.equal(nba.transactions, 'Transactions');
  });

  it('calls college moves what they are', () => {
    assert.equal(resolveHub('ncaaf')!.hub.terminology.transactions, 'Roster Moves');
    assert.equal(resolveHub('ncaab')!.hub.terminology.transactions, 'Roster Moves');
  });
});

// ---------------------------------------------------------------------------
// Splitting fixtures
// ---------------------------------------------------------------------------

const TODAY = '2026-09-02';
const TZ = 'UTC';

function game(id: string, status: GameStatus, date: string | null): Game {
  return {
    id,
    sport: 'football',
    league: 'Premier League',
    league_badge: null,
    season: '2026',
    round: '3',
    start_time: date ? `${date}T15:00:00.000Z` : null,
    status,
    provider_status: null,
    home_team: { id: '1', name: 'Home', logo: null },
    away_team: { id: '2', name: 'Away', logo: null },
    venue: { name: null, city: null, country: null },
    broadcast: null,
  };
}

describe('splitting a competition into sections', () => {
  it('places each game in exactly one bucket', () => {
    const sections = splitGames(
      [
        game('live', 'live', TODAY),
        game('today', 'scheduled', TODAY),
        game('done', 'finished', '2026-08-30'),
        game('next', 'scheduled', '2026-09-05'),
      ],
      TODAY,
      TZ,
    );

    assert.deepEqual(sections.live.map((g) => g.id), ['live']);
    assert.deepEqual(sections.today.map((g) => g.id), ['today']);
    assert.deepEqual(sections.results.map((g) => g.id), ['done']);
    assert.deepEqual(sections.upcoming.map((g) => g.id), ['next']);
  });

  it('keeps a game that ran past midnight in live, not yesterday', () => {
    const sections = splitGames([game('late', 'live', '2026-09-01')], TODAY, TZ);
    assert.deepEqual(sections.live.map((g) => g.id), ['late']);
    assert.deepEqual(sections.results, []);
  });

  it('treats a future postponement as upcoming, not a result', () => {
    const sections = splitGames([game('off', 'postponed', '2026-09-06')], TODAY, TZ);
    assert.deepEqual(sections.upcoming.map((g) => g.id), ['off']);
    assert.deepEqual(sections.results, []);
  });

  it('counts a game called off earlier as a result', () => {
    const sections = splitGames([game('off', 'cancelled', '2026-08-29')], TODAY, TZ);
    assert.deepEqual(sections.results.map((g) => g.id), ['off']);
  });

  it('drops a past fixture the provider never settled', () => {
    // Still "scheduled" days after kick-off means the provider stopped updating
    // it. Showing it as upcoming would be wrong, and as a result would be a lie.
    const sections = splitGames([game('stale', 'scheduled', '2026-08-20')], TODAY, TZ);
    assert.deepEqual(sections.results, []);
    assert.deepEqual(sections.upcoming, []);
    assert.deepEqual(sections.today, []);
  });

  it('shows an undated game only when it is live or settled', () => {
    const undatedLive = splitGames([game('a', 'live', null)], TODAY, TZ);
    assert.equal(undatedLive.live.length, 1);

    const undatedDone = splitGames([game('b', 'finished', null)], TODAY, TZ);
    assert.equal(undatedDone.results.length, 1);

    const undatedScheduled = splitGames([game('c', 'scheduled', null)], TODAY, TZ);
    assert.equal(undatedScheduled.today.length + undatedScheduled.upcoming.length, 0);
  });

  it('orders results newest first and fixtures soonest first', () => {
    const sections = splitGames(
      [
        game('older', 'finished', '2026-08-25'),
        game('newer', 'finished', '2026-09-01'),
        game('later', 'scheduled', '2026-09-08'),
        game('sooner', 'scheduled', '2026-09-04'),
      ],
      TODAY,
      TZ,
    );
    assert.deepEqual(sections.results.map((g) => g.id), ['newer', 'older']);
    assert.deepEqual(sections.upcoming.map((g) => g.id), ['sooner', 'later']);
  });

  it('never trims the live list in a preview', () => {
    const live = Array.from({ length: 9 }, (_, i) => game(`l${i}`, 'live', TODAY));
    const preview = previewSections(splitGames(live, TODAY, TZ), 4);
    assert.equal(preview.live.length, 9, 'live is why someone opened the page');
  });

  it('trims the other sections', () => {
    const many = Array.from({ length: 9 }, (_, i) => game(`u${i}`, 'scheduled', '2026-09-05'));
    const preview = previewSections(splitGames(many, TODAY, TZ), 4);
    assert.equal(preview.upcoming.length, 4);
  });
});

describe('season label', () => {
  it('renders a football season as a span', () => {
    assert.equal(seasonLabel([game('a', 'scheduled', TODAY)], true), '2026/27');
  });

  it('leaves a single-year season alone', () => {
    assert.equal(seasonLabel([game('a', 'scheduled', TODAY)], false), '2026');
  });

  it('is null when the provider gave no season', () => {
    const bare = { ...game('a', 'scheduled', TODAY), season: null };
    assert.equal(seasonLabel([bare], true), null);
    assert.equal(seasonLabel([], true), null);
  });
});

// ---------------------------------------------------------------------------
// Standings columns
// ---------------------------------------------------------------------------

function row(overrides: Partial<StandingsRow> = {}): StandingsRow {
  return {
    team_id: '1',
    team_name: 'Arsenal',
    abbreviation: 'ARS',
    logo: null,
    rank: 1,
    games_played: null,
    wins: null,
    losses: null,
    ties: null,
    win_percent: null,
    games_behind: null,
    points_for: null,
    points_against: null,
    point_differential: null,
    points: null,
    record: null,
    streak: null,
    ...overrides,
  };
}

describe('standings columns', () => {
  it('uses a league table for football', () => {
    const rows = [row({ games_played: 4, wins: 3, ties: 1, losses: 0, points: 10 })];
    assert.deepEqual(
      standingsColumns(rows, 'football').map((column) => column.label),
      ['P', 'W', 'D', 'L', 'Pts'],
    );
  });

  it('uses a win/loss record elsewhere', () => {
    const rows = [row({ wins: 3, losses: 1, win_percent: 0.75 })];
    assert.deepEqual(
      standingsColumns(rows, 'basketball').map((column) => column.label),
      ['W', 'L', 'PCT'],
    );
  });

  it('drops a column no row has a value for', () => {
    // NCAA Football supplies no games-behind; an empty column is worse than none.
    const rows = [row({ wins: 3, losses: 1 })];
    const labels = standingsColumns(rows, 'american-football').map((c) => c.label);
    assert.equal(labels.includes('GB'), false);
    assert.equal(labels.includes('Streak'), false);
  });

  it('shows championship points for motorsport', () => {
    /*
     * A driver does not lose a Grand Prix, so the win/loss shape leaves every
     * column empty and all of them get filtered out — a championship table of
     * names with nothing to rank them by.
     */
    const rows = [row({ points: 242 })];
    assert.deepEqual(
      standingsColumns(rows, 'motorsport').map((column) => column.label),
      ['Pts'],
    );
  });

  it('names the competitor column for what it ranks', () => {
    // Neither a driver nor a marque is a "Team".
    assert.equal(competitorLabel('motorsport', 'Driver Standings'), 'Driver');
    assert.equal(competitorLabel('motorsport', 'Constructor Standings'), 'Constructor');
    assert.equal(competitorLabel('basketball', 'Eastern Conference'), 'Team');
    assert.equal(competitorLabel('football', 'Premier League'), 'Team');
  });

  it('never fabricates a statistic', () => {
    const columns = standingsColumns([row()], 'basketball');
    assert.deepEqual(columns, [], 'a row with no stats produces no columns');
  });

  it('signs goal difference', () => {
    const columns = standingsColumns([row({ point_differential: 7 })], 'football');
    const gd = columns.find((column) => column.label === 'GD');
    assert.equal(gd?.value(row({ point_differential: 7 })), '+7');
    assert.equal(gd?.value(row({ point_differential: -3 })), '-3');
  });

  it('shows a position column only when the provider ranked the rows', () => {
    assert.equal(hasRank([row({ rank: 1 })]), true);
    assert.equal(hasRank([row({ rank: null })]), false);
  });
});

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

describe('transaction classification', () => {
  it('recognises the common moves', () => {
    assert.equal(classifyTransaction('Acquired SG Josh Green from Minnesota'), 'trade');
    assert.equal(classifyTransaction('Traded F John Konchar to Utah'), 'trade');
    assert.equal(classifyTransaction('Waived F Cody Williams'), 'waiver');
    assert.equal(classifyTransaction('Released QB Sam Howell'), 'release');
    assert.equal(classifyTransaction('Signed G Tyus Jones'), 'free-agent-signing');
    assert.equal(classifyTransaction('Recalled RHP Ben Brown from Triple-A'), 'call-up');
    assert.equal(classifyTransaction('Placed OF Ian Happ on the 10-day injured list'), 'injured-list');
  });

  it('prefers the more specific reading', () => {
    // "Signed to a contract extension" is an extension, not a new signing.
    assert.equal(
      classifyTransaction('Signed C Nikola Jokic to a contract extension'),
      'contract-extension',
    );
  });

  it('falls back rather than guessing', () => {
    assert.equal(classifyTransaction('Something entirely novel happened'), 'other');
    assert.equal(classifyTransaction(''), 'other');
  });
});

describe('transaction normalisation', () => {
  const teams = [
    {
      id: '26',
      name: 'Utah Jazz',
      short_name: 'Jazz',
      abbreviation: 'UTA',
      location: 'Utah',
      logo: 'jazz.png',
      colour: '002B5C',
    },
  ];

  it('pulls the team id out of a core-API $ref', () => {
    assert.equal(
      teamIdFromRef(
        'http://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2026/teams/26?lang=en',
      ),
      '26',
    );
    assert.equal(teamIdFromRef('nonsense'), null);
    assert.equal(teamIdFromRef(null), null);
  });

  it('joins the team against the cached team list', () => {
    const [transaction] = normaliseTransactions(
      {
        items: [
          {
            date: '2026-08-29T07:00Z',
            description: 'Acquired SG Josh Green and cash considerations.',
            team: {
              $ref: 'http://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2026/teams/26?lang=en',
            },
          },
        ],
      },
      'nba',
      teams,
    );

    assert.equal(transaction.team?.name, 'Utah Jazz');
    assert.equal(transaction.type, 'trade');
    assert.equal(transaction.league_id, 'nba');
    // The provider's wording is kept verbatim.
    assert.equal(transaction.description, 'Acquired SG Josh Green and cash considerations.');
  });

  it('never invents a fee or a player', () => {
    // The feed carries neither, for any sport -- including football, which
    // publishes no transactions at all. Asserting on the keys rather than on
    // the serialised text, because the provider's own wording may well mention
    // a player or a fee and that prose is passed through untouched.
    const [transaction] = normaliseTransactions(
      {
        items: [
          {
            date: '2026-08-29T07:00Z',
            description: 'Signed G Tyus Jones to a two-year deal worth $14m.',
          },
        ],
      },
      'nba',
      teams,
    );

    assert.deepEqual(Object.keys(transaction).sort(), [
      'date',
      'description',
      'id',
      'league_id',
      'team',
      'type',
    ]);
    for (const absent of ['fee', 'player', 'fromTeam', 'toTeam']) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(transaction, absent),
        false,
        `"${absent}" must not be fabricated`,
      );
    }
  });

  it('drops rows with no date or no description', () => {
    const result = normaliseTransactions(
      {
        items: [
          { date: '2026-08-29T07:00Z' },
          { description: 'No date' },
          { date: 'not a date', description: 'Bad date' },
        ],
      },
      'nba',
      teams,
    );
    assert.deepEqual(result, []);
  });

  it('handles a malformed payload', () => {
    assert.deepEqual(normaliseTransactions(null, 'nba', teams), []);
    assert.deepEqual(normaliseTransactions({ items: null }, 'nba', teams), []);
  });

  it('sorts newest first', () => {
    const result = normaliseTransactions(
      {
        items: [
          { date: '2026-08-01T00:00Z', description: 'Older move' },
          { date: '2026-08-30T00:00Z', description: 'Newer move' },
        ],
      },
      'nba',
      teams,
    );
    assert.deepEqual(result.map((t) => t.description), ['Newer move', 'Older move']);
  });
});

describe('provider coverage', () => {
  it('gives every competition a provider and the path that provider needs', () => {
    for (const league of LEAGUES) {
      if (league.provider === 'espn') {
        assert.ok(league.espnPath, `${league.id} is an ESPN league with no path`);
        assert.equal(league.sportsdbLeagueId, null, `${league.id} should not carry both`);
      } else {
        assert.ok(
          league.sportsdbLeagueId,
          `${league.id} is a TheSportsDB league with no id`,
        );
        assert.equal(league.espnPath, null, `${league.id} should not carry both`);
      }
    }
  });

  it('serves the competitions ESPN does not carry from TheSportsDB', () => {
    // ESPN holds CFL teams but publishes no fixtures or results for it at all,
    // and carries neither European competition.
    assert.deepEqual(
      leaguesByProvider('thesportsdb').map((league) => league.id),
      ['cfl', 'afle', 'efa'],
    );
  });

  it('marks those competitions as having no news or transactions', () => {
    // Only ESPN publishes a per-competition news feed or a transactions feed.
    for (const league of leaguesByProvider('thesportsdb')) {
      assert.equal(supportsEditorialData(league), false, league.id);
      assert.equal(league.hasTransactions, false, league.id);
    }
  });

  it('claims a table only where one is published', () => {
    assert.equal(findLeague('cfl')?.hasStandings, true);
    // No table is published for the two European competitions, so the hub says
    // so rather than rendering an empty one.
    assert.equal(findLeague('afle')?.hasStandings, false);
    assert.equal(findLeague('efa')?.hasStandings, false);
  });

  it('reaches every new competition from the hub index', () => {
    for (const slug of ['cfl', 'afle', 'efa']) {
      assert.ok(resolveHub(slug), `${slug} has no hub`);
    }
  });
});

describe('transaction coverage is recorded, not assumed', () => {
  it('marks only the leagues that actually publish them', () => {
    // Verified against the provider: soccer and NCAA return an empty feed.
    const withData = LEAGUES.filter((league) => league.hasTransactions).map((l) => l.id);
    assert.deepEqual(withData, ['nfl', 'nba', 'wnba', 'mlb', 'nhl']);
  });

  it('marks no football competition as covered', () => {
    for (const league of LEAGUES.filter((l) => l.group === 'football')) {
      assert.equal(league.hasTransactions, false, `${league.id} publishes no transfers`);
    }
  });
});

// ---------------------------------------------------------------------------
// League news
// ---------------------------------------------------------------------------

describe('per-league news normalisation', () => {
  const article = {
    id: 48377855,
    headline: 'Nicol: Spurs have had the worst transfer window',
    description: 'A short provider summary.',
    published: '2026-09-02T10:20:37Z',
    links: { web: { href: 'https://www.espn.com/video/clip/_/id/1' } },
    images: [{ url: 'https://example.test/a.jpg' }],
  };

  it('maps onto the shared article model', () => {
    const [result] = normaliseEspnNews({ articles: [article] }, 'Premier League');
    assert.equal(result.headline, article.headline);
    assert.equal(result.summary, 'A short provider summary.');
    assert.equal(result.category, 'Premier League');
    assert.equal(result.source, 'ESPN');
    assert.equal(result.image, 'https://example.test/a.jpg');
    assert.equal(result.published_at, '2026-09-02T10:20:37.000Z');
  });

  it('drops a summary that merely repeats the headline', () => {
    const [result] = normaliseEspnNews(
      { articles: [{ ...article, description: article.headline }] },
      'Premier League',
    );
    assert.equal(result.summary, null);
  });

  it('requires a headline and a usable web link', () => {
    assert.deepEqual(normaliseEspnNews({ articles: [{ ...article, headline: null }] }, 'X'), []);
    assert.deepEqual(normaliseEspnNews({ articles: [{ ...article, links: {} }] }, 'X'), []);
    // The feed also carries app deep links, which do nothing in a browser.
    assert.deepEqual(
      normaliseEspnNews(
        { articles: [{ ...article, links: { web: { href: 'sportscenter://x' } } }] },
        'X',
      ),
      [],
    );
  });

  it('de-duplicates and sorts newest first', () => {
    const older = {
      ...article,
      id: 2,
      published: '2026-08-01T00:00:00Z',
      links: { web: { href: 'https://www.espn.com/2' } },
    };
    const result = normaliseEspnNews({ articles: [older, article, article] }, 'X');
    assert.equal(result.length, 2);
    assert.equal(result[0].published_at, '2026-09-02T10:20:37.000Z');
  });

  it('handles a malformed payload', () => {
    assert.deepEqual(normaliseEspnNews(null, 'X'), []);
    assert.deepEqual(normaliseEspnNews({ articles: null }, 'X'), []);
  });
});
