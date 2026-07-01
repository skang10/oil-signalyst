# oil-signalyst — Phase 2.2 Spec: Full ML Stack

**Version:** 0.1  
**Phase:** 2.2 — Full ML Stack and Observability  
**Last updated:** 2026-07-01  
**Depends on:** Phase 2.1 vertical slice  

---

## 1. Overview

Phase 2.2 upgrades the Phase 2.1 vertical slice from baseline sklearn models to the fuller research and observability stack:

- TabPFN models.
- GMM-assisted regime label validation.
- Regime-conditioned return distribution.
- MLflow experiment tracking.
- Probability calibration.
- SHAP explanations.
- PSI drift monitoring.
- Stress testing.
- Signal Scanner.

Phase 2.2 must not change the Phase 2.1 report API contract except by adding optional fields for richer views.

## 2. Scope

In scope:

- Replace or augment baseline models with TabPFN models.
- Keep independent raw-data label construction from Phase 2.1.
- Add GMM regime label validation and optional label refinement.
- Add two-stage inference: regime probabilities condition the return distribution model.
- Add MLflow file-mode tracking under `data/mlruns/`.
- Add SHAP-derived feature contributions.
- Add probability calibration and calibration artifacts.
- Add PSI drift scores to `feature_snapshots.psi_scores`.
- Add stress-test re-inference over historical scenarios.
- Add Signal Scanner with multiple-testing correction.

Out of scope:

- Frontend implementation.
- Cloud deployment.
- DS Agent.
- Paid market-consensus data.

## 3. Dependencies

Add after Phase 2.1 is green:

```toml
"tabpfn>=2.0.0",
"shap>=0.46.0",
"mlflow>=2.15.0",
"imbalanced-learn>=0.12.0",
"matplotlib>=3.9.0",
```

`scikit-learn` and `joblib` are already required by Phase 2.1.

## 4. MLflow

Add to `core/config_paths.py` without changing existing path-resolution logic:

```python
MLRUNS_DIR = DATA_DIR / "mlruns"
```

Add to `.gitignore`:

```gitignore
data/mlruns/
```

Training must log:

- Parameters: model type, feature version, train/validation ranges, feature count.
- Metrics: train/CV metrics and validation metrics.
- Artifacts: model artifact, calibration chart, optional feature importance output.

## 5. Regime Label Validation

Phase 2.1 uses `REGIME_TRANSITIONS` directly. Phase 2.2 adds GMM validation.

Requirements:

- Fit `StandardScaler` and `GaussianMixture` only on the training window.
- Use features `[ret_20d, rvol_20d, brent_wti_spread]`.
- Persist scaler, GMM, and component-to-regime mapping if GMM labels become production labels.
- Apply the fitted mapping to validation data; do not fit a separate validation GMM.
- Report agreement versus `REGIME_TRANSITIONS`.
- Keep overall agreement threshold at `> 70%` as a review trigger, not an automatic release gate.

## 6. TabPFN Models

### 6.1 Regime Classifier

Use `TabPFNClassifier` for four-class regime classification.

Requirements:

- Respect TabPFN sample limits.
- Use deterministic sampling of the training set, biased to recent observations.
- Track class distribution and Brier score.
- Preserve `REGIME_CLASSES = ["R1", "R2", "R3", "R4"]`.

### 6.2 EIA Forecast

Use `TabPFNRegressor` for next published weekly crude inventory change.

Requirements:

- Labels still come from independent raw `crude_inventory` data.
- Optional direct EIA features such as `cushing_inventory` must be explicit production features if the model consumes them.
- Report MAE, direction accuracy, and performance versus rolling 4-week baseline.

### 6.3 Conditional Return Distribution

Use `TabPFNClassifier` for return buckets.

Requirements:

- Labels still come from independent raw WTI data.
- Append `p_R1`, `p_R2`, `p_R3`, and `p_R4` regime-probability columns during training and inference.
- Persist the augmented feature list in `model_versions.feature_list`.
- Stress tests and daily inference must append regime probabilities before calling the returns model.

## 7. Probability Calibration

Use validation-year data for calibration.

Requirements:

- Use current sklearn-compatible calibration API. Do not rely on deprecated `cv="prefit"` if the installed sklearn version has removed it.
- Log calibration plots to MLflow.
- Store calibrated wrappers as the served artifacts where materially better.

