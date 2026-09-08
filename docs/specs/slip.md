# Spec — The Slip

**Status: built.** Shipped as `/slips`; see [docs/slip.md](../slip.md) for what it
does. This was the specification it was built from, kept for the record. Everything below is a decision, not an option, unless it
says otherwise.

---

## 1. What it is, in one sentence

Pick the matches you care about from anywhere in the application, and the
projection engine builds the strongest line it can from exactly those, at a
risk level you choose.

## 2. What it is not

The removed Builder failed by becoming a different product. These are hard
boundaries:

- **Not a bookmaker workspace.** No new odds provider, no API key, no paid
  quota, no `BUILDER_ODDS_*` equivalent. It uses the projection engine and the
  odds the application already reads.
- **Not a betting account.** No stake field, no placement, no deep links to a
  bookmaker, no "executable accumulator".
- **Not a second Parlays page.** Parlays keeps its automatic modes — best line
  across the card, and same-game within one fixture. The Slip is the manual
  counterpart: you choose the fixtures, it chooses the bets.
- **Not a new engine.** It reuses `buildCandidates`, `RISK_PROFILES` and
  `optimise`. If it needs a new model, the spec is wrong.

## 3. Decisions already taken

These are settled. Do not re-open them.

| # | Decision |
|---|---|
| 1 | It is called the **Slip**. Page at `/slip`, card action "Add to slip", count badge in the navigation |
| 2 | Picks live **server-side** under `DATA_DIR`, like the watchlist, and are **split into Active and Settled** — see §8 |
| 3 | Generated lines **do** enter the accuracy tracker, tagged as hand-picked — see §9 |

---

## 4. The interaction, and the thing to copy

The watchlist already does the hard half of this. **Copy its shape.**

```
Star a game anywhere  →  server-side list  →  panel to review  →  the notifier acts on it
Add a game anywhere   →  server-side slip  →  page to review   →  the engine builds a line
```

| Concern | Reuse from |
|---|---|
| Button on a card | `components/watchlist/watch-button.tsx` |
| Client state and optimistic toggle | `components/watchlist/watchlist-context.tsx` |
| Review surface | `components/watchlist/watchlist-panel.tsx` |
| API shape (`GET` / `POST` / `DELETE`) | `app/api/watchlist/route.ts` |
| Validation, clamping, pruning | `lib/watchlist/parse.ts` |
| Atomic file store | `lib/watchlist/store.ts` |

Two details from `watch-button.tsx` that are not optional:

- The button is a **sibling** of the card's link, never nested inside it. A
  button inside an anchor is invalid HTML and the click fights the navigation.
- It calls `preventDefault()` and `stopPropagation()`, because the card behind
  it is a link covering the whole row.

### Where a game can be added

Home, Schedule (desktop row and mobile card), Live, and Game Detail — the same
surfaces that carry the star, positioned beside it. A race weekend session is a
valid pick; a Grand Prix is a fixture like any other here.

### Where the slip is reviewed

A page at `/slip`, with a count badge in the navigation the way the watchlist
has one. The generated line is substantial enough to need a page rather than a
popover.

---

## 5. Generating the line

### The three roles, which must stay separate

| Decision | Whose |
|---|---|
| Which matches | The reader's |
| Which market on each | The model's |
| Whether a market qualifies at all | The risk profile's |

This is the whole feature. If the reader could also choose the market, it would
be the old bet builder; if the model could also choose the fixtures, it would be
Parlays.

### How

1. `buildCandidates()` for the sports and competitions the slip spans.
2. Narrow the candidate pool to the picked `game_id`s **before anything is
   ranked**. This is what makes the choice binding — the same guarantee the
   sport and competition filters give. There must be no later stage that could
   reach past it.
3. `optimise()` with the chosen `RISK_PROFILES` entry.
4. One leg per fixture, which is the existing correlation rule. Two markets on
   one match are nearly the same bet, and the product of their probabilities
   would report a confidence the model does not have.

### Risk levels

Low / Medium / High, using the existing profiles unchanged. Changing the risk
level must genuinely change the markets chosen, not relabel the same line. This
is testable and should be tested: the same three fixtures at Low and at High
should differ in legs, markets, or both.

### Length

Picking four matches asks for a four-leg line. That is what picking them means,
and the profile's default of three would otherwise drop one of the reader's
picks without saying so. An explicit leg count still wins, so "the best three of
these five" remains possible.

---

## 6. Honesty rules

These are the project's standing rules. They are not negotiable and existing
code already follows them.

- **Never pad.** A slip of five where three qualify produces a three-leg line,
  and says so. No weaker market is substituted to make the count.
- **Never substitute.** A leg never comes from a fixture the reader did not
  pick, however much better it scores.
