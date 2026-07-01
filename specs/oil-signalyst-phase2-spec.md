# oil-signalyst — Phase 2 Spec Index

**Version:** 2.0  
**Phase:** 2 — ML Pipeline  
**Last updated:** 2026-07-01  
**Depends on:** Phase 1 spec v0.6 FINAL  

---

## 1. Overview

Phase 2 is split into two delivery phases:

- [Phase 2.1 — ML Vertical Slice](oil-signalyst-phase2.1-vertical-slice-spec.md)
- [Phase 2.2 — Full ML Stack](oil-signalyst-phase2.2-ml-stack-spec.md)

This replaces the previous single Phase 2 spec because the original scope coupled too many first-time risks: historical backfill, label construction, model training, daily inference, report APIs, TabPFN, SHAP, MLflow, calibration, drift monitoring, stress testing, and Signal Scanner.

The split keeps the product milestone clear while deferring research/observability depth until the real end-to-end path is working.

## 2. Phase 2.1 Goal

Phase 2.1 proves the product loop:

```text
data sources -> feature snapshots -> independent labels -> baseline models -> predictions -> report API
```

Completion check:

```bash
curl localhost:8000/api/reports/daily/trader
```

returns real model-driven JSON, not mock data.

Phase 2.1 intentionally uses baseline sklearn models and independent raw-data label construction. Production feature matrices stay feature-only; label builders fetch raw WTI and EIA data through `DataRegistry`.

## 3. Phase 2.2 Goal

Phase 2.2 upgrades the working vertical slice with the full ML stack:

- TabPFN.
- GMM regime label validation.
- Regime-conditioned return distribution.
- MLflow.
- SHAP.
- Probability calibration.
- PSI drift monitoring.
- Stress tests.
- Signal Scanner.

Phase 2.2 must preserve the Phase 2.1 API contract and add richer optional fields for researcher, risk, and DS workflows.

## 4. Shared Decisions

| # | Decision |
|---|----------|
| D1 | Label construction is independent from production feature matrices. Raw `wti`, `crude_inventory`, and other label-only series are fetched through `DataRegistry`. |
| D2 | Training split remains fixed: 2010-2023 train, 2024 validation, 2025+ OOS reporting. |
| D3 | Daily pipeline idempotency must separately handle feature snapshots and predictions. Existing snapshots must not prevent later prediction creation. |
| D4 | Feature vectors must use `model_versions.feature_list` ordering. Dict insertion order is not a model contract. |
| D5 | `config_paths.py` must preserve Phase 1's adaptive Docker/local path resolution. |
| D6 | `POST /api/train/start` returns HTTP 202. |

## 5. Spec Files

Use the specs in order:

1. Implement [Phase 2.1 — ML Vertical Slice](oil-signalyst-phase2.1-vertical-slice-spec.md).
2. Verify the Phase 2.1 completion checklist.
3. Implement [Phase 2.2 — Full ML Stack](oil-signalyst-phase2.2-ml-stack-spec.md).