## 8. SHAP

Add `core/postprocess/shap_explainer.py`.

Requirements:

- Return normalized absolute feature contributions for one prediction.
- Handle multiclass outputs consistently.
- Fail soft: if SHAP cannot explain a model, return `{}` and log the reason rather than failing report generation.
- Store contributions in `Prediction.shap_values`.

## 9. PSI Drift Monitoring

Add `core/postprocess/drift_monitor.py`.

Requirements:

- Compute per-feature PSI from training reference distribution against recent production observations.
- Store scores in `FeatureSnapshot.psi_scores`.
- Do not compute PSI on raw label-only sources unless they are also production features.
- Flag retrain recommendations in model status only after scores are persisted.

## 10. Decision Engine Enhancements

Phase 2.1 ships the baseline decision engine. Phase 2.2 can add:

- User threshold inputs from `users` table.
- Calibrated probabilities.
- VaR/CVaR approximations.
- More detailed rationale strings.

The JSON contract must remain backward compatible.

## 11. Stress Test

Add `core/postprocess/stress_test.py`.

Scenarios:

```python
STRESS_SCENARIOS = {
    "2020_covid": date(2020, 3, 16),
    "2022_ukraine": date(2022, 3, 7),
    "2014_opec": date(2014, 11, 28),
}
```

Requirements:

- Pull historical `FeatureSnapshot` rows.
- Order base features using the active regime model `feature_list`.
- Generate regime probabilities first.
- Append regime probabilities before calling the returns model.
- Return structured errors for missing snapshots/features.

## 12. Regime Statistics

Add duration and switch-probability helpers.

Requirements:

- Compute current regime duration from prediction history.
- Estimate switch probability from empirical transition history.
- Fall back to a neutral probability when history is insufficient.
- Include `regime_duration_weeks` and `switch_prob_4w` in researcher and DS report views.

## 13. Signal Scanner

Add `core/signal_scanner.py` after the main model/report stack is stable.

Requirements:

- Candidate signals come from explicit config, not every column by default.
- IC target encoding must be numeric and documented.
- Apply Bonferroni correction across `number_of_candidates * number_of_lags`.
- Report both raw and corrected p-values.
- Evaluate coverage, OOS decay, and correlation against active features.
- Write results to `signal_evaluations`.

Scheduler integration:

```python
scheduler.add_job(
    run_signal_scan,
    "cron",
    day_of_week="sun",
    hour=3,
    id="signal_scanner",
)
```

## 14. API Additions

Keep Phase 2.1 endpoints stable.

Add optional fields:

- Researcher report: `shap_values`, `feature_signals`, `regime_duration_weeks`, `switch_prob_4w`.
- DS report: full report plus `psi_scores`, calibration metadata, and active model diagnostics.
- Models status: drift/retrain recommendation fields.
- Signals: `GET /api/signals/candidates`, `GET /api/signals/active`.

Stress testing can remain internal in Phase 2.2 unless Phase 3 explicitly needs `GET /api/reports/stress`.

## 15. Tests

Add tests for:

- GMM validation applies train-fitted mapping to validation data.
- Returns model receives augmented regime-probability features in training, inference, and stress tests.
- SHAP failure returns `{}` without failing report assembly.
- PSI stores per-feature scores.
- Signal Scanner applies Bonferroni correction.
- Model status includes richer diagnostics without breaking the Phase 2.1 response shape.

## 16. Completion Checklist

```text
Prerequisites:
[ ] Phase 2.1 completion checklist is green.

Training:
[ ] TabPFN regime model trains and logs MLflow artifacts.
[ ] TabPFN EIA model trains and logs MLflow artifacts.
[ ] TabPFN returns model trains with appended regime-probability features.
[ ] model_versions rows include correct feature_list for augmented returns model.

Post-processing:
[ ] Calibration plots are logged.
[ ] SHAP values are stored or fail soft.
[ ] PSI scores are stored in feature_snapshots.psi_scores.
[ ] Regime duration and switch probability appear in researcher/DS reports.

Stress and signals:
[ ] Stress test uses augmented returns feature vector.
[ ] Signal Scanner records corrected p-values.

API:
[ ] Phase 2.1 endpoint contracts remain compatible.
[ ] GET /api/models/status includes richer diagnostics.
[ ] GET /api/signals/candidates returns scanner output.
```

