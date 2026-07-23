from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    role = Column(String(20), nullable=False, default="researcher")
    email = Column(String(255))
    alert_channel = Column(String(20), default="email")
    alert_slack_channel = Column(String(100))
    instruments = Column(JSON, default=lambda: ["CL=F"])
    horizon_days = Column(Integer, default=20)
    exposure_barrels = Column(Integer, default=100000)
    alert_downside_threshold = Column(Float, default=0.45)
    alert_regime_threshold = Column(Float, default=0.30)
    alert_eia_threshold = Column(Float, default=1.5)
    alert_psi_threshold = Column(Float, default=0.2)
    # 'manual' | 'psi' | 'sunday' - honored by scheduler/jobs.py::_maybe_auto_retrain
    retrain_mode = Column(String(10), default="manual")
    hashed_password = Column(String(256), nullable=True)
    refresh_token = Column(String(512), nullable=True)
    last_login_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    system_logs = relationship("SystemLog", back_populates="user")


class Prediction(Base):
    __tablename__ = "predictions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False, index=True)
    regime_probs = Column(JSON)
    eia_forecast = Column(JSON)
    shap_values = Column(JSON)
    decision = Column(JSON)
    outcome_correct = Column(Boolean, nullable=True)
    model_version_id = Column(Integer, ForeignKey("model_versions.id"), nullable=True)
    feature_snapshot_id = Column(Integer, ForeignKey("feature_snapshots.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    model_version = relationship("ModelVersion", back_populates="predictions")
    feature_snapshot = relationship("FeatureSnapshot")


class FeatureSnapshot(Base):
    __tablename__ = "feature_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False, unique=True, index=True)
    features = Column(JSON, nullable=False)
    feature_version = Column(String(16))
    psi_scores = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ModelVersion(Base):
    __tablename__ = "model_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    model_type = Column(String(20), nullable=False)
    version = Column(String(32), nullable=False)
    file_path = Column(String(255))
    train_config = Column(JSON)
    metrics_train = Column(JSON)
    metrics_oos = Column(JSON)
    feature_list = Column(JSON)
    is_active = Column(Boolean, default=False, nullable=False)
    deployed_at = Column(DateTime)
    mlflow_run_id = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    predictions = relationship("Prediction", back_populates="model_version")


class SignalEvaluation(Base):
    __tablename__ = "signal_evaluations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    signal_name = Column(String(100), nullable=False)
    source_config = Column(JSON)
    ic_scores = Column(JSON)
    oos_decay = Column(Float)
    correlation = Column(JSON)
    coverage = Column(Float)
    status = Column(String(20), default="candidate")
    mechanism = Column(Text)
    # DS lifecycle snooze, separate from the scanner's scan-quality `status`:
    # set on ignore, cleared on restore, treated as expired (candidate again)
    # 30 days later by api/routes/signals.py - rows are never deleted.
    ignored_at = Column(DateTime, nullable=True)
    evaluated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class TrainJob(Base):
    __tablename__ = "train_jobs"

    id = Column(String(8), primary_key=True)
    status = Column(String(20), nullable=False, default="queued")
    model_types = Column(JSON, default=list)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    result = Column(JSON, nullable=True)
    log_lines = Column(JSON, default=list)
    triggered_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    # 'manual' | 'auto:psi' | 'auto:sunday' | 'agent' - triggered_by alone
    # can't distinguish these (auto-retrain and the DS Agent both run as a
    # real user id), and the Training History UI badges runs by source.
    trigger_source = Column(String(20), nullable=False, default="manual", server_default="manual")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class PoolFeature(Base):
    """One feature-pool entry. Source of truth for pool membership - config/
    features.yaml is only the first-run seed (core/services/feature_pool.py
    ::ensure_seeded) and is never written at runtime. `definition` holds the
    full pipeline definition verbatim (source key, transform, window/seasons,
    display metadata), so removal keeps everything needed to restore -
    status flips instead of rows being deleted."""

    __tablename__ = "pool_features"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, unique=True, index=True)
    definition = Column(JSON, nullable=False)
    status = Column(String(10), nullable=False, default="active")  # 'active' | 'removed'
    changed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    changed_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class AgentTurn(Base):
    """One turn in a DS Agent conversation (user message, assistant
    response/tool-call request, or tool result)."""

    __tablename__ = "agent_turns"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(36), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    role = Column(String(16), nullable=False)  # 'user' | 'assistant' | 'tool'
    content = Column(JSON, nullable=True)  # text content (str or None)
    tool_calls = Column(JSON, nullable=True)  # set on role='assistant': OpenAI's
    # [{"id","type","function":{"name","arguments"}}] array, verbatim - must
    # precede any role='tool' message answering it (core/agent/client.py)
    tool_call_id = Column(String(64), nullable=True)  # set on role='tool': links
    # this result back to the specific entry in the preceding assistant
    # turn's tool_calls (a turn can request >1 tool call in parallel)
    tool_name = Column(String(64), nullable=True)
    tool_input = Column(JSON, nullable=True)
    tool_result = Column(JSON, nullable=True)
    status = Column(String(16), nullable=False, default="complete")  # 'pending' | 'confirmed' | 'cancelled' | 'complete'
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class SystemLog(Base):
    __tablename__ = "system_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    event_type = Column(String(50), nullable=False, index=True)
    payload = Column(JSON)
    status = Column(String(20), nullable=False, default="running")
    error = Column(Text)
    duration_ms = Column(Integer)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    user = relationship("User", back_populates="system_logs")
