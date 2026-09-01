/**
 * Cross-provider entity matching.
 *
 * Providers do not share identifiers, so a TheSportsDB game and an ESPN event
 * have to be recognised as the same fixture. Matching on a team name alone is
 * explicitly unsafe — "Manchester United", "Man United", "Man Utd" and "MUN"
 * are the same club, and "Rangers" is two different ones.
 *
 * The rule here is deliberately strict and deterministic:
 *
 *   same sport  AND  same calendar day  AND  BOTH teams match
 *
 * A single-team match is never enough. When nothing matches confidently the
 * enrichment is simply skipped, which is always better than attaching another
 * club's record to a fixture.
 *
 * No network, no config — directly unit-testable.
 */

/**
 * Words that carry no distinguishing information.
 *
 * Deliberately minimal. Anything that distinguishes two clubs must NOT be here:
 * "United" and "City" were originally in this list, which made
 * "Manchester United" and "Manchester City" reduce to the same token and match
 * each other. Likewise "Atletico" and "Real" separate the two Madrid clubs.
 * Only genuinely decorative suffixes belong.
 */
const NOISE_WORDS = new Set(['fc', 'afc', 'cf', 'sc', 'club', 'the']);

/** Common shorthand seen across providers. */
const ALIASES: Record<string, string> = {
  utd: 'united',
  man: 'manchester',
  wolves: 'wolverhampton',
  spurs: 'tottenham',
  psg: 'paris',
  inter: 'internazionale',
};

/**
 * Reduce a team name to a comparable token set.
 *
 * Strips accents, punctuation and corporate noise so `Atlético Madrid` and
 * `Atletico Madrid CF` reduce to the same tokens.
 */
export function teamTokens(name: string | null | undefined): string[] {
  if (typeof name !== 'string') return [];

  const cleaned = name
    .normalize('NFD')
    // Drop combining accent marks. Written as explicit escapes so the range
    // survives tooling that would otherwise mangle literal combining marks.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return [];

  const tokens: string[] = [];
  for (const raw of cleaned.split(' ')) {
    const token = ALIASES[raw] ?? raw;
    if (token.length === 0) continue;
    tokens.push(token);
  }

  // Keep noise words only if removing them would leave nothing distinctive.
  const meaningful = tokens.filter((token) => !NOISE_WORDS.has(token));
  return meaningful.length > 0 ? meaningful : tokens;
}

/**
 * Whether two team names plausibly refer to the same team.
 *
 * Requires a shared distinctive token, not mere string similarity, so
 * "Manchester United" and "Manchester City" do not match each other.
 */
export function sameTeam(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = teamTokens(a);
  const right = teamTokens(b);
  if (left.length === 0 || right.length === 0) return false;

  const rightSet = new Set(right);
  const shared = left.filter((token) => rightSet.has(token));
  if (shared.length === 0) return false;

  // One shared token is enough only when it is the whole of one side, e.g.
  // "Arsenal" vs "Arsenal FC". Otherwise require the shorter name to be fully
  // contained, which stops "Manchester United" matching "Manchester City".
  const shorter = Math.min(left.length, right.length);
  return shared.length >= shorter;
}

export interface MatchableGame {
  /** Calendar date, YYYY-MM-DD, in a consistent timezone for both sides. */
  date: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
}

/**
 * Find the candidate that is the same fixture.
 *
 * Both teams must match and the calendar day must agree. Home/away is allowed
 * to be reversed, because providers disagree about which side is "home" for
 * neutral-venue fixtures.
 *
 * Returns null when there is no confident match, or when more than one
 * candidate matches — an ambiguous match is treated as no match.
 */
export function findMatchingGame<T extends MatchableGame>(
  target: MatchableGame,
  candidates: readonly T[],
): T | null {
  if (!target.date) return null;

  const matches = candidates.filter((candidate) => {
    if (candidate.date !== target.date) return false;

    const straight =
      sameTeam(candidate.homeTeam, target.homeTeam) &&
      sameTeam(candidate.awayTeam, target.awayTeam);
    const reversed =
      sameTeam(candidate.homeTeam, target.awayTeam) &&
      sameTeam(candidate.awayTeam, target.homeTeam);

    return straight || reversed;
  });

  // Ambiguity is not a match. Two fixtures between the same clubs on the same
  // day should not happen, and if it does, guessing is worse than skipping.
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
