/**
 * Saying what a bet actually means.
 *
 * "Houston Astros +1.5" is opaque unless you already know. The old interface
 * printed exactly that and a percentage beside it, which told a reader who
 * already understood the market nothing new, and a reader who did not
 * understand it nothing at all.
 *
 * Every function here turns a settlement rule into words. They are generated
 * from the rule rather than written per market, so a line the model has never
 * produced before still explains itself, and the explanation cannot drift away
 * from how the selection is actually settled — both read the same object.
 *
 * The wording is deliberately concrete: what must happen, and what loses. A
 * "+1.5" explained as "a 1.5-run advantage" is still jargon. Explained as "can
 * win, or lose by exactly one run" it is not.
 *
 * Pure, and directly unit-testable.
 */

import { finishMarketLabel } from './types.ts';
import type { MarketType, SettlementRule, Side } from './types.ts';
import type { ConcreteSportId } from '../home/types';

/** What a fixture in this sport is scored in. */
interface Vocabulary {
  /** `run`, `point`, `goal`. */
  unit: string;
  /** What the fixture is called: `game`, `match`. */
  contest: string;
  /** Sport's name for a handicap market. */
  spread: string;
  /** Sport's name for the outright-winner market. */
  moneyline: string;
  /** Whether a drawn result is possible, which changes what "loses" means. */
  hasDraw: boolean;
}

const DEFAULT_VOCABULARY: Vocabulary = {
  unit: 'point',
  contest: 'game',
  spread: 'Point Spread',
  moneyline: 'Moneyline',
  hasDraw: false,
};

/**
 * Per-sport vocabulary.
 *
 * Baseball's handicap is a Run Line and hockey's is a Puck Line; they are the
 * same market and a reader looking for one will not recognise the other's
 * name. Football is a three-way market, which changes both the name and, more
 * importantly, what it takes to lose.
 */
const VOCABULARY: Partial<Record<ConcreteSportId, Vocabulary>> = {
  nfl: DEFAULT_VOCABULARY,
  nba: DEFAULT_VOCABULARY,
  mlb: { unit: 'run', contest: 'game', spread: 'Run Line', moneyline: 'Moneyline', hasDraw: false },
  nhl: {
    unit: 'goal',
    contest: 'game',
    spread: 'Puck Line',
    moneyline: 'Moneyline',
    hasDraw: false,
  },
  football: {
    unit: 'goal',
    contest: 'match',
    spread: 'Goal Handicap',
    moneyline: 'Match Result',
    hasDraw: true,
  },
  /*
   * Motorsport shares none of the vocabulary above. It is a race, not a game;
   * it is finished in a position, not won by a score; and it has no handicap
   * or moneyline at all. The entries that cannot apply are named for what a
   * race does have, so a stray call reads sensibly rather than saying "Point
   * Spread" about a Grand Prix.
   */
  f1: {
    unit: 'place',
    contest: 'race',
    spread: 'Finishing Position',
    moneyline: 'Race Winner',
    hasDraw: false,
  },
};

export function vocabularyFor(sport: ConcreteSportId): Vocabulary {
  return VOCABULARY[sport] ?? DEFAULT_VOCABULARY;
}

/** Names of the two sides, needed to turn a rule into a sentence. */
export interface FixtureNames {
  homeTeam: string;
  awayTeam: string;
  sport: ConcreteSportId;
}

function teamFor(side: Side, names: FixtureNames): string {
  if (side === 'home') return names.homeTeam;
  if (side === 'away') return names.awayTeam;
  return 'the draw';
}

