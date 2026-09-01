/**
 * Game detail enrichment.
 *
 * Sits between the game service and the provider registry. The primary
 * provider supplies the game; this layer asks the registry for the
 * capabilities the primary provider is weak on and merges what comes back.
 *
 * Design rules, all deliberate:
 *
 * - **Enrichment is lazy.** It runs for a single game detail page, never for
 *   every game in a schedule.
 * - **Partial success.** Each capability is independent; head-to-head failing
 *   does not cost the records.
 * - **Deterministic merge.** Enrichment only fills gaps or supplies fields the
 *   priority table says it owns. It never overwrites a live score or a status.
 * - **Provenance.** Which provider supplied which field is recorded, so a
 *   surprising value can be traced.
 */

import { APP_TIMEZONE } from '../config';
import { logger } from '../logger';
import { gameDate } from '../schedule/range';
import type { GameDetail, TeamStanding } from '../games/types';
import { headToHeadFor, scoreboardFor } from './espn/adapter';
import type { EspnGame, EspnTeamSide } from './espn/normalise';
import { findMatchingGame } from './matching';
import { meetingsToRecentGames, recordToStanding, standingFromForm } from './merge';
import { withFallback } from './registry';

/** Which provider supplied which field. Useful for debugging and comparison. */
export type Provenance = Record<string, string>;

function applySide(
  standing: TeamStanding | null,
  side: EspnTeamSide | null,
): TeamStanding | null {
  if (!side) return standing;

  const withRecord = recordToStanding(side.record, standing);
  // No existing standing and no parseable record, but form alone is useful.
  if (!withRecord) return standingFromForm(side.form);

  return {
    ...withRecord,
    // Prefer whichever side actually has form data.
    form: withRecord.form.length > 0 ? withRecord.form : side.form,
  };
}

export interface EnrichmentResult {
  game: GameDetail;
  sources: Provenance;
}

/**
 * Enrich one game detail.
 *
 * Never throws: every capability is attempted independently and any failure
 * simply leaves that part of the page as it was.
 */
export async function enrichGameDetail(game: GameDetail): Promise<EnrichmentResult> {
  const sources: Provenance = { game: 'thesportsdb' };
  const date = gameDate(game.start_time, APP_TIMEZONE);
  if (!date) return { game, sources };

  // One scoreboard request covers records, form, venue and broadcast, and is
  // cached per competition-day so sibling fixtures reuse it.
  const scoreboard = await withFallback('team_records', async () =>
    scoreboardFor(game.sport, game.league, date, APP_TIMEZONE),
  );

  if (!scoreboard) return { game, sources };

  const match = findMatchingGame(
    { date, homeTeam: game.home_team.name, awayTeam: game.away_team.name },
    scoreboard.value.map((event: EspnGame) => ({
      date: event.matchDate,
      homeTeam: event.home?.name ?? null,
      awayTeam: event.away?.name ?? null,
      event,
    })),
  );

  if (!match) {
    logger.info('enrichment_no_match', {
      provider: scoreboard.providerId,
      sport: game.sport,
      league: game.league,
      date,
    });
    return { game, sources };
  }

  const event = match.event;
  const enriched: GameDetail = { ...game };

  // Records and form: the priority table says ESPN owns these.
  const homeStanding = applySide(game.standings.home, event.home);
  const awayStanding = applySide(game.standings.away, event.away);
  if (homeStanding !== game.standings.home || awayStanding !== game.standings.away) {
    enriched.standings = { home: homeStanding, away: awayStanding };
    sources.standings = scoreboard.providerId;
  }

  // Venue: first trusted non-empty value wins, so the primary provider keeps
  // precedence and ESPN only fills a blank.
  if (!enriched.venue.name && event.venue.name) {
    enriched.venue = {
      name: event.venue.name,
      city: enriched.venue.city ?? event.venue.city,
      country: enriched.venue.country ?? event.venue.country,
    };
    sources.venue = scoreboard.providerId;
  }

  // Broadcast: the primary provider has no such field at all.
  if (!enriched.broadcast && event.broadcast) {
    enriched.broadcast = event.broadcast;
    sources.broadcast = scoreboard.providerId;
  }

  // Team abbreviations, where the primary provider left them blank.
  if (!enriched.home_team.abbreviation && event.home?.abbreviation) {
    enriched.home_team = { ...enriched.home_team, abbreviation: event.home.abbreviation };
    sources.home_abbreviation = scoreboard.providerId;
  }
  if (!enriched.away_team.abbreviation && event.away?.abbreviation) {
    enriched.away_team = { ...enriched.away_team, abbreviation: event.away.abbreviation };
    sources.away_abbreviation = scoreboard.providerId;
  }

  // Head to head is a second request, so only attempt it when the primary
  // provider supplied none — which, on the configured tier, is always.
  if (enriched.head_to_head.length === 0) {
    const meetings = await withFallback('head_to_head', async () =>
      headToHeadFor(game.sport, game.league, event.id),
    );

    if (meetings) {
      const h2h = meetingsToRecentGames(meetings.value, event.home?.name ?? null);
      if (h2h.length > 0) {
        enriched.head_to_head = h2h;
        sources.head_to_head = meetings.providerId;
      }
    }
  }

  logger.info('game_detail_enriched', {
    id: game.id,
    provider: scoreboard.providerId,
    fields: Object.keys(sources).filter((key) => key !== 'game'),
  });

  return { game: enriched, sources };
}
