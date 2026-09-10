/**
 * Starting pitchers, as a rate the run model can use.
 *
 * Pure. Starts in, a rate out — no provider, no clock beyond the cut-off it is
 * handed, so the point-in-time rule below is testable without a network.
 *
 * This is the one place in this application where an individual player changes
 * a projected score, and it is deliberately narrow. A starting pitcher is not
 * a general "player impact" model: they are the single participant in any
 * sport here who accounts for most of one side's defensive innings, and their
 * runs-allowed rate is already in the same unit as the team defence rate it
 * replaces. Nothing about this generalises to a quarterback or a striker, and
 * it is not meant to.
 *
 * **Every rate is as at a cut-off.** A season-to-date figure — the ERA the
 * scoreboard hands out for free — is contaminated for any purpose that looks
 * backwards: it includes starts made *after* the fixture being judged. So the
 * rate is always rebuilt from the starts that finished before the kick-off in
 * question, which is the same discipline `toResults(games, asOf)` already
 * applies to team ratings, for the same reason.
 */

/** One completed start. */
export interface PitcherStart {
  /** Provider event id, so a start can be tied back to its fixture. */
  event_id: string;
  /** Kick-off, in epoch milliseconds. */
  date: number;
  /** Innings pitched, as a real number — 6.1 IP is 6⅓, stored as 6.333. */
  innings: number;
  /** Runs allowed, earned or not: the team's score is not fussy either. */
  runs: number;
}

export interface PitcherRate {
  /**
   * Who this is, for the factor the reader sees.
   *
   * Display only — nothing switches on it, and the backtest leaves it null,
   * which is why it cannot quietly become part of the arithmetic.
   */
  name?: string | null;
  /** Runs allowed per nine innings, over the starts before the cut-off. */
  runs_per_nine: number;
  /** Mean innings per start, which sets how much of a game this rate covers. */
  innings_per_start: number;
  /** Starts behind the figure. */
  starts: number;
}

/**
 * Starts below which no rate is produced.
 *
 * Five is where a runs-allowed rate stops being dominated by one bad afternoon:
 * a single seven-run start moves a three-start rate by more than two runs per
 * nine, and by well under one at ten. Below this the team's own defence rate is
 * used unchanged, which is exactly what happens today.
 */
export const MIN_STARTS = 5;

/**
 * Innings pitched, from the provider's own notation.
 *
 * Baseball writes partial innings in thirds after the decimal point: `6.1` is
 * six and one third, `6.2` is six and two thirds. Read as an ordinary decimal
 * — which is what a naive `Number()` does — every fractional start is
 * understated, and a rate built on it is overstated. There is no `.3`; anything
 * else is refused rather than guessed at.
 */
export function parseInnings(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(\.\d)?$/.test(text)) return null;

  const [whole, outs] = text.split('.');
  const full = Number.parseInt(whole, 10);
  if (!Number.isFinite(full)) return null;
  if (outs === undefined) return full;

  const thirds = Number.parseInt(outs, 10);
  if (thirds > 2) return null;
  return full + thirds / 3;
}

/**
 * A pitcher's rate as at a moment, or null when too little stands behind it.
 *
 * Strictly before the cut-off: a start beginning at the same instant as the
 * fixture being projected is not evidence about it.
 */
export function rateBefore(
  starts: readonly PitcherStart[],
  cutoff: number,
  minStarts: number = MIN_STARTS,
): PitcherRate | null {
  const prior = starts.filter((start) => start.date < cutoff);
  if (prior.length < minStarts) return null;

  const innings = prior.reduce((sum, start) => sum + start.innings, 0);
  const runs = prior.reduce((sum, start) => sum + start.runs, 0);
  // A pitcher credited with no innings at all cannot produce a rate, however
  // many appearances are on record.
  if (innings <= 0) return null;

  return {
    runs_per_nine: (runs / innings) * 9,
    innings_per_start: innings / prior.length,
    starts: prior.length,
  };
}

/**
 * How far a rate is allowed to sit from the league average.
 *
 * A pitcher with five starts can carry an extreme figure that says more about
 * who they faced than about them. Clamping to a band around the league rate
 * keeps a real difference while refusing to project a scoreline no fixture
 * produces. The band is deliberately wide — an ace genuinely is close to half
 * the league rate.
 */
const MIN_RATIO = 0.5;
const MAX_RATIO = 1.8;

/**
 * The defence rate to use against a side whose starter is known.
 *
 * Not a substitution but a blend, because a starting pitcher does not pitch
 * the whole game. They cover their mean innings; the rest is the bullpen, and
 * this application has no bullpen rate, so the team's own defence rate fills
 * the remainder.
 *
 * That remainder term is a known approximation: the team rate already includes
 * this pitcher's own innings, so a very good starter is slightly understated
 * and a very poor one slightly overstated. It biases toward the unchanged
 * model rather than away from it, which is the right direction for an
 * approximation to err in — and it is stated here rather than left for someone
 * to discover.
 */
export function blendedDefence(
  rate: PitcherRate,
  teamDefence: number,
  leagueAverage: number,
): number {
  const league = Math.max(leagueAverage, 0.05);
  const bounded = Math.min(
    Math.max(rate.runs_per_nine, league * MIN_RATIO),
    league * MAX_RATIO,
  );

  // A nine-inning game is the unit both rates are expressed in.
  const share = Math.min(Math.max(rate.innings_per_start / 9, 0), 1);
  return share * bounded + (1 - share) * teamDefence;
}

/** What a projection is told about the two starters, where they are known. */
export interface FixturePitchers {
  /** The home side's starter — who determines what the *away* side scores. */
  home: PitcherRate | null;
  away: PitcherRate | null;
}
