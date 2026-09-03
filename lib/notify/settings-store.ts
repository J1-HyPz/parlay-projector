/**
 * Persistence for the notification settings.
 *
 * Under DATA_DIR alongside the watchlist and the prediction history, so the
 * settings survive a redeploy like everything else that matters.
 *
 * A read failure means "no overrides", which falls back to the environment —
 * the same behaviour as before any of this existed, so a missing or corrupt
 * file degrades to the previous defaults rather than to silence.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, notifyConfig } from '../config';
import { logger } from '../logger';
import { SETTINGS_FILENAME, parseSettings, resolveSettings } from './settings';
import type { NotifySettings, StoredSettings } from './settings';

export function settingsPath(): string {
  return path.join(DATA_DIR, SETTINGS_FILENAME);
}

/** Stored overrides only. Empty when there are none. */
export async function readStoredSettings(): Promise<StoredSettings> {
  try {
    return parseSettings(JSON.parse(await readFile(settingsPath(), 'utf-8')));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      logger.warn('notify_settings_unreadable', { reason: code ?? 'parse_error' });
    }
    return {};
  }
}

/** The settings actually in force: stored values over environment defaults. */
export async function effectiveSettings(): Promise<NotifySettings> {
  return resolveSettings(
    {
      events: notifyConfig.events,
      pollIntervalMs: notifyConfig.pollIntervalMs,
      maxPerPoll: notifyConfig.maxPerPoll,
    },
    await readStoredSettings(),
  );
}

/** Serialises writes so two saves cannot interleave. */
let queue: Promise<unknown> = Promise.resolve();

function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const run = queue.then(operation, operation);
  queue = run.catch(() => undefined);
  return run;
}

export interface SaveResult {
  settings: NotifySettings;
  stored: boolean;
}

/**
 * Merge an update into the stored settings.
 *
 * Partial: a request that only changes the events leaves the interval alone.
 * A write failure is reported rather than thrown — the caller still gets the
 * settings that would have applied, and the log says why they did not stick.
 */
export function saveSettings(update: StoredSettings): Promise<SaveResult> {
  return exclusive(async () => {
    const merged: StoredSettings = { ...(await readStoredSettings()), ...update };
    const file = settingsPath();
    const temporary = `${file}.tmp`;

    let stored = true;
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(temporary, JSON.stringify(merged), 'utf-8');
      await rename(temporary, file);
      logger.info('notify_settings_saved', {
        enabled: merged.enabled,
        events: merged.events,
        pollSeconds: merged.pollSeconds,
      });
    } catch (error) {
      stored = false;
      logger.warn('notify_settings_unwritable', {
        reason: (error as NodeJS.ErrnoException)?.code ?? 'unknown',
      });
    }

    return {
      settings: resolveSettings(
        {
          events: notifyConfig.events,
          pollIntervalMs: notifyConfig.pollIntervalMs,
          maxPerPoll: notifyConfig.maxPerPoll,
        },
        merged,
      ),
      stored,
    };
  });
}
