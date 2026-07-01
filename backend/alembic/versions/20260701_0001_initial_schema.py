"""initial schema

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-07-01
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001_initial_schema"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("alert_channel", sa.String(length=20), nullable=True),
        sa.Column("alert_slack_channel", sa.String(length=100), nullable=True),
        sa.Column("instruments", sa.JSON(), nullable=True),
        sa.Column("horizon_days", sa.Integer(), nullable=True),
        sa.Column("exposure_barrels", sa.Integer(), nullable=True),
        sa.Column("alert_downside_threshold", sa.Float(), nullable=True),
        sa.Column("alert_regime_threshold", sa.Float(), nullable=True),
        sa.Column("alert_eia_threshold", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "feature_snapshots",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("features", sa.JSON(), nullable=False),
        sa.Column("feature_version", sa.String(length=16), nullable=True),
        sa.Column("psi_scores", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_feature_snapshots_date", "feature_snapshots", ["date"], unique=True)
    op.create_table(
        "model_versions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("model_type", sa.String(length=20), nullable=False),
        sa.Column("version", sa.String(length=32), nullable=False),
        sa.Column("file_path", sa.String(length=255), nullable=True),
        sa.Column("train_config", sa.JSON(), nullable=True),
        sa.Column("metrics_train", sa.JSON(), nullable=True),
        sa.Column("metrics_oos", sa.JSON(), nullable=True),
        sa.Column("feature_list", sa.JSON(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("deployed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "signal_evaluations",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("signal_name", sa.String(length=100), nullable=False),
        sa.Column("source_config", sa.JSON(), nullable=True),
        sa.Column("ic_scores", sa.JSON(), nullable=True),
        sa.Column("oos_decay", sa.Float(), nullable=True),
        sa.Column("correlation", sa.JSON(), nullable=True),
        sa.Column("coverage", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=True),
        sa.Column("mechanism", sa.Text(), nullable=True),
        sa.Column("evaluated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "predictions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("regime_probs", sa.JSON(), nullable=True),
        sa.Column("return_dist", sa.JSON(), nullable=True),
        sa.Column("eia_forecast", sa.JSON(), nullable=True),
        sa.Column("shap_values", sa.JSON(), nullable=True),
        sa.Column("decision", sa.JSON(), nullable=True),
        sa.Column("model_version_id", sa.Integer(), nullable=True),
        sa.Column("feature_snapshot_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["feature_snapshot_id"], ["feature_snapshots.id"]),
        sa.ForeignKeyConstraint(["model_version_id"], ["model_versions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_predictions_date", "predictions", ["date"])
    op.create_table(
        "system_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_system_logs_created_at", "system_logs", ["created_at"])
    op.create_index("ix_system_logs_event_type", "system_logs", ["event_type"])
    op.create_index("ix_system_logs_user_id", "system_logs", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_system_logs_user_id", table_name="system_logs")
    op.drop_index("ix_system_logs_event_type", table_name="system_logs")
    op.drop_index("ix_system_logs_created_at", table_name="system_logs")
    op.drop_table("system_logs")
    op.drop_index("ix_predictions_date", table_name="predictions")
    op.drop_table("predictions")
    op.drop_table("signal_evaluations")
    op.drop_table("model_versions")
    op.drop_index("ix_feature_snapshots_date", table_name="feature_snapshots")
    op.drop_table("feature_snapshots")
    op.drop_table("users")
