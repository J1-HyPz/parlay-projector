# Design system

The vocabulary every page draws from. It exists because the application had
grown past the point where a component could be written by copying the one next
to it: fifty-three distinct white-alpha values across roughly seven hundred
usages, twenty-seven of them for text, and four separate implementations of a
status badge that disagreed about what a finished game looks like.

Everything below is defined once, in [`app/globals.css`](../app/globals.css) or
under [`components/ui/`](../components/ui). Nothing here is a suggestion — a
raw `white/38` in a component is a bug, because it is a decision being made
somewhere it cannot be seen.

## Colour

### Text: the ink ramp

Five steps. **Every one clears WCAG AA for normal text against the page
background**, which is the reason there are five rather than twenty-seven.

| Token | Contrast | For |
| --- | --- | --- |
| `text-ink-strong` | 18.8:1 | Headings, scores, the number on a stat card |
| `text-ink` | 13.1:1 | Body copy, team names |
| `text-ink-muted` | 9.3:1 | Labels, secondary values |
| `text-ink-subtle` | 6.9:1 | Metadata, captions, venue lines |
| `text-ink-faint` | 5.5:1 | The smallest labels — still readable |
| `text-ink-disabled` | 3.3:1 | **Inactive controls only** |

`text-ink-disabled` is the one step that fails, deliberately: WCAG exempts
inactive controls, and a disabled chip that looks enabled is its own problem.
Nothing carrying information may use it.

The ramp is stated in `oklch` because lightness is perceptually uniform there —
the steps look evenly spaced as well as testing evenly spaced. The small chroma
at hue 285 keeps the faint violet cast the design already had.

**What this replaced.** `white/28` was the most-used text colour in the
codebase — 61 occurrences, almost all on 10px and 11px labels. Measured against
the page background it is **2.35:1**. So were the game status, the venue and
the kick-off time on every card in the application.

### Surfaces and lines

| Token | For |
| --- | --- |
| `bg-surface-1` | A panel, a resting control |
| `bg-surface-2` | Hover, a nested block |
| `bg-surface-3` | Pressed, a skeleton bar |
| `border-line` | Separating |
| `border-line-strong` | Enclosing, hover on a bordered control |

These are not text, so no contrast floor applies to them.

### Status

One tone per status, in [`lib/schedule/status.ts`](../lib/schedule/status.ts)
beside the labels. **Colour is never the only signal** — every badge carries its
word, and live carries a pulsing dot as a third cue.

`text-status-live` · `text-status-upcoming` · `text-status-settled` ·
`text-status-warn` · `text-status-good` · `text-status-bad`

`--status-bad` and `--status-live` are the same rose today and named separately
on purpose: "this game is on" and "this bet lost" are different facts that
happened to be drawn the same way, and finding every instance of one without
the other meant reading each call site.

For a badge, use the whole tone rather than its parts — `.tone-good`,
`.tone-warn`, `.tone-bad`, `.tone-live`, `.tone-neutral` set border, background
and text together. Amber alone had grown four different text values across the
application with no rule for which; these are the rule.

Two colours stay literal on purpose, because they are not statuses: the
watchlist star is gold because a star is gold, and the podium tones in
`event-body` are gold, silver and bronze. Folding first place into "warning"
amber would make the ramp mean nothing.

## Type

| Class | Size | For |
| --- | --- | --- |
| `text-2xs` | 11px | Labels, badges, metadata |
| `text-xs` | 12px | Dense body, table cells |
| `text-sm` | 14px | Body |
| `text-base` | 16px | Section headings |
| `text-2xl` / `text-3xl` | 24 / 30px | Page titles, stat values |

`text-2xs` is the floor. It replaced ad-hoc `text-[9px]`, `text-[10px]` and
`text-[11px]` — three steps where the design only ever meant one, and the
smaller two of which were unreadable at the contrast they were set in.

## Layout

Mobile first. The breakpoints the application actually uses:

| | Width | What changes |
| --- | --- | --- |
| base | 320px+ | One column. Stat cards two across |
| `sm` | 640px | Cards two across, controls side by side |
| `md` | 768px | Chip rows **wrap** instead of scrolling |
| `lg` | 1024px | Sidebar and desktop header appear; tab bar goes |
| `xl` | 1280px | Two-column page layouts; the Schedule table |

**The Schedule table waits for `xl` on purpose.** Its columns come to about
910px of fixed and minimum widths. It used to appear at `md` — 768px — where it
did not fit, and because the document suppresses horizontal scrolling it was
*clipped* rather than scrolled: on an 805px viewport the row needed 906px in a
747px box, putting Broadcast half off-screen and Status and the watch control
entirely past the edge. Every tablet lost the status of every fixture. The band
it vacated gets a two-column card grid, which suits that width better anyway.

## Components

| Component | Replaced |
| --- | --- |
| `StatCard`, `StatGrid` | Four near-identical copies, one per page |
| `StatusBadge` | Four badges from three tone tables |
| `Chip`, `ChipRow` | Two chip implementations, one with a state the other lacked |
| `Crest` | Six raw `<img>` tags with no error handling |
| `EmptyState` / `ErrorState` | Nine hand-rolled "nothing here" blocks |
| `InlineEmpty` / `InlineError` | The section-level pair, previously in `hub-pieces` |
| `EmptyNote` | The in-panel variant, previously local to `game-sections` |
| `StaleNotice` | The degraded-data banner |

### Why there are three kinds of empty

They sit at different levels, and using the wrong one lies about scope:

- **`EmptyState`** — a centred panel. The whole page found nothing.
- **`InlineEmpty`** — one row. This section found nothing; the page is fine.
- **`EmptyNote`** — bare text. Inside a panel that already has its own chrome,
  where a bordered box nested in a bordered box reads as a fault.

And empty is never error. An empty result is a fact about the data; a failed
request is a fact about the request, and only the second one offers a retry.
Before this, a provider outage and a quiet Tuesday looked identical.

## Accessibility

- **Focus.** `.focus-ring` (or `.focus-ring-inset` inside a clipping container)
  on everything focusable. Forty hand-written rings at two different opacities
  became one class — and the primary navigation, which had none at all, got it.
- **Touch targets.** `.tap-target` grows the hit area to 44px with a padded
  pseudo-element while the visible chrome stays its designed size. The watch
  and slip controls are 32px squares whose centres now sit exactly 44px apart,
  so their targets abut without overlapping.
- **Motion.** One `prefers-reduced-motion` rule in `globals.css` covers the
  whole application, rather than per-component `motion-safe:` pairs that the
  next component can forget.
- **Skip link.** Every page begins with a brand, five nav items and a bell.

## Performance

`Crest` reserves its box by CSS before any request finishes, so a list of
twenty fixtures does not reflow as the provider's CDN answers, and a 404 leaves
the team's initials rather than a broken-image glyph.

On Live, which refreshes every thirty seconds, scores are `tabular-nums` in a
`min-w-[2ch]` right-aligned box — 9 to 10 does not shunt the team name beside
it — and cards are keyed by game id so React updates in place.
