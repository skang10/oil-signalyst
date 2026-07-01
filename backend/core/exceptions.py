class OilSignalystError(Exception):
    """Base exception for all oil-signalyst errors."""


class DataFetchError(OilSignalystError):
    def __init__(self, source: str, reason: str):
        self.source = source
        self.reason = reason
        super().__init__(f"[{source}] fetch failed: {reason}")


class FeatureBuildError(OilSignalystError):
    pass


class InsufficientDataError(OilSignalystError):
    pass


class ModelNotFoundError(OilSignalystError):
    pass


class PipelineError(OilSignalystError):
    pass
