"""add prediction outcome columns

Revision ID: 0002_add_prediction_outcomes
Revises: 0001_initial_schema
Create Date: 2026-07-01
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002_add_prediction_outcomes"
down_revision: str | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("predictions", sa.Column("actual_return", sa.Float(), nullable=True))
    op.add_column("predictions", sa.Column("outcome_correct", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("predictions", "outcome_correct")
    op.drop_column("predictions", "actual_return")

