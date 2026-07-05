"""add user preference columns (psi alert threshold, retrain mode)

Revision ID: 0007_add_user_pref_columns
Revises: 0006_add_agent_turns
Create Date: 2026-07-03
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007_add_user_pref_columns"
down_revision: str | None = "0006_add_agent_turns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("alert_psi_threshold", sa.Float(), nullable=True, server_default="0.2")
    )
    op.add_column(
        "users",
        sa.Column("retrain_mode", sa.String(length=10), nullable=True, server_default="manual"),
    )


def downgrade() -> None:
    op.drop_column("users", "retrain_mode")
    op.drop_column("users", "alert_psi_threshold")
