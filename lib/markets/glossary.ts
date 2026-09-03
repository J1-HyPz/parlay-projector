/**
 * Betting terminology, defined once.
 *
 * The interface is meant to be readable by someone who has never placed a bet.
 * That cannot mean avoiding the vocabulary — "Run Line" is what the market is
 * called, and teaching the reader the real term serves them better than
 * inventing a friendlier one that appears nowhere else. So the terms are used,
 * and every one of them can be tapped for a short definition.
 *
 * Definitions are deliberately brief. A tooltip that runs to a paragraph is
 * one nobody finishes.
 *
 * Pure data.
 */

export interface GlossaryEntry {
  term: string;
  definition: string;
  /** A concrete instance, where one makes the definition land faster. */
  example?: string;
}

/**
 * Keyed by a stable slug rather than the display term, because the same
 * concept is called different things in different sports and all of them
 * should resolve to one definition.
 */
export const GLOSSARY: Record<string, GlossaryEntry> = {
  moneyline: {
    term: 'Moneyline',
    definition:
      'A bet on which team wins outright, with no handicap. The margin does not matter.',
    example: 'Backing the Astros wins if they win by one run or by ten.',
  },
  match_result: {
    term: 'Match Result',
    definition:
      'Football has three outcomes rather than two, so a bet on a team to win loses if the match is drawn.',
    example: 'Also written 1X2: home win, draw, away win.',
  },
  spread: {
    term: 'Point Spread',
    definition:
      'A handicap that levels the tie. The favourite must win by more than the line; the underdog can lose by less than it.',
    example: 'At -3.5 a team must win by 4 or more.',
  },
  run_line: {
    term: 'Run Line',
    definition:
      "Baseball's handicap, almost always 1.5 runs because so many games are decided by one.",
    example: '+1.5 wins if the team wins, or loses by exactly one run.',
  },
  puck_line: {
    term: 'Puck Line',
    definition: "Ice hockey's handicap, normally 1.5 goals.",
  },
  handicap: {
    term: 'Handicap',
    definition:
      'A head start or deficit applied to a team before the result is settled, used to make an uneven fixture an even bet.',
  },
  total: {
    term: 'Total',
    definition:
      'A bet on the combined score of both teams, not on who wins. Also called over/under.',
    example: 'Over 8.5 wins if the two teams score 9 or more between them.',
  },
  team_total: {
    term: 'Team Total',
    definition: "A bet on one team's score alone, regardless of the result.",
  },
  over: {
    term: 'Over',
    definition: 'The score must finish above the line.',
  },
  under: {
    term: 'Under',
    definition: 'The score must finish below the line.',
  },
  double_chance: {
    term: 'Double Chance',
    definition:
      'Covers two of football’s three outcomes at once. Shorter odds, because it is harder to lose.',
    example: 'Arsenal or Draw loses only if the opponent wins.',
  },
  parlay: {
    term: 'Parlay',
    definition:
      'Several selections combined into one bet. Every leg must win; one loss and the whole thing goes.',
  },
  same_game_parlay: {
    term: 'Same Game Parlay',
    definition:
      'A parlay whose legs all come from one fixture. The legs affect one another, so the combined chance is not simply the individual chances multiplied.',
  },
  leg: {
    term: 'Leg',
    definition: 'One selection within a parlay.',
  },
  push: {
    term: 'Push',
    definition:
      'The result lands exactly on the line, so neither side wins and the stake is returned.',
    example: 'A 3-point win against a -3 spread.',
  },
  decimal_odds: {
    term: 'Decimal Odds',
    definition: 'Total returned for each 1 staked, stake included. 2.50 returns 2.50 per 1.',
  },
  fractional_odds: {
    term: 'Fractional Odds',
    definition: 'Profit relative to stake. 3/2 pays 3 profit for every 2 staked.',
  },
  american_odds: {
    term: 'American Odds',
    definition:
      'A positive number is the profit on a 100 stake; a negative one is the stake needed to win 100.',
  },
  implied_probability: {
    term: 'Implied Probability',
    definition:
      'What a price says about the chance of an outcome, calculated as 1 divided by the decimal odds.',
    example: 'Odds of 2.00 imply 50%.',
  },
  margin: {
    term: 'Bookmaker Margin',
    definition:
      'Prices across a market imply more than 100% between them. The excess is the bookmaker’s built-in edge.',
  },
  fair_probability: {
    term: 'Fair Probability',
    definition:
      'The market’s view with the bookmaker’s margin removed, so it can be compared with a model probability like for like.',
  },
  model_edge: {
    term: 'Model Edge',
    definition:
      'The gap between our model’s probability and the price’s. It marks disagreement, not a guaranteed advantage — the model can be the one that is wrong.',
  },
  model_probability: {
    term: 'Model Probability',
    definition:
      'How often this outcome happened across thousands of simulations of the fixture, based on past results.',
  },
  model_confidence: {
    term: 'Model Confidence',
    definition:
      'How much the estimate can be relied on, which is a separate question from how likely the outcome is. A thin sample can produce a high probability with low confidence.',
  },
  data_quality: {
    term: 'Data Quality',
    definition:
      'How much real information the projection stands on: completed matches, standings, and how recent they are.',
  },
  correlation: {
    term: 'Correlation',
    definition:
      'Whether selections move together. Two bets on the same game usually do, so their combined chance is not the product of the two.',
  },
  cover: {
    term: 'Cover',
    definition: 'To beat the handicap. A team can win and still fail to cover.',
  },
  bet_builder: {
    term: 'Bet Builder',
    definition:
      'Combining several selections from a single fixture into one bet.',
  },
  verified_market: {
    term: 'Verified Market',
    definition:
      'A named bookmaker was quoting this exact line when we last checked. It reflects a real price, not one we derived.',
  },
  model_market: {
    term: 'Model Projection',
    definition:
      'A line our model derived from its own simulations. Nobody has confirmed a bookmaker offers it, so it is analysis rather than a placeable bet.',
  },
};

export function glossary(key: string): GlossaryEntry | null {
  return GLOSSARY[key] ?? null;
}

/** Glossary key for a market, given the sport's name for it. */
export function glossaryKeyForMarket(type: string, sport: string): string {
  if (type === 'spread') {
    if (sport === 'mlb') return 'run_line';
    if (sport === 'nhl') return 'puck_line';
    return 'spread';
  }
  if (type === 'moneyline' && sport === 'football') return 'match_result';
  return type;
}
