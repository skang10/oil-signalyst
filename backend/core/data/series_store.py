"""Disk-backed store of raw per-source series.

The registry used to hold aligned series only in a range-keyed in-memory cache
that died on every process restart and re-downloaded overlapping data whenever
the requested window shifted (the daily pipeline's `end` moves each day). The
raw feeds it fronts - Yahoo, FRED, EIA - are almost immutable once published,
so re-fetching fifteen years of history to serve a request that reaches one day
further is waste.

"Almost" is the load-bearing word. Yahoo's adjusted close is revised
retroactively on splits/dividends, EIA revises inventory figures in later
weekly releases, and CFTC reclassifies positions - so a naive "persist once,
never re-fetch" would freeze stale, pre-revision values. This store therefore
treats history older than REVISION_WINDOW_DAYS as settled and serves it from
disk, while always re-fetching a bounded recent tail to absorb revisions.

One Parquet file per source under SERIES_CACHE_DIR. CFTC is excluded - it
manages its own per-year cache (BaseSource.manages_own_persistence).
"""

import os

import pandas as pd

from core.config_paths import SERIES_CACHE_DIR
from core.logging import get_logger

logger = get_logger(__name__)

# History older than this (relative to the newest stored point) is assumed
# settled and served from disk without a network call. The tail within it is
# re-fetched on demand so provider revisions are picked up. 90 days comfortably
# covers EIA's revision cadence and any weekly-source republication.
REVISION_WINDOW_DAYS = 90


class SeriesStore:
    def __init__(self) -> None:
        SERIES_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        # name -> (raw series, disk mtime it was loaded from). The mtime lets a
        # reader process (the API) pick up writes made by another process (the
        # daily pipeline) without a network round-trip.
        self._mem: dict[str, tuple[pd.Series, float]] = {}
        # Bumped whenever a source's series changes, so the registry can cache
        # the aligned form and know when to recompute it.
        self._revision: dict[str, int] = {}

    def revision(self, name: str) -> int:
        return self._revision.get(name, 0)

    def clear(self) -> None:
        """Drop the in-memory tier so the next access reconciles with disk (and
        re-fetches the tail). Disk history is kept - it is the durable copy."""
        self._mem.clear()

    def _path(self, name: str):
        return SERIES_CACHE_DIR / f"{name}.parquet"

    def _load_disk(self, name: str) -> pd.Series | None:
        path = self._path(name)
        if not path.exists():
            return None
        frame = pd.read_parquet(path)
        series = frame.iloc[:, 0]
        series.index = pd.to_datetime(series.index)
        return series

    def _stored(self, name: str) -> pd.Series | None:
        """In-memory copy, reconciled with disk when another process has written
        a newer file since we last loaded."""
        path = self._path(name)
        disk_mtime = path.stat().st_mtime if path.exists() else None
        cached = self._mem.get(name)
        if cached is not None and (disk_mtime is None or cached[1] >= disk_mtime):
            return cached[0]
        series = self._load_disk(name)
        if series is not None:
            self._mem[name] = (series, disk_mtime or 0.0)
        return series

    def _persist(self, name: str, series: pd.Series) -> None:
        path = self._path(name)
        tmp = path.with_suffix(".parquet.tmp")
        # Write-then-rename so a crash mid-write can't leave a half-written file
        # that later reads as corrupt (the feature-matrix writes don't do this
        # yet - see OPEN_ISSUES C-tier).
        series.to_frame(name).to_parquet(tmp)
        os.replace(tmp, path)
        self._mem[name] = (series, path.stat().st_mtime)
        self._revision[name] = self._revision.get(name, 0) + 1

    def get(self, name: str, adapter, cfg: dict, start: str, end: str) -> pd.Series:
        """Full raw series for `name`, covering the requested window, fetching
        only what the store doesn't already hold as settled history."""
        start_ts, end_ts = pd.Timestamp(start), pd.Timestamp(end)
        stored = self._stored(name)

        if stored is None or stored.empty:
            fresh = adapter.fetch(cfg, start, end)
            self._persist(name, fresh.sort_index())
            return self._mem[name][0]

        last = stored.index.max()
        first = stored.index.min()
        settled_before = last - pd.Timedelta(days=REVISION_WINDOW_DAYS)

        # Pure historical read we already hold in full: no network.
        if start_ts >= first and end_ts <= settled_before:
            return stored

        # Otherwise re-fetch a bounded window: the recent tail (to absorb
        # revisions and extend forward), widened backward only if the caller
        # wants history older than we have.
        fetch_lo = start_ts if start_ts < first else settled_before
        fetch_hi = max(end_ts, last)
        try:
            fresh = adapter.fetch(cfg, str(fetch_lo.date()), str(fetch_hi.date()))
        except Exception as exc:
            # Serve what we have rather than fail on a transient fetch error;
            # a genuinely dead feed still surfaces via the freshness snapshot.
            logger.warning(
                "Series refetch failed, serving cached history",
                extra={"source": name, "error": str(exc)},
            )
            return stored

        # keep="last" so the freshly fetched values win on overlapping dates -
        # that is what absorbs a provider revision.
        merged = pd.concat([stored, fresh.sort_index()])
        merged = merged[~merged.index.duplicated(keep="last")].sort_index()
        self._persist(name, merged)
        return merged
