/**
 * News provider boundary. Same contract idea as the sports provider: one
 * interface, one implementation, swappable without touching callers.
 */

import type { NewsArticle } from '../types';

export interface NewsProvider {
  readonly name: string;
  /** Recent articles as metadata only. Throws `ProviderError` on failure. */
  recent(): Promise<NewsArticle[]>;
}
