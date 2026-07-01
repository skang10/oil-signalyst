"""add mlflow_run_id to model_versions

Revision ID: 0003_add_mlflow_run_id
Revises: 0002_add_prediction_outcomes
Create Date: 2026-07-02
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003_add_mlflow_run_id"
down_revision: str | None = "0002_add_prediction_outcomes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("model_versions", sa.Column("mlflow_run_id", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("model_versions", "mlflow_run_id")
