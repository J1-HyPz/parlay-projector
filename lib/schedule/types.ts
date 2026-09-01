/**
 * Schedule API contract.
 *
 * Reuses the shared `Game` model so a schedule row and a Home card are the same
 * shape, and both open the same `/games/:id` detail page.
 */

import type { Game } from '../home/types';

export type ScheduleErrorCode = 'schedule_data_unavailable';

export interface ScheduleResponse {
  /** Today in the application timezone, YYYY-MM-DD. */
  start_date: string;
  /** Today + 7, inclusive. */
  end_date: string;
  /** Every date in the window, ascending. Always 8 entries. */
  dates: string[];
  timezone: string;
  games: Game[];
  /** Present only when every provider request failed. */
  error?: ScheduleErrorCode;
}
