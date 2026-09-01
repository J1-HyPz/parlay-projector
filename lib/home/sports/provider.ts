/**
 * Sports provider boundary.
 *
 * Everything above this interface deals in Parlay Projector types. Everything
 * below it deals in one specific vendor's payloads. Replacing the provider
 * means writing one new implementation of `SportsProvider` and changing the
 * single line in `service.ts` that constructs it.
 */

import type { Game } from '../types';
import type { SportDefinition } from './normalise';

export interface SportsProvider {
  readonly name: string;
  /**
   * Games for one sport on one calendar day.
   * Should throw `ProviderError` on failure; the service decides how to degrade.
   */
  gamesOnDate(date: string, definition: SportDefinition): Promise<Game[]>;
}
