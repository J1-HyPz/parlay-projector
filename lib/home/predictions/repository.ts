/**
 * Prediction storage.
 *
 * The homepage only needs to *read* settled predictions, so no database is
 * introduced for that. Records live in a JSON file under DATA_DIR, which is a
 * configurable path meant to be a mounted volume in production — a container
 * filesystem is ephemeral and would lose history on every redeploy.
 *
 * Deliberately behind a small interface: moving to Postgres later means adding
 * another implementation, not touching the accuracy service.
 *
 * No file, an empty file or a malformed file all mean the same thing to the
 * homepage: no prediction history, so accuracy is null.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../../config';
import { logger } from '../../logger';
import { isPredictionRecord } from './accuracy';
import type { PredictionRecord } from './accuracy';

export const PREDICTIONS_FILENAME = 'predictions.json';

/** 16 MiB ceiling so a runaway file cannot exhaust memory. */
const MAX_FILE_BYTES = 16 * 1024 * 1024;

export interface PredictionRepository {
  readonly name: string;
  all(): Promise<PredictionRecord[]>;
}

export function predictionsFilePath(): string {
  return path.join(DATA_DIR, PREDICTIONS_FILENAME);
}

/**
 * Accepts either a bare array or `{ "predictions": [...] }`, so a future writer
 * can add metadata alongside the records without breaking reads.
 */
function extractRecords(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const wrapped = (parsed as { predictions?: unknown }).predictions;
    if (Array.isArray(wrapped)) return wrapped;
  }
  return [];
}

export function createFilePredictionRepository(): PredictionRepository {
  return {
    name: 'file',

    async all(): Promise<PredictionRecord[]> {
      const file = predictionsFilePath();

      let raw: string;
      try {
        raw = await readFile(file, 'utf-8');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          // Expected before any predictions exist. Not an error condition.
          return [];
        }
        logger.warn('prediction_store_unreadable', { reason: code ?? 'unknown' });
        return [];
      }

      if (raw.length > MAX_FILE_BYTES) {
        logger.warn('prediction_store_too_large', { bytes: raw.length });
        return [];
      }
      if (raw.trim().length === 0) return [];

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        logger.warn('prediction_store_invalid_json', {});
        return [];
      }

      const candidates = extractRecords(parsed);
      const records = candidates.filter(isPredictionRecord);

      if (records.length !== candidates.length) {
        logger.warn('prediction_store_records_skipped', {
          skipped: candidates.length - records.length,
          kept: records.length,
        });
      }

      return records;
    },
  };
}