function other(side: 'home' | 'away', names: FixtureNames): string {
  return side === 'home' ? names.awayTeam : names.homeTeam;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Market names
// ---------------------------------------------------------------------------

/**
 * The market's name, in the terms the sport uses.
 *
 * Shown as a label beside every selection so the *kind* of bet is never left
 * to be inferred from the line.
 */
export function marketLabel(type: MarketType, sport: ConcreteSportId): string {
  const vocabulary = vocabularyFor(sport);

  switch (type) {
    case 'moneyline':
      return vocabulary.moneyline;
    case 'spread':
      return vocabulary.spread;
    case 'total':
      return `Total ${vocabulary.unit === 'point' ? 'Points' : `${capitalise(vocabulary.unit)}s`}`;
    case 'team_total':
      return `Team Total ${vocabulary.unit === 'point' ? 'Points' : `${capitalise(vocabulary.unit)}s`}`;
    case 'double_chance':
      return 'Double Chance';
    case 'finish_position':
      return 'Finishing Position';
    case 'head_to_head':
      return 'Head-to-Head';
  }
}

/**
 * The specific name of a finishing market.
 *
 * `marketLabel` only knows the market type, which cannot distinguish a podium
 * from a points finish — those differ by how many places they cover, which
 * lives on the rule.
 */
export function raceMarketLabel(rule: SettlementRule): string {
  if (rule.kind === 'finish_position') return finishMarketLabel(rule.within);
  if (rule.kind === 'head_to_head') return 'Driver Head-to-Head';
  return 'Finishing Position';
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A signed line as it is written on a betting slip: `+1.5`, `-3.5`. */
export function formatLine(line: number): string {
  return line > 0 ? `+${line}` : String(line);
}

/**
 * The selection as a book would print it.
 *
 * `Houston Astros +1.5`, `Over 8.5`, `Arsenal or Draw`. This is the headline
 * on a leg — the single most important line of text on the card.
 */
export function selectionLabel(rule: SettlementRule, names: FixtureNames): string {
  const vocabulary = vocabularyFor(names.sport);

  switch (rule.kind) {
    case 'winner':
      return rule.side === 'draw' ? 'Draw' : teamFor(rule.side, names);

    case 'double_chance': {
      const sides = rule.sides.map((side) => (side === 'draw' ? 'Draw' : teamFor(side, names)));
      return sides.join(' or ');
    }

    case 'spread':
      return `${teamFor(rule.side, names)} ${formatLine(rule.line)}`;

    case 'total':
      return `${capitalise(rule.direction)} ${rule.line}`;

    case 'team_total':
      return `${teamFor(rule.side, names)} ${capitalise(rule.direction)} ${rule.line} ${vocabulary.unit}s`;

    case 'finish_position': {
      if (rule.within === 1) return `${rule.entrant} to win`;
      if (rule.within === 3) return `${rule.entrant} podium`;
      return `${rule.entrant} top ${rule.within}`;
    }

    case 'head_to_head':
      return `${rule.entrant} to beat ${rule.over}`;
  }
}

// ---------------------------------------------------------------------------
// What needs to happen
// ---------------------------------------------------------------------------

/**
 * Plain English for a selection.
 *
 * The whole point of the rewrite. Derived from the settlement rule, so it is
 * exactly the condition the result will later be judged against — an
 * explanation that could contradict the settlement would be worse than none.
 *
 * Whole-number lines are called out where they can end level, because "push"
 * is the case people are most often surprised by.
 */
export function whatNeedsToHappen(rule: SettlementRule, names: FixtureNames): string {
  const vocabulary = vocabularyFor(names.sport);
  const { unit, contest } = vocabulary;

  switch (rule.kind) {
    case 'winner': {
      if (rule.side === 'draw') return `The ${contest} must end level.`;
      const team = teamFor(rule.side, names);
      return vocabulary.hasDraw
        ? `${team} must win the ${contest}. A draw loses this selection.`
        : `${team} must win the ${contest}.`;
    }

    case 'double_chance': {
      const backed = rule.sides;
      const losing = (['home', 'away', 'draw'] as const).filter((side) => !backed.includes(side));
      const backedNames = backed
        .map((side) => (side === 'draw' ? 'the draw' : teamFor(side, names)))
        .join(' or ');
      const losingNames = losing
        .map((side) => (side === 'draw' ? 'a draw' : `a ${teamFor(side, names)} win`))
        .join(' or ');
      return `Any of ${backedNames}. Only ${losingNames} loses this selection.`;
    }

    case 'spread': {
      const team = teamFor(rule.side, names);
      const opponent = other(rule.side, names);
      const whole = Number.isInteger(rule.line);

      if (rule.line > 0) {
        // Receiving points. The largest defeat that still wins.
        const allowed = whole ? rule.line - 1 : Math.floor(rule.line);
        const push = whole ? ` A defeat by exactly ${plural(rule.line, unit)} is a push and the stake is returned.` : '';

        if (allowed <= 0) {
          return `${team} must win the ${contest}.${push}`;
        }
        if (allowed === 1) {
          return `${team} must win, or lose by exactly one ${unit}. A defeat by two or more loses this selection.${push}`;
        }
        return `${team} must win, or lose by no more than ${plural(allowed, unit)}. A defeat by ${plural(allowed + 1, unit)} or more loses this selection.${push}`;
      }

      if (rule.line < 0) {
        // Giving points. The smallest winning margin that still wins.
        const size = Math.abs(rule.line);
        const needed = whole ? size + 1 : Math.floor(size) + 1;
        const push = whole ? ` A win by exactly ${plural(size, unit)} is a push and the stake is returned.` : '';
        return `${team} must beat ${opponent} by at least ${plural(needed, unit)}.${push}`;
      }

      return `${team} must win the ${contest}. A draw returns the stake.`;
    }

    case 'total': {
      const whole = Number.isInteger(rule.line);
      const push = whole
        ? ` Exactly ${plural(rule.line, unit)} is a push and the stake is returned.`
        : '';

      if (rule.direction === 'over') {
        const needed = whole ? rule.line + 1 : Math.floor(rule.line) + 1;
        return `The two teams must combine for at least ${plural(needed, unit)}.${push}`;
      }
      const most = whole ? rule.line - 1 : Math.floor(rule.line);
      return `The two teams must combine for ${plural(most, unit)} or fewer.${push}`;
    }

    case 'team_total': {
      const team = teamFor(rule.side, names);
      const whole = Number.isInteger(rule.line);
      const push = whole
        ? ` Exactly ${plural(rule.line, unit)} is a push and the stake is returned.`
        : '';

      if (rule.direction === 'over') {
        const needed = whole ? rule.line + 1 : Math.floor(rule.line) + 1;
        return needed === 1
          ? `${team} must score at least one ${unit}.${push}`
          : `${team} must score at least ${plural(needed, unit)}.${push}`;
      }
      const most = whole ? rule.line - 1 : Math.floor(rule.line);
      return most === 0
        ? `${team} must not score.${push}`
        : `${team} must score ${plural(most, unit)} or fewer.${push}`;
    }

    case 'finish_position': {
      if (rule.within === 1) {
        return `${rule.entrant} must win the ${contest}.`;
      }
      const ordinal = rule.within === 3 ? 'top three' : `top ${rule.within}`;
      /*
       * A retirement is still classified, so it is a losing position rather
       * than an untested selection. Saying so is the difference between a
       * reader understanding this market and being surprised by it.
       */
      const points = rule.within === 10 ? ' A points finish in a standard race.' : '';
      return `${rule.entrant} must be classified in the ${ordinal}. Finishing ${
        rule.within + 1
      }th or lower, or retiring, loses this selection.${points}`;
    }

    case 'head_to_head':
      return `${rule.entrant} must be classified ahead of ${rule.over}. If ${rule.entrant} retires and ${rule.over} does not, this loses.`;
  }
}

// ---------------------------------------------------------------------------
// Naming the probability
// ---------------------------------------------------------------------------

/**
 * What the probability on this selection is a probability *of*.
 *
 * Every number used to be labelled "Estimated probability", which flattened
 * four different quantities into one word. A win probability and a cover
 * probability answer different questions and routinely differ by twenty
 * points on the same fixture.
 */
export function probabilityLabel(type: MarketType): string {
  switch (type) {
    case 'moneyline':
      return 'Win probability';
    case 'double_chance':
      return 'Win or draw probability';
    case 'spread':
      return 'Cover probability';
    case 'total':
    case 'team_total':
      return 'Over/under probability';
    case 'finish_position':
      return 'Finish probability';
    case 'head_to_head':
      return 'Head-to-head probability';
  }
}

/** The same, in a sentence, for the expanded analysis. */
export function probabilityMeaning(type: MarketType, sport: ConcreteSportId): string {
  const { contest } = vocabularyFor(sport);

  switch (type) {
    case 'moneyline':
      return `How often this side wins the ${contest} outright across the simulations.`;
    case 'double_chance':
      return 'How often this side either wins or draws across the simulations.';
    case 'spread':
      return 'How often this selection beats the handicap across the simulations.';
    case 'total':
      return 'How often the combined score falls on this side of the line across the simulations.';
    case 'team_total':
      return "How often this team's own score falls on this side of the line across the simulations.";
    case 'finish_position':
      return 'How often this driver is classified inside that position across the simulated races.';
    case 'head_to_head':
      return 'How often this driver is classified ahead of the other across the simulated races.';
  }
}
