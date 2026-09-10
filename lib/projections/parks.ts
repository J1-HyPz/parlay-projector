/**
 * The ground, as a bounded adjustment to an expected total.
 *
 * Pure. Two club names, a venue and a config in, a number of runs out.
 *
 * **This is not what §4.7 proposed, because the measurement refused it.**
 * That section proposed blending each team's own home and away scoring rates
 * into the expected score. Across thirteen competitions and 1,443 team-seasons
 * a team's home/away split has no reliability worth the name: the spread of
 * observed splits is at or below what sampling noise alone produces, and
 * neither an odd/even split-half within a season nor a season-to-season
 * correlation reaches significance anywhere except baseball. A per-team split
 * would be fitted to noise.
 *
 * **Baseball's split is real, and it is the ballpark rather than the team.**
 * Two findings settle it. A club's home scoring split and its home *conceding*
 * split run together (r = +0.275) — a genuine home advantage would push them
 * apart, since a side that plays better at home should also concede less
 * there, whereas a ground that helps hitters helps both sides equally. And the
 * same ground behaves the same way the following season (r = +0.426), which a
 * property of the roster would not.
 *
 * **What the model was actually getting wrong.** Not the ground — the rating.
 * A club's scoring rate is built from every game it plays, half at its own
 * ground and half spread over everyone else's, so a club at an extreme park
 * carries a rate that is too low for its home fixtures and too high for its
 * away ones. Measured across five archived seasons the two errors mirror each
 * other at r = -0.947: Colorado's totals ran 1.39 runs light at Coors and 1.23
 * runs heavy on the road, Seattle's the same in reverse. A bonus applied at
 * Coors alone would have corrected one half and left the other untouched.
 *
 * So the adjustment is a *difference*: this ground's factor against the factor
 * the visitor's own rating carries in from its ground. Both terms are needed,
 * and fitted as two free weights they came out very nearly equal and opposite
 * (+0.20 and -0.25), which is the signature a mirrored error must have.
 *
 * **Baseball only.** Basketball and ice hockey were put through the identical
 * forward-chained test and both came out *worse* — paired t of +0.47 and
 * +0.94, error moving the wrong way. Their configs carry no `parks` block and
 * are projected exactly as they were before this existed.
 */

import type { SportModelConfig } from './config.ts';

/** One club's home ground, and how much scoring it adds. */
export interface ParkFactor {
  /**
   * The ground the factor was measured at.
   *
   * Carried so the adjustment can *check* it. A club playing somewhere else —
   * a neutral-site fixture, a relocation, a season in a temporary park — gets
   * no adjustment at all rather than one measured somewhere it is not playing.
   */
  venue: string;
  /**
   * Total runs per game above what this club's own fixtures produce elsewhere.
   *
   * Measured as the host's total at this ground minus the same host's total
   * away from it. Subtracting a club from itself cancels its own quality,
   * which a raw average at the ground would absorb whole: Coors would look
   * inflated by however good the Rockies happened to be that year.
   */
  factor: number;
}

/**
 * MLB grounds, fitted from the 2021-2025 archive on 2026-09-10.
 *
 * Twenty-eight of them. Every spring-training park and every neutral site
 * (London, Mexico City, the Field of Dreams and Rickwood games) is absent by
 * construction, as are the two clubs currently in temporary homes — the
 * Athletics at Sutter Health Park and the Rays at Steinbrenner Field. Neither
 * ground has enough baseball in it to measure, and their previous grounds say
 * nothing about them, so both clubs are projected without an adjustment.
 *
 * Ordered by factor, so the physics is visible: Coors Field at altitude sits
 * nearly two runs clear of anything else and T-Mobile Park anchors the other
 * end. The ordering was not put in by hand — it is what the archive produced,
 * and that it reproduces baseball's known park ordering is a check that the
 * measurement is sound rather than a claim made for it.
 *
 * **These go stale.** Fences move, humidors arrive, clubs relocate. The figure
 * is a five-season average, and re-fitting it is a recalibration like any
 * other.
 *
 * The grounds are named exactly as the fixtures provider names them, because
 * the archive these were fitted from is built through the same normaliser that
 * live fixtures come through — hence "Daikin Park" and "Rate Field" rather than
 * the names those grounds carried for most of the window, which is what the
 * provider now reports for those seasons too. A future rename therefore stops
 * the venue guard matching and the adjustment simply stops firing for that
 * club, which is the safe direction to fail in.
 */
