"""add train_jobs table

Revision ID: 0004_add_train_jobs
Revises: 0003_add_mlflow_run_id
Create Date: 2026-07-02
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_add_train_jobs"
down_revision: str | None = "0003_add_mlflow_run_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "train_jobs",
        sa.Column("id", sa.String(length=8), primary_key=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="queued"),
        sa.Column("model_types", sa.JSON(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("log_lines", sa.JSON(), nullable=True),
        sa.Column("triggered_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("train_jobs")
