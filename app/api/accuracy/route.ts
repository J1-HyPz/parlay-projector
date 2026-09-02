/**
 * GET /api/accuracy?window=today|7d|30d|all-time&section=
 *
 * Every accuracy figure the application reports, from one service — so the
 * homepage widget and any detailed view can never disagree.
 *
 * Reads settled local history only. No provider is called here: sports APIs
 * belong in the settlement job, not on the path of a page load.
 *
 * `section` narrows the response for callers that want one slice:
 *   summary | sports | markets | risk | calibration | score | parlays |
 *   trend | models | recent
 */

import { json } from '@/lib/home/api';
import { getAccuracyReport, parseWindow, recentSettled } from '@/lib/projections/accuracy';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const window = parseWindow(params.get('window'));
  const section = (params.get('section') ?? '').toLowerCase();

  if (section === 'recent') {
    const limit = Number.parseInt(params.get('limit') ?? '', 10);
    const records = await recentSettled(Number.isFinite(limit) ? limit : 20);

    return json({
      window,
      recent: records.map((record) => ({
        id: record.id,
        game_id: record.game_id,
        sport: record.sport,
        league: record.league,
        selection: record.selection,
        selection_type: record.selection_type,
        probability: record.model_probability,
        risk: record.risk,
        status: record.status,
        result: record.result,
        projected: record.projected,
        actual: record.actual,
        settled_at: record.settled_at,
        model_version: record.model_version,
      })),
    });
  }

  const report = await getAccuracyReport(window);

  switch (section) {
    case 'summary':
      return json({
        window,
        overall: report.overall,
        score: report.score,
        counts: report.counts,
        updated_at: report.updated_at,
      });
    case 'sports':
      return json({ window, by_sport: report.by_sport, updated_at: report.updated_at });
    case 'markets':
      return json({ window, by_market: report.by_market, updated_at: report.updated_at });
    case 'risk':
      return json({
        window,
        by_risk: report.by_risk,
        risk_ordering: report.risk_ordering,
        parlays: report.parlays,
        updated_at: report.updated_at,
      });
    case 'calibration':
      return json({
        window,
        calibration: report.calibration,
        // Calibration means little without the Brier score beside it.
        brier: report.overall.brier,
        updated_at: report.updated_at,
      });
    case 'score':
      return json({ window, score: report.score, updated_at: report.updated_at });
    case 'parlays':
      return json({ window, parlays: report.parlays, updated_at: report.updated_at });
    case 'trend':
      return json({ window, trend: report.trend, updated_at: report.updated_at });
    case 'models':
      return json({ window, by_model: report.by_model, updated_at: report.updated_at });
    default:
      return json(report);
  }
}
