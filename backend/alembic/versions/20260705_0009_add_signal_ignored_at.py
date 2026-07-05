"""add signal_evaluations.ignored_at

Revision ID: 0009_add_signal_ignored_at
Revises: 0008_add_train_job_trigger_source
Create Date: 2026-07-05
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009_add_signal_ignored_at"
down_revision: str | None = "0008_add_train_job_trigger_source"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Lifecycle "snooze" marker, distinct from the scanner's scan-quality
    # `status` column: set when the DS ignores a candidate, cleared on
    # restore, and treated as expired (candidate again) after 30 days by
    # read-time logic in api/routes/signals.py - no deletion job.
    op.add_column("signal_evaluations", sa.Column("ignored_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("signal_evaluations", "ignored_at")
