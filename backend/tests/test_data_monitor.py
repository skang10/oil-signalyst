from datetime import date

import numpy as np
import pandas as pd

import core.postprocess.data_monitor as data_monitor


def test_feature_coverage_7d_full_coverage(monkeypatch):
    idx = pd.date_range("2024-01-01", periods=10, freq="D")
    values = np.arange(10, dtype=float)
    matrix = pd.DataFrame({"a": values, "b": values}, index=idx)
    monkeypatch.setattr(data_monitor, "load_features", lambda start, end: matrix)

    coverage = data_monitor.feature_coverage_7d(date(2024, 1, 10))

    assert coverage == 1.0


def test_feature_coverage_7d_flags_sparse_column(monkeypatch):
    idx = pd.date_range("2024-01-01", periods=10, freq="D")
    dense = np.arange(10, dtype=float)
    sparse = np.array([np.nan] * 8 + [1.0, 2.0])  # far below the 95% threshold
    matrix = pd.DataFrame({"a": dense, "b": sparse}, index=idx)
    monkeypatch.setattr(data_monitor, "load_features", lambda start, end: matrix)

    coverage = data_monitor.feature_coverage_7d(date(2024, 1, 10))

    assert coverage == 0.5  # only "a" clears the 95% threshold


def test_feature_coverage_7d_defaults_to_full_when_matrix_unavailable(monkeypatch):
    def broken_load(start, end):
        raise FileNotFoundError("no parquet files")

    monkeypatch.setattr(data_monitor, "load_features", broken_load)

    assert data_monitor.feature_coverage_7d(date(2024, 1, 10)) == 1.0


def test_data_source_status_reports_every_configured_source(monkeypatch):
    idx = pd.date_range("2024-01-01", periods=3, freq="D")
    matrix = pd.DataFrame({"a": [1.0, 2.0, 3.0]}, index=idx)
    monkeypatch.setattr(data_monitor, "load_features", lambda start, end: matrix)

    statuses = data_monitor.data_source_status(date(2024, 1, 3))

    assert len(statuses) > 0
    for entry in statuses:
        assert entry["status"] in ("ok", "delayed")
        assert entry["last_updated"] is not None


def test_data_source_status_reports_error_when_matrix_missing(monkeypatch):
    def broken_load(start, end):
        raise FileNotFoundError("no parquet files")

    monkeypatch.setattr(data_monitor, "load_features", broken_load)

    statuses = data_monitor.data_source_status(date(2024, 1, 3))

    assert len(statuses) > 0
    for entry in statuses:
        assert entry["status"] == "error"
        assert entry["lag_hours"] is None
