# Prediction accuracy tracking

Every prediction Parlay Projector publishes is measured against what actually
happened. Automatically, without anyone marking anything correct by hand, and
without history ever being rewritten to make the model look better.

```
prediction published  →  frozen  →  game starts  →  live
                      →  game finishes  →  settled  →  metrics  →  homepage
```

---

## What counts as a prediction

The headline accuracy figure counts **official pre-game predictions that were
actually shown to a reader**. Concretely, a prediction is in the denominator
only if both hold:

- `final_pre_game` — it is the last version published for that fixture, market
  and model version **strictly before kick-off**, and
- `parlay_id` is set — it was a leg of a generated line, not an internal
  candidate the model produced and never surfaced.

The engine generates dozens of candidate selections per fixture. Counting them
all would let thousands of unused projections drown out the ones that mattered,
and counting every refresh of the same fixture would weight a heavily-refreshed
game more than a quiet one.

Everything else is still stored and still measurable — `all_predictions` in the
API reports the wider set for research.

---

## Freezing, and look-ahead protection

Once published, a prediction's **probability, confidence, data quality,
settlement rule and projected scoreline never change**. Settlement compares the
stored rule against the final score; it does not re-derive anything.

Projections may be regenerated as kick-off approaches, and every version is
kept. Which one is official is decided from **stored timestamps alone**:

```
09:00  projection            kept
13:00  projection            kept
18:30  projection            kept, final_pre_game = true
19:30  kick-off
20:15  projection            kept, can NEVER be final_pre_game
```

A projection created at or after kick-off could have seen the score, so it is
permanently ineligible. That rule lives in `markFinalPreGame` and is enforced
there rather than trusted to callers.

---

## Statuses

| Status | Meaning |
| --- | --- |
| `pending` | The game has not started |
| `live` | The game is under way |
| `won` | The prediction came in |
| `lost` | It did not |
| `push` | The result landed exactly on the line |
| `void` | It cannot fairly be judged |
| `unsettled` | The game finished but the statistic needed has not arrived |

`live` and `unsettled` are working states — a prediction in either is still
being tracked.

### Void rules

A prediction voids when:

- the game was **cancelled or postponed** — it was never tested;
- the game finished but **no final score was ever published**, and the
  finalisation window has passed;
- **no result at all** arrives within the finalisation window.

A void is never counted as a miss. A statistic that never arrived is not
evidence the prediction was wrong.

### Push rules

A push is **not** a void. A push means the prediction was tested and neither
side won; a void means it could not be tested. Both are excluded from accuracy,
but they are counted and reported separately.

Every generated line uses half-point lines, so a push should not arise in
practice. It is handled anyway.

---

## Headline formula

```
accuracy = wins / (wins + losses)
```

Excluded from the denominator: `pending`, `live`, `push`, `void`, `unsettled`.

**A pending prediction is never counted as incorrect.**

Below **20** settled predictions the percentage is withheld entirely —
`accuracy: null`, and the homepage shows `--%`. The counts are still reported,
as are the scoring rules, which say something at smaller samples than a bare
rate does.

Sample strength is attached to every figure: `small` under 20, `developing`
20–99, `meaningful` 100+.

---

## Settlement

The tracker runs **every 60 seconds**. Each pass:

1. builds a queue from the stored records — only predictions whose game has
   started, that are due a retry, or that are inside the correction window;
2. reads game state from the **same cached fixture adapter** the Live page and
   Game Details use, so tracking costs a cache lookup rather than its own
   provider traffic;
3. moves each prediction as far as the evidence allows;
4. folds leg outcomes into their generated lines;
5. invalidates the accuracy cache if anything changed.

It **never** regenerates a projection or edits a stored probability.

### Retries

A game marked final before its score lands becomes `unsettled` and is retried on
a widening backoff:

```
5 min  →  15 min  →  30 min  →  1 hour  →  3 hours  →  stop
```

### Finalisation window

**24 hours after kick-off**, two things happen:

- anything still open is voided rather than guessed at, and
- results stop being correctable — history stops moving.

### Corrections

Providers do revise final scores. Inside the window, a changed score can revise
a settled result. When it does, an audit entry records it:

```json
{ "previous_result": "won", "new_result": "lost",
  "reason": "provider corrected the final score",
  "changed_at": "2026-09-10T23:14:00.000Z" }
```

The original probability is untouched. Only the outcome moves, and only with a
record of why.

### Idempotency

Settlement is derived from stored records on every run and **writes nothing when
nothing changed**. Running it twice produces the same state. A settled parlay
keeps its original `settled_at` rather than being restamped.

### Provider failure

