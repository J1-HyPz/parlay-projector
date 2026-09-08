# Slips

`/slips` is the manual counterpart to Parlays. There the optimiser chooses both
halves of a line — which fixtures to use and what to back on them. Here the
first half is yours.

```
add a match anywhere  →  server-side slip  →  /slips  →  a line at your risk level
```

## Three roles, kept separate

| Decision | Whose |
| --- | --- |
| Which matches | Yours |
| Which market on each | The model's |
| Whether a market qualifies at all | The risk profile's |

That separation is the feature. If you also chose the market it would be a bet
builder; if the model also chose the fixtures it would be Parlays.

It shows: the same three matches produced a three-leg line at 56.6% on Low, a
three-leg line at 41.5% on Medium with entirely different markets, and a
two-leg line at 42.5% on High — because one of the three had nothing in the
high band. Not the same line relabelled.

## Adding matches

The `+` beside the watchlist star, on Home, Schedule, Live and any game page.
Same rules as the star, for the same reasons: the button is a sibling of the
card's link rather than nested inside it, and it stops the click reaching the
link behind it.

A finished or cancelled match is not offered. A line cannot be built from a
result, and a control that adds something the generator will refuse is worse
than no control.

## Where picks live

A JSON file under `DATA_DIR`, beside prediction history and the watchlist, and
for the same reason: a container filesystem is ephemeral, and losing the file
would empty your picks on every redeploy. The slip is therefore the same on
your phone and your laptop.

Like the watchlist, it has no authentication — anyone who can reach the server
can change it. That is acceptable on a LAN and stated in
[notifications](notifications.md); do not expose this host to the internet
without putting authentication in front of it.

## Active and Settled

The page splits picks by the match's **current status**, resolved when the slip
is read, never by something stored on the entry:

| Section | Contains |
| --- | --- |
| **Active** | Still to come, or under way. Only these can produce a leg |
| **Settled** | Finished, cancelled or postponed |

Cancelled and postponed count as settled: no line will ever be built from
either, which is the question the split answers. An **unreadable** status does
not — that is not evidence a game is over, and treating it as one would retire
a fixture still to be played. A match whose status cannot be resolved at all
stays exactly where it was.

### When a pick leaves

| Cause | Rule |
| --- | --- |
| Result observed | Kept for the rest of that day, then dropped |
| Never seen to finish | Dropped 48 hours after kick-off |
| Removed by you | Immediately |

The day a result was first seen is stamped once and never revised. Re-stamping
on each read would restart the clock, and a slip opened daily would never
empty.

**Nothing is lost when a pick is pruned.** The prediction it produced lives in
the accuracy history permanently, and settled lines appear in the Recent Parlay
Results scroller on Home. Settled is a short-lived view of how the picks went,
not the record of them.

## Building the line

The pool is narrowed to the picked fixtures **before anything is ranked**, so
the choice is binding in the same structural way the sport and competition
filters are. There is no later stage that could reach past it for a better leg
elsewhere. One leg per match, which is the existing correlation rule.

Picking four matches asks for a four-leg line. That is what picking them means,
and the risk profile's default of three would otherwise drop one of your picks
without saying so.

### Nothing is padded, and nothing is substituted

Two ways a pick can contribute nothing. They are reported separately because
they call for different responses:

- **Nothing clears this risk level.** The line is shorter, says which, and says
  a lower level would include it. Never filled with a weaker market.
- **Not projectable** — already under way, or without enough completed history
  behind it.

## Accuracy

A generated line is published like any other, settles normally, and counts
toward the headline figure. Its `scope` records that the fixtures were
hand-picked and how many there were.

The reason to record it: a curated line tests the model's *markets* against
fixtures a person chose. An automatic line also tests the optimiser's *fixture
choice*. Averaging the two answers neither question, so they are kept
distinguishable.

## Deliberately not offered

- Same-game combinations within a picked match. That exists on the game page
  and has its own correlation handling.
- Stakes, returns, or any monetary figure.
- More than one saved slip.
- Any bookmaker account, placement or deep link. This reports what the model
  thinks and what published prices say; there is no bet anywhere in it.
