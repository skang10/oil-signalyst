"""add pool_features table

Revision ID: 0010_add_pool_features
Revises: 0009_add_signal_ignored_at
Create Date: 2026-07-05
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010_add_pool_features"
down_revision: str | None = "0009_add_signal_ignored_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Seeded from config/features.yaml on first startup
    # (core/services/feature_pool.py::ensure_seeded), not here - alembic
    # shouldn't depend on a config file that may differ per environment.
    op.create_table(
        "pool_features",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(length=100), nullable=False, unique=True, index=True),
        sa.Column("definition", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="active"),
        sa.Column("changed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("changed_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("pool_features")