If **every** league request fails, nothing is settled. Predictions stay exactly
as they are and the next pass tries again — settling on an outage would void
predictions whose games were played perfectly normally.

---

## Metrics

Accuracy alone is misleading: a model that only ever backs heavy favourites
posts a fine percentage while being badly calibrated. So it never travels alone.

| Metric | What it answers |
| --- | --- |
| Accuracy | How often the model is right |
| **Brier score** | Whether its probabilities are any good. Lower is better; 0.25 is what always saying 50% earns |
| **Log loss** | Same, but punishing confident mistakes far harder |
| **Calibration** | Of the predictions rated 70–79%, did ~75% come in? |
| **Score / margin / total MAE** | How close the projected scorelines were, in the sport's own units |

Broken down by **sport, market, risk level, model version, confidence band and
data-quality band**, plus a four-week trend.

Multi-outcome markets use a **multiclass Brier score** — a football result is
home / draw / away, and squeezing that into a binary score misreports what the
model claimed.

### Risk validation

Low should settle above Medium, and Medium above High. If it does not, over
reportable samples, `risk_ordering` says so:

```json
{ "ordered": false, "message": "low risk is settling below medium" }
```

That is surfaced rather than smoothed over. The point of measuring is to find
out when something is wrong.

### Parlays

Tracked at **both** levels, and never conflated:

- **Leg accuracy** — individual predictions, the headline figure.
- **Complete line success** — how often every leg came in. Far lower by nature.

A line loses the moment one leg loses, but its other legs keep settling: they
are still evidence about the model.

`claimed` beside `rate` is what makes the optimiser checkable — lines it
estimated at 40% should come in around 40% of the time.

---

## Storage

Two JSON files on the mounted TrueNAS dataset:

```
$DATA_DIR/predictions-v2.json    individual predictions
$DATA_DIR/parlays-v1.json        generated lines
```

**No database server is introduced, deliberately.** One household's history is a
few thousand records; whole-file reads with cached aggregates are faster than a
query planner would be at this size, and the project cannot add native
dependencies. The interface in `store.ts` is what a SQLite or Postgres
implementation would satisfy — callers would not change.

Writes are serialised behind one queue, so a page generating a line and the
tracker settling one cannot clobber each other. Each write goes to a temporary
file and is renamed, so an interrupted write cannot truncate history.

### TrueNAS

`DATA_DIR` must point at a mounted dataset — conceptually
`/mnt/<your-pool>/parlay-projector/data`. The pool name is **not** hardcoded
anywhere.

This is the only evidence the model works. A container filesystem would lose it
on every redeploy, so the app container stays replaceable while the history does
not move.

If the dataset is not writable, the app still works: publishing logs
`prediction_store_unwritable` and the line is still returned. Those predictions
simply are not measured. Check with:

```bash
docker logs parlayprojector 2>&1 | grep prediction_store_unwritable
```

### Restart recovery

Nothing about the queue lives in memory — it is rebuilt from the stored records
on every run. A container restart, a redeploy or a TrueNAS reboot mid-game
resumes exactly where it left off, and the tracker runs once immediately on
start-up to catch games that finished while it was down.

---

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PREDICTION_TRACKING_ENABLED` | `true` | Set `false` to stop the background tracker |
| `SETTLEMENT_INTERVAL_SECONDS` | `60` | How often open predictions are checked |
| `RESULT_FINALISATION_HOURS` | `24` | How long a result may still change |

None is a secret.

---

## Endpoints

| Endpoint | Returns |
| --- | --- |
| `GET /api/accuracy` | The full report |
| `GET /api/accuracy?window=today\|7d\|30d\|all-time` | Scoped to a period |
| `GET /api/accuracy?section=summary\|sports\|markets\|risk\|calibration\|score\|parlays\|trend\|models\|recent` | One slice |
| `GET /api/home/accuracy` | The widget's figure, from the same service |
| `GET /api/internal/tracker` | Tracker diagnostics |

The accuracy endpoints read **local history only** — no provider is called on
the path of a page load. Sports APIs belong in the settlement job.

`/api/internal/tracker` reports when the tracker last ran, what it did, and how
many predictions are open. **`stale`** is the one to watch: open predictions
whose game started more than twelve hours ago mean something is stuck.

---

## What is not measured

- **Player performance predictions.** The selection type and its settlement
  exist, but nothing generates one — rosters carry no statistics and there is no
  injury or lineup data. See `docs/projection-engine.md`.
- **DNP / late scratch handling** is therefore untested in production. The rule
  is written (void, never a loss) and waits on a data source.
- **No automatic retraining.** Model weights are not changed based on recent
  results. Measuring comes first; adjusting the model from a bad weekend is how
  a system learns superstition.