export const MLB_PARK_FACTORS: Readonly<Record<string, ParkFactor>> = {
  'Colorado Rockies': { venue: 'Coors Field', factor: 2.67 },
  'Boston Red Sox': { venue: 'Fenway Park', factor: 0.91 },
  'Cincinnati Reds': { venue: 'Great American Ball Park', factor: 0.72 },
  'Kansas City Royals': { venue: 'Kauffman Stadium', factor: 0.49 },
  'Philadelphia Phillies': { venue: 'Citizens Bank Park', factor: 0.48 },
  'Detroit Tigers': { venue: 'Comerica Park', factor: 0.47 },
  'Miami Marlins': { venue: 'loanDepot park', factor: 0.4 },
  'Pittsburgh Pirates': { venue: 'PNC Park', factor: 0.27 },
  'Washington Nationals': { venue: 'Nationals Park', factor: 0.16 },
  'Los Angeles Angels': { venue: 'Angel Stadium', factor: 0.11 },
  'Chicago White Sox': { venue: 'Rate Field', factor: 0.09 },
  'Minnesota Twins': { venue: 'Target Field', factor: 0.07 },
  'Arizona Diamondbacks': { venue: 'Chase Field', factor: -0.03 },
  'Houston Astros': { venue: 'Daikin Park', factor: -0.04 },
  'Cleveland Guardians': { venue: 'Progressive Field', factor: -0.15 },
  'Toronto Blue Jays': { venue: 'Rogers Centre', factor: -0.16 },
  'Los Angeles Dodgers': { venue: 'Dodger Stadium', factor: -0.19 },
  'Baltimore Orioles': { venue: 'Oriole Park at Camden Yards', factor: -0.19 },
  'Texas Rangers': { venue: 'Globe Life Field', factor: -0.27 },
  'Milwaukee Brewers': { venue: 'American Family Field', factor: -0.28 },
  'New York Yankees': { venue: 'Yankee Stadium', factor: -0.3 },
  'Atlanta Braves': { venue: 'Truist Park', factor: -0.33 },
  'New York Mets': { venue: 'Citi Field', factor: -0.53 },
  'St. Louis Cardinals': { venue: 'Busch Stadium', factor: -0.63 },
  'Chicago Cubs': { venue: 'Wrigley Field', factor: -0.69 },
  'San Francisco Giants': { venue: 'Oracle Park', factor: -0.77 },
  'San Diego Padres': { venue: 'Petco Park', factor: -0.89 },
  'Seattle Mariners': { venue: 'T-Mobile Park', factor: -1.51 },
};

/**
 * The change to the expected total, in the sport's own units.
 *
 * Zero unless everything lines up: a competition with a `parks` block, both
 * clubs carrying a factor, and the fixture actually being played at the home
 * club's own ground. Anything missing yields zero, and zero means the fixture
 * is projected exactly as it would have been before this existed.
 *
 * Both clubs are required deliberately. The adjustment is the *difference*
 * between two carried biases, and applying one without the other would move
 * the total by a whole park factor where the evidence supports a fraction of
 * the gap — a larger error than making no adjustment at all.
 */
export function parkTotalAdjustment(
  config: SportModelConfig,
  homeTeam: string,
  awayTeam: string,
  venue: string | null | undefined,
): number {
  const rule = config.parks;
  if (!rule || !venue) return 0;

  const home = rule.factors[homeTeam];
  const away = rule.factors[awayTeam];
  if (!home || !away) return 0;

  // Played somewhere other than the home club's own ground: a neutral site, a
  // relocation, or a provider naming the venue differently. Either way the
  // factor on file is not the factor for this fixture.
  if (home.venue !== venue) return 0;

  const raw = (home.factor - away.factor) * rule.weight;
  return Math.max(-rule.cap, Math.min(rule.cap, raw));
}

/**
 * How the adjustment reads to a reader.
 *
 * Null when nothing was applied, so a caller cannot state a factor for a
 * fixture that was not adjusted. Names the ground, because that is the thing
 * a reader can go and check.
 */
export function describeParkAdjustment(
  config: SportModelConfig,
  adjustment: number,
  homeTeam: string,
  unit: string,
): string | null {
  if (adjustment === 0) return null;
  const venue = config.parks?.factors[homeTeam]?.venue;
  if (!venue) return null;

  const up = adjustment > 0;
  return (
    `${venue} scores ${up ? 'higher' : 'lower'} than the grounds these two sides ` +
    `are rated on — the projected total is adjusted ${up ? 'up' : 'down'} by ` +
    `${Math.abs(adjustment).toFixed(2)} ${unit}.`
  );
}
