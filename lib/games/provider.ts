/**
 * Game detail provider boundary.
 *
 * Same contract idea as the Home page providers: one interface, one
 * implementation, swappable without touching routes or components.
 */

import type { GameDetail } from './types';

export interface GameDetailProvider {
  readonly name: string;
  /**
   * Full detail for one game.
   * Resolves to null when the provider has no such game (a 404 for the caller);
   * throws `ProviderError` when the provider itself failed.
   */
  gameById(gameId: string): Promise<GameDetail | null>;
}
