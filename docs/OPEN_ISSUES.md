# Open Issues — working tally

Scratch tracker for problems surfaced during the July 2026 data/model audit.
Not a spec; delete entries as they land. Severity: 🔴 broken now · 🟠 real but
contained · 🟢 cosmetic/efficiency.

---

## A. Landmines / wrong right now

- ~~**A1 auto-retrain will always fail.**~~ FIXED - lists TRAINABLE_MODEL_TYPES.
- ~~**A2 PSI reads all zeros.**~~ FIXED - PSI computes live from the parquet
  tail, and the methodology was corrected: robust (1-99 pct) bin edges so the
  2020 negative-price outliers don't distort the grid, and Laplace smoothing
  for empty bins instead of a 1e-4 floor that scored a single empty bin at
  ~0.69. A random-split null (~0.01 per feature) confirmed the residual high
  values are REAL drift, not artifacts: 2024+ inputs genuinely occupy a
  different distribution than the 2012-2023 training window (the models are
  extrapolating). The 0.2 threshold correctly separates that (0.1-2.7) from the
  0.01 noise floor.
- **A3 🟠 scheduler not running locally (root cause).** `feature_snapshots`
  stuck at 2026-07-05, `predictions` has ~3 rows. This is the shared root of
  A2, the near-empty History page, and stale predictions. Not a code issue —
  needs `python -m scheduler.runner` running. See memory `project_scheduler_infra`.
- **A4 🟠 eia model loses to its baseline, live by override.** mae 4.0334 vs
  baseline 3.4554, directional accuracy 0.4749 (worse than a coin flip).
  Flagged in the UI (f411d37) but needs a real model, not a redeploy. It never
  had skill; there was no baseline to reveal it until 740cefc.
- **A5 🟠 calibration leakage.** `calibration.py:28` fits the calibrator on the
  validation set and then reports against it. Data Monitor shows "Calibration ·
  not held out". returns brier 0.1453 is still optimistic. Needs a 3-way split.

## B. Fabricated / stale data still shown

- **B1 🟠 EIA tab shows 8 hardcoded numbers as model output.**
  `report_assembler.py`: 80% CI (`crude ± 1.7`), per-product breakdown
  (gasoline -1.1 / distillate / cushing), and a "MODEL HISTORICAL PERFORMANCE"
  card (71.2% / 1.3 MB / 1.9 MB). The real MAE (4.0) now sits on the same page
  and contradicts them.
- **B2 🟢 Supporting Signals show raw values** (`crude_inv_dev = -210070.8651`).
  Backend `_build_signal_list` formatting.
- ~~**B3 Data Monitor "Feature Missing Rate" shows >100%.**~~ FIXED - the
  frontend was double-scaling an already-percentage value; also corrected the
  panel title from "Last 30 Days" to the real 7-trading-day window.

## C. Ingestion robustness (silent-corruption class)

- **C1 🟠 `engine.build` swallows a failed feature — the column vanishes.** A
  feature that raises just disappears from the matrix, causing downstream column
  mismatch (same class as the fixed 3373ffc). Should keep the column as all-NaN
  and surface which features dropped.
- **C2 🟠 parquet has no feature-version stamp; `load_features` blind-concats.**
  Root cause of the column-order bug patched reactively in 3373ffc. Stamp
  `feature_version` per file and verify on load.
- **C3 🟠 unbounded ffill masks a dead source.** `resample("B").last().ffill()`
  has no limit, so a source that stops publishing holds its last value forever
  and reads as fresh inside the matrix. Freshness snapshot only catches it at
  the feed level. Bound the ffill staleness.
- **C4 🟠 no ingestion validation.** A bad print (0 / negative / 10x gap) flows
  silently into features → labels → models. Add basic sanity checks.
- **C5 🟢 range-keyed cache re-fetches overlapping data; Yahoo not persisted.**
  Efficiency only. **← starting here (per-source persistence).**

## D. Structural / deferred modeling

- **D1 🟠 three representations of "the feature row"** (parquet honest / DB
  ffilled / recomputed), patched 4+ times. Wants a single source of truth.
- **D2 🟠 regime is 17 hand-typed dates; frozen model now scores
  off-distribution** after the business-day migration (rvol +22%). Accepted
  degradation. Real fix needs demand-side data (absent) or nowcast rules
  (measured F=4.38, weak). Decision deferred.
- **D3 🟠 regime confidence gate is one-sided.** `decision_engine` gates LONG on
  regime confidence but not SHORT; a deterministic rule's constant 1.0
  confidence would disable the brake entirely.
- **D4 🟠 tiny effective n (~13 validation), no cross-validation.** Single
  train/val split; `cv_folds`/`gap_days` accepted but ignored. Rolling-origin
  work.

---

## In progress

**C5 — per-source persistence.** Persist aligned single-source series to disk
parquet (one file per source, like CFTC), keyed by source not range; treat old
history as immutable, refetch only a bounded recent tail to absorb revisions
(Yahoo auto_adjust, EIA weekly revisions, CFTC reclassifications). Kills
backfill re-download and restart-cold, and removes the overlapping-range
refetch. Fold C2's version stamp into the file schema while here.
