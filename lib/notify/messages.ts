/**
 * Rendering notifications into Discord webhook payloads.
 *
 * Pure, so the escaping and chunking rules are directly testable. Both matter:
 * team names are third-party data being interpolated into a formatted message
 * sent to a chat server, and Discord rejects a payload over its length limit
 * outright rather than truncating it.
 */

import type { GameNotification, NotifyEvent } from './types';

/** Discord's hard limit on `content`. */
export const MAX_CONTENT = 2000;

export interface DiscordPayload {
  content: string;
  /**
   * Empty parse list: no @everyone, @here or role ping can be produced, whatever
   * a team name or league label happens to contain.
   */
  allowed_mentions: { parse: [] };
}

const HEADLINE: Record<NotifyEvent, string> = {
  kickoff: 'Kick-off',
  final: 'Final',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
};

/** Sport id to emoji. The two American football leagues share a sport id, and an emoji. */
const SPORT_EMOJI: Record<string, string> = {
  nfl: '\u{1F3C8}',
  nba: '\u{1F3C0}',
  mlb: '\u26BE',
  nhl: '\u{1F3D2}',
  football: '\u26BD',
  tennis: '\u{1F3BE}',
};

/**
 * Neutralise Discord markdown in provider-supplied text.
 *
 * Not a security control -- `allowed_mentions` is what stops pings -- but a club
 * named with an underscore should not italicise the rest of the line.
 */
export function escapeMarkdown(value: string): string {
  return value.replace(/([\\*_~`|>])/g, '\\$1');
}

/** One notification as a single line of Discord markdown. */
export function formatLine(notification: GameNotification, linkBaseUrl = ''): string {
  const emoji = SPORT_EMOJI[notification.sport] ?? '\u{1F3C6}';
  const home = escapeMarkdown(notification.home);
  const away = escapeMarkdown(notification.away);

  const fixture =
    notification.event === 'final' && notification.score
      ? `${home} ${notification.score.home ?? '-'}\u2013${notification.score.away ?? '-'} ${away}`
      : `${home} v ${away}`;

  const parts = [`${emoji} **${HEADLINE[notification.event]}** \u2014 ${fixture}`];
  if (notification.league) parts.push(escapeMarkdown(notification.league));

  const line = parts.join(' \u00B7 ');

  // Only link when a public base URL is configured; a bare path is useless in
  // a chat client, and guessing a hostname would be worse.
  if (!linkBaseUrl) return line;
  return `${line} \u00B7 <${linkBaseUrl.replace(/\/+$/, '')}/games/${encodeURIComponent(notification.gameId)}>`;
}

/**
 * Group notifications into as few payloads as Discord's limit allows.
 *
 * A quiet poll sends nothing; a busy Saturday sends one message with twenty
 * lines rather than twenty messages, which is both easier to read and well
 * inside the webhook rate limit.
 */
export function buildPayloads(
  notifications: readonly GameNotification[],
  linkBaseUrl = '',
): DiscordPayload[] {
  const lines = notifications.map((n) => formatLine(n, linkBaseUrl));

  const payloads: DiscordPayload[] = [];
  let current: string[] = [];
  let length = 0;

  for (const line of lines) {
    // A single pathological line still has to go somewhere, so it is truncated
    // rather than dropped or allowed to fail the request.
    const safe = line.length > MAX_CONTENT ? `${line.slice(0, MAX_CONTENT - 1)}\u2026` : line;
    const added = current.length === 0 ? safe.length : length + 1 + safe.length;

    if (added > MAX_CONTENT) {
      payloads.push({ content: current.join('\n'), allowed_mentions: { parse: [] } });
      current = [safe];
      length = safe.length;
      continue;
    }

    current.push(safe);
    length = added;
  }

  if (current.length > 0) {
    payloads.push({ content: current.join('\n'), allowed_mentions: { parse: [] } });
  }
  return payloads;
}
