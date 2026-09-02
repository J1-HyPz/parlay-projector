# Notifications

Game updates are delivered to a **Discord webhook**. There is no in-app inbox:
the bell in the header links to `/notifications`, which reports delivery status
and nothing else.

## The watchlist

**Only games on the watchlist are announced.** An empty watchlist sends nothing.

Star a game from the Schedule, Live or Home cards, or from its detail page. The
current list is on `/notifications`, which is also where you can remove entries.

A game leaves the list automatically when the poller sees it **finish** or be
**cancelled** — you never have to tidy up after a match. Two details:

- **Removal follows the observed status, not the message.** A game that finishes
  while notifications are off still leaves the list.
- **A postponed game stays.** Postponements are usually rescheduled under the
  same fixture id, so it keeps its place. If it never resumes, the staleness rule
  below removes it.

**Staleness.** Anything still listed 48 hours after its kick-off is dropped. That
is the safety net for fixtures the poller never sees finish: a postponement that
is abandoned, or a game that falls out of the provider feed.

There is **one shared list**, not a list per person — the application has no
accounts. `/api/watchlist` has no authentication either, consistent with the rest
of the app: anyone who can reach the server can change it. That is fine on a LAN.
Do not expose this host to the internet without putting authentication in front
of it.

## What gets sent

The poller compares today's fixtures against the statuses it saw on the previous
run and announces the differences. Four transitions are supported, all enabled by
default and selectable with `NOTIFY_EVENTS`:

| Event | Fires when | Example |
| --- | --- | --- |
| `kickoff` | `scheduled` -> `live` | `⚽ **Kick-off** — Arsenal v Chelsea · Premier League` |
| `final` | `scheduled`/`live` -> `finished` | `🏈 **Final** — Bills 24–27 Chiefs · NFL` |
| `postponed` | `scheduled`/`live` -> `postponed` | `⚾ **Postponed** — Cubs v Reds · MLB` |
| `cancelled` | `scheduled`/`live` -> `cancelled` | `🏒 **Cancelled** — Bruins v Rangers · NHL` |

Set `APP_BASE_URL` to append a link to each game's detail page. Without it,
messages carry no link — a relative path is useless in a chat client, and
guessing a hostname would produce links that go nowhere.

## Setup

1. In Discord: **Server Settings → Integrations → Webhooks → New Webhook**,
   choose the channel, then **Copy Webhook URL**.
2. Put that URL in `DISCORD_WEBHOOK_URL` in the **app environment** — on TrueNAS,
   *Edit → Environment Variables*. Never in a committed file.
3. Redeploy. The startup log line `notifier_started` confirms it is running.

`GET /api/internal/notifications` reports whether a webhook is configured and
which events are active. It never returns the URL.

## The webhook URL is a credential

Anyone holding it can post to your channel. It is:

- read from the environment only, never committed (`.env*` is git-ignored),
- never logged — failures record a status code, not a URL,
- never sent to the browser, and never included in an API response,
- validated to be a Discord webhook address, so a misconfiguration cannot post
  somewhere else. A non-Discord URL is refused and reported on `/notifications`.

If it leaks, delete the webhook in Discord and create a new one. Rotating is the
only remedy — a webhook URL cannot be revoked any other way.

## Design decisions

**Watchlist writes are serialised.** Two tabs starring games at the same moment
would otherwise each read the same list, add one entry, and the second write
would discard the first. Pruning reads inside the same lock, so a game starred
while the poller is fetching fixtures cannot be erased by a prune working from a
stale copy.

**A game seen for the first time is never announced.** State lives in
`$DATA_DIR/notify-state.json`, and after a redeploy that file may be missing or
stale. Announcing every game already in progress would replay a whole afternoon
into the channel at once, so an unseen game is recorded silently and only its
*next* transition is news. The cost is one missed notification per game across a
restart; a flood is the worse failure.

**A recovery from `unknown` is not a transition.** Providers occasionally report
a status they cannot classify. Treating `unknown -> live` as a kick-off would fire
a second message for a game that never stopped.

**Notifications batch.** A busy Saturday produces one message with twenty lines,
not twenty messages. That stays well inside Discord's webhook rate limit, and
`NOTIFY_MAX_PER_POLL` caps how much a backlog can emit at once.

**Mentions are disabled on every payload.** Every message sets
`allowed_mentions: { parse: [] }`, so no team name, league label or venue can
produce an `@everyone` ping. Provider text is also markdown-escaped.

**A total fixture failure skips the poll.** If every league's request fails, the
result is indistinguishable from an empty day. Recording that would make the next
poll treat the entire schedule as newly seen, so the poll is abandoned instead.

## Cost

The poller reuses the same cached fixture fetch the Home and Live pages make, so
it adds no provider requests of its own beyond forcing that cache to refresh on
its interval. The default of five minutes is deliberately close to the fixture
cache lifetime; polling faster costs requests without improving latency.

## Limitations

- **Single instance.** The timer runs in-process. Two replicas would each poll
  and send, producing duplicates. The application is deployed as one container.
- **Five-minute granularity.** A kick-off is announced on the next poll after it
  happens, not at the whistle. Lower `NOTIFY_POLL_INTERVAL_MS` (floor: 60s) to
  tighten that, at the cost of more provider requests.
- **No per-team subscriptions.** The watchlist is per *game*, not per team or
  league, so a team you follow has to be starred fixture by fixture. Standing
  subscriptions would need an account to hang them on.
- **A game must be visible to be starred.** Only fixtures inside the eight-day
  schedule window can be added, because that is what the pages render.
- **200 entries.** Adds beyond that are refused and logged.