- **Never fabricate odds or markets.** A selection with no bookmaker quote is
  labelled a model projection, not given an invented price.
- **Never present confidence as probability**, or a model probability as a
  guarantee.
- **Say what happened.** A picked match that contributes no leg must say which
  of these it was, because they call for different responses:
  - *Nothing clears this risk level* — say so, and that a lower level would
    include it.
  - *Not projectable* — already under way, or too little history. Say which.

## 7. Empty and edge states

| Situation | Behaviour |
|---|---|
| Slip empty | Explain what the page is for and where to add matches |
| One match picked | A line needs at least `MIN_LEGS`. Say so before it is hit, not after |
| No match clears the risk level | Say so; suggest a lower level. Never fall back to another fixture |
| A picked match kicked off | Report it as no longer projectable; keep the rest |
| A picked match is removed from the feed | Prune it the way the watchlist prunes, and say the slip changed |

## 8. Persistence, and the two sections

The slip is a server-side JSON file under `DATA_DIR`, written atomically, using
`lib/watchlist/store.ts` as the model.

### Active and Settled

The page shows two sections, decided by the game's status rather than by
anything stored on the entry:

| Section | Contains | Purpose |
|---|---|---|
| **Active** | Upcoming and in-play matches | What a line can still be built from |
| **Settled** | Matches that have finished | What happened to the picks you made |

Only **Active** matches feed the generator. A finished match cannot be
projected, and including one would produce a leg that is already decided.

The Settled section shows each pick's result — reuse the leg status treatment
that already exists (`components/parlays/leg-status.tsx`) rather than inventing
one. If a line was generated from those picks, show how it settled.

### Pruning

A settled entry is removed **once the calendar date in `APP_TIMEZONE` is later
than the date the match finished**. A Saturday match is therefore visible for
the rest of Saturday and gone on Sunday.

> If that feels too quick for a late-night finish, the alternative is to keep it
> through the whole of the following day. Say so and change the rule; do not
> split the difference with something vaguer.

Nothing is lost when an entry is pruned. The *prediction* it produced lives in
the accuracy history permanently, and settled lines already appear in the
Recent Parlay Results scroller on Home. The Settled section is a short-lived
convenience view, not a record.

Also keep, for the same reasons the watchlist does:

- Validate every field on the way in; never trust the client's snapshot.
- Clamp stored display text; cap the number of entries.
- A slip entry's `gameId` must pass the same validation the game routes use, so
  it can never hold an id that would not resolve to a page.
- A safety net for entries the status poller never sees finish — a postponement
  that is never rescheduled, or a fixture that drops out of the feed. The
  watchlist uses 48 hours after kick-off; the same is reasonable here.

## 9. Accuracy tracking

Publish the generated line through `publishPredictions` exactly like a Parlays
line, and record on the parlay's `scope` that the fixtures were hand-picked and
how many there were.

The reason to record it: a curated line tests the model's *markets* against
fixtures a person chose. An automatic line also tests the optimiser's *fixture
choice*. Averaging the two answers neither question.

## 10. Acceptance criteria

The feature is done when all of these are demonstrably true:

1. A match can be added to the slip from Home, Schedule, Live and Game Detail,
   and the state is visible on every surface at once.
2. The slip survives a page refresh, and is the same slip on another device.
3. `/slip` shows the picked matches in **Active** and **Settled** sections and
   lets each be removed.
4. Only Active matches are offered to the generator; a finished match cannot
   become a leg.
5. A settled pick shows what actually happened to it, and disappears once the
   calendar date has moved past the day it finished.
6. Choosing a risk level and generating produces a line whose every leg comes
   from a picked match, one leg per match.
7. The same picks at two different risk levels produce genuinely different
   lines.
8. Picking five matches where three qualify produces three legs **and states
   why the other two are absent**, distinguishing "nothing at this risk" from
   "not projectable".
9. Removing a match regenerates without a full page reload.
10. The generated line appears in the accuracy tracker, recorded as hand-picked.
11. No horizontal overflow and no tap target under 24px at 375px.
12. `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` all pass.
13. Pure logic — pool narrowing, the Active/Settled split, the pruning rule, the
    explanation of an absent match — is unit-tested without a filesystem or a
    provider, in the style of the existing `tests/`.

## 11. Deliberately out of scope

Say so rather than building them:

- Same-game combinations within a picked match. That exists on the game page
  and has its own correlation handling.
- Stakes, returns, or any monetary figure.
- Sharing or exporting a slip.
- More than one saved slip.

## 12. Documentation

Update `CHANGELOG.md` under Unreleased, and add `docs/slip.md` describing what
the feature does and — as the other docs do — what it deliberately does not.
