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
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    system_logs = relationship("SystemLog", back_populates="user")


class Prediction(Base):
    __tablename__ = "predictions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False, index=True)
    regime_probs = Column(JSON)
    return_dist = Column(JSON)
    eia_forecast = Column(JSON)
    shap_values = Column(JSON)
    decision = Column(JSON)
    actual_return = Column(Float, nullable=True)
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
    evaluated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


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
