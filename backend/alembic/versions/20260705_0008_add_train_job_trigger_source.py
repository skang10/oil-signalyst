"""add train_jobs.trigger_source

Revision ID: 0008_add_train_job_trigger_source
Revises: 0007_add_user_pref_columns
Create Date: 2026-07-05
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008_add_train_job_trigger_source"
down_revision: str | None = "0007_add_user_pref_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Pre-existing rows get 'manual' - historically auto-retrain and DS Agent
    # runs are indistinguishable from manual ones (all three only recorded a
    # user id in triggered_by), so 'manual' is the only honest backfill.
    op.add_column(
        "train_jobs",
        sa.Column("trigger_source", sa.String(length=20), nullable=False, server_default="manual"),
    )


def downgrade() -> None:
    op.drop_column("train_jobs", "trigger_source")
