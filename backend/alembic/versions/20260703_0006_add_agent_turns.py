"""add agent_turns table

Revision ID: 0006_add_agent_turns
Revises: 0005_add_user_auth_columns
Create Date: 2026-07-03
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006_add_agent_turns"
down_revision: str | None = "0005_add_user_auth_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_turns",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content", sa.JSON(), nullable=True),
        sa.Column("tool_calls", sa.JSON(), nullable=True),
        sa.Column("tool_call_id", sa.String(length=64), nullable=True),
        sa.Column("tool_name", sa.String(length=64), nullable=True),
        sa.Column("tool_input", sa.JSON(), nullable=True),
        sa.Column("tool_result", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="complete"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_agent_turns_session_id", "agent_turns", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_turns_session_id", table_name="agent_turns")
    op.drop_table("agent_turns")
