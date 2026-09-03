/**
 * Notification settings a reader can change from the application.
 *
 * The environment supplies defaults; anything stored overrides them. Pure, so
 * the merge and the validation are testable without a filesystem.
 *
 * One thing is deliberately *not* settable here: the webhook URL. It is a
 * credential, this application has no authentication, and an endpoint that
 * accepted a new one would let anyone who can reach the server redirect the
 * notifications to a channel of their own. It stays in the environment, is
 * never returned by an API, and is never rendered — the settings only report
 * whether one is present.
 */

import { NOTIFY_EVENTS } from './types.ts';
import type { NotifyEvent } from './types.ts';

export const SETTINGS_FILENAME = 'notify-settings.json';

/** Floor on the poll interval; below this the provider is being hammered. */
export const MIN_POLL_SECONDS = 60;
export const MAX_POLL_SECONDS = 6 * 60 * 60;

export interface NotifySettings {
  /** Master switch. Off means nothing is sent, whatever the events say. */
  enabled: boolean;
  /** Transitions to announce. */
  events: NotifyEvent[];
  /** How often fixtures are re-checked. */
  pollSeconds: number;
  /** Ceiling on games announced in one poll. */
  maxPerPoll: number;
}

/** Stored overrides. Every field optional — an absent one keeps the default. */
export interface StoredSettings {
  enabled?: boolean;
  events?: NotifyEvent[];
  pollSeconds?: number;
  maxPerPoll?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Only entries naming a real transition survive. */
export function cleanEvents(raw: unknown): NotifyEvent[] | null {
  if (!Array.isArray(raw)) return null;

  const seen = new Set<NotifyEvent>();
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const value = entry.trim().toLowerCase();
    if ((NOTIFY_EVENTS as readonly string[]).includes(value)) seen.add(value as NotifyEvent);
  }
  return [...seen];
}

/**
 * Validate what came off disk or out of a request body.
 *
 * Returns only the fields that were both present and usable, so a partial or
 * hand-edited file falls back to the environment for everything else rather
 * than being rejected wholesale.
 */
export function parseSettings(raw: unknown): StoredSettings {
  if (!raw || typeof raw !== 'object') return {};
  const value = raw as Record<string, unknown>;
  const settings: StoredSettings = {};

  if (typeof value.enabled === 'boolean') settings.enabled = value.enabled;

  const events = cleanEvents(value.events);
  if (events !== null) settings.events = events;

  if (typeof value.pollSeconds === 'number' && Number.isFinite(value.pollSeconds)) {
    settings.pollSeconds = clamp(
      Math.round(value.pollSeconds),
      MIN_POLL_SECONDS,
      MAX_POLL_SECONDS,
    );
  }

  if (typeof value.maxPerPoll === 'number' && Number.isFinite(value.maxPerPoll)) {
    settings.maxPerPoll = clamp(Math.round(value.maxPerPoll), 1, 100);
  }

  return settings;
}

export interface SettingsDefaults {
  events: string[];
  pollIntervalMs: number;
  maxPerPoll: number;
}

/** Stored values over environment defaults. */
export function resolveSettings(
  defaults: SettingsDefaults,
  stored: StoredSettings,
): NotifySettings {
  const fallbackEvents = cleanEvents(defaults.events) ?? [];

  return {
    // Enabled unless explicitly turned off; the presence of a webhook is a
    // separate question, answered by the caller.
    enabled: stored.enabled ?? true,
    events: stored.events ?? fallbackEvents,
    pollSeconds:
      stored.pollSeconds ??
      clamp(Math.round(defaults.pollIntervalMs / 1000), MIN_POLL_SECONDS, MAX_POLL_SECONDS),
    maxPerPoll: stored.maxPerPoll ?? clamp(defaults.maxPerPoll, 1, 100),
  };
}

/** Whether a transition should be announced under these settings. */
export function announces(settings: NotifySettings, event: NotifyEvent): boolean {
  return settings.enabled && settings.events.includes(event);
}
