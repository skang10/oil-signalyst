"""add user auth columns

Revision ID: 0005_add_user_auth_columns
Revises: 0004_add_train_jobs
Create Date: 2026-07-03
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005_add_user_auth_columns"
down_revision: str | None = "0004_add_train_jobs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("hashed_password", sa.String(length=256), nullable=True))
    op.add_column("users", sa.Column("refresh_token", sa.String(length=512), nullable=True))
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "last_login_at")
    op.drop_column("users", "refresh_token")
    op.drop_column("users", "hashed_password")
