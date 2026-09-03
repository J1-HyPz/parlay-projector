/**
 * Markets for one fixture.
 *
 *   GET   every market the model has an opinion on, grouped, with the ones a
 *         bookmaker is actually offering marked as such
 *   POST  evaluate a combination the reader assembled themselves
 *
 * The POST is what makes a bet builder honest here. It does not multiply the
 * legs: it counts how often all of them came in together across the same
 * simulated games every individual probability was read from. Correlated legs
 * therefore price correctly in both directions, and a combination that cannot
 * come in at all reports as much rather than returning a small number.
 *
 * Nothing is placed anywhere. This endpoint reports what the model thinks of a
 * set of selections and what the quoted prices are; there is no bookmaker
 * account, no stake and no bet.
 */

import { json } from '@/lib/home/api';
import { logger } from '@/lib/logger';
import { isValidGameId } from '@/lib/games/normalise';
import { getGameDetail } from '@/lib/games/service';
import { gameCandidates } from '@/lib/projections/service';
import { assembleSlip } from '@/lib/projections/same-game';
import { MODEL_VERSION } from '@/lib/projections/types';
import type { Selection } from '@/lib/projections/types';
import type { Game } from '@/lib/home/types';

export const dynamic = 'force-dynamic';

/** A slip longer than this is not a bet anyone is building; it is a probe. */
const MAX_SLIP_LEGS = 8;

/**
 * The fixture's selections, or a reason there are none.
 *
 * Shared by both verbs so the two can never disagree about what is on offer.
 */
async function loadCandidates(gameId: string) {
  if (!isValidGameId(gameId)) return { error: 'game_not_found' as const, status: 404 };

  const detail = await getGameDetail(gameId);
  if (detail.kind === 'not_found') return { error: 'game_not_found' as const, status: 404 };
  if (detail.kind === 'failed') return { error: 'unavailable' as const, status: 503 };

  if (detail.game.status !== 'scheduled') {
    return { error: 'not_upcoming' as const, status: 409 };
  }

  const candidates = await gameCandidates(detail.game as unknown as Game);
  if (!candidates) return { error: 'insufficient_data' as const, status: 200 };

  return { candidates };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  const { gameId } = await context.params;
  const loaded = await loadCandidates(gameId);

  if ('error' in loaded) {
    return json(
      { model_version: MODEL_VERSION, markets: null, reason: loaded.error },
      loaded.status,
    );
  }

  const { candidates } = loaded;
  const { selections, outcome, markets } = candidates;

  /*
   * Grouped by market so the page can present them the way a betting interface
   * does, rather than as one undifferentiated list. Within a group the model's
   * preferred side comes first.
   */
  const grouped = new Map<string, Selection[]>();
  for (const selection of selections) {
    const list = grouped.get(selection.market.type);
    if (list) list.push(selection);
    else grouped.set(selection.market.type, [selection]);
  }
  for (const list of grouped.values()) list.sort((a, b) => b.score - a.score);

  return json({
    model_version: MODEL_VERSION,
    projection: outcome.projection,
    /** Whether a bookmaker was quoting this fixture, and which. */
    pricing: markets
      ? { source: markets.source, fetched_at: markets.fetchedAt, markets: markets.markets.length }
      : null,
    groups: [...grouped.entries()].map(([type, list]) => ({
      market: type,
      label: list[0].market.label,
      selections: list,
    })),
    /*
     * The model's own ranking across every market on this fixture.
     *
     * Ordered by the same score the optimiser uses — probability tempered by
     * confidence, data quality and whether the line is one a bookmaker is
     * actually offering — not by probability alone, which would put every
     * near-certainty on top regardless of how little stands behind it.
     */
    model_picks: [...selections].sort((a, b) => b.score - a.score).slice(0, 5),
  });
}

interface SlipRequest {
  selections?: unknown;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  const { gameId } = await context.params;

  let body: SlipRequest;
  try {
    body = (await request.json()) as SlipRequest;
  } catch {
    return json({ error: 'invalid_body', message: 'Expected a JSON object.' }, 400);
  }

  const ids = Array.isArray(body.selections)
    ? body.selections.filter((id): id is string => typeof id === 'string')
    : null;

  if (!ids || ids.length === 0) {
    return json({ error: 'no_selections', message: 'Choose at least one selection.' }, 400);
  }
  if (ids.length > MAX_SLIP_LEGS) {
    return json(
      { error: 'too_many_selections', message: `At most ${MAX_SLIP_LEGS} selections.` },
      400,
    );
  }

  const loaded = await loadCandidates(gameId);
  if ('error' in loaded) {
    return json({ error: loaded.error }, loaded.status === 200 ? 409 : loaded.status);
  }

  const { candidates } = loaded;
  const byId = new Map(candidates.selections.map((selection) => [selection.id, selection]));

  /*
   * Only selections this fixture genuinely offers.
   *
   * The ids come from the client, so they are matched against what was just
   * generated rather than trusted. An id that no longer resolves — a line that
   * has moved since the page loaded, most likely — is reported as unknown
   * instead of being quietly dropped, because the reader chose it and is
   * entitled to know it is gone.
   */
  const chosen: Selection[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    const selection = byId.get(id);
    if (selection) chosen.push(selection);
    else unknown.push(id);
  }

  if (chosen.length === 0) {
    return json({
      model_version: MODEL_VERSION,
      slip: null,
      unknown,
      reason: 'no_valid_selections',
    });
  }

  const slip = assembleSlip(chosen, candidates.outcome.distribution);

  logger.info('slip_evaluated', {
    game: gameId,
    legs: slip.legs.length,
    dropped: slip.dropped,
    correlation: slip.assessment.correlation.level,
  });

  return json({
    model_version: MODEL_VERSION,
    slip: {
      legs: slip.legs,
      /** Legs removed as incompatible with one already chosen. */
      dropped: slip.dropped,
      unknown,
      independent_probability: slip.assessment.independent,
      combined_probability: slip.assessment.joint,
      correlation: slip.assessment.correlation,
      price: slip.price,
      verified_legs: slip.verified_legs,
    },
  });
}
