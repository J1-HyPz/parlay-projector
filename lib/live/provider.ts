/**
 * Live provider boundary. Same contract idea as the other providers: one
 * interface, one implementation, swappable without touching routes or
 * components.
 */

import type { ConcreteSportId } from '../home/types';
import type { LiveGame } from './types';

export interface LiveProvider {
  readonly name: string;
  /**
   * Games currently in progress for one sport.
   * Throws `ProviderError` on failure; the service decides how to degrade.
   */
  liveForSport(sport: ConcreteSportId, providerSport: string): Promise<LiveGame[]>;
}
