/**
 * Game detail for a fight or a tennis match.
 *
 * The provider's summary endpoint — which every team fixture's page is built
 * from — answers with an error for a fight id and for a match id, checked
 * live on 2026-09-11. A fight is a competition inside a card and a match is
 * one inside a tournament, and neither is an event the summary knows how to
 * serve. So a contest's page is built from the fixture the scoreboard already
 * normalised, which carries everything a contest has: the two people, when
 * and where, the division, the round, and the result once there is one.
 *
 * What it cannot carry is honestly absent. There is no league table for a
 * fighter, no season series between two players on this feed, and no injury
 * report for either; each of those sections says so rather than showing an
 * empty grid. Pure, so the mapping can be tested without a provider.
 */

import type { Game, Team } from '../home/types';
import type { GameDetail, TeamDetail } from './types';

function person(side: Team): TeamDetail {
  return {
    id: side.id,
    name: side.name,
    // A person has no abbreviation, ground, home town or founding year.
    abbreviation: null,
    logo: side.logo,
    stadium: null,
    location: null,
    formed_year: null,
  };
}

/**
 * A contest's detail, from its fixture.
 *
 * Null when the fixture is not a contest between two named sides — which the
 * adapters never emit, but the type allows.
 */
export function contestDetailFrom(game: Game): GameDetail | null {
  if (!game.home_team || !game.away_team) return null;

  return {
    id: game.id,
    sport: game.sport,
    league: game.league,
    league_badge: game.league_badge,
    season: game.season,
    round: game.round,
    start_time: game.start_time,
    status: game.status,
    provider_status: game.provider_status,
    home_team: person(game.home_team),
    away_team: person(game.away_team),
    venue: game.venue,
    // A contest has no score. The result is `winner`, below.
    score: null,
    game_state: game.status === 'live' ? game.provider_status : null,
    broadcast: game.broadcast,
    standings: { home: null, away: null },
    recent_games: { home: [], away: [] },
    head_to_head: [],
    head_to_head_record: null,
    availability: null,
    _sources: { game: 'espn' },

    title: game.title ?? null,
    division: game.division ?? null,
    scheduledRounds: game.scheduledRounds ?? null,
    // Copied only when present: its presence is what marks a contest.
    ...(game.winner !== undefined ? { winner: game.winner } : {}),
    ...(game.completion ? { completion: game.completion } : {}),
    ...(game.setGames ? { setGames: game.setGames } : {}),
  };
}
