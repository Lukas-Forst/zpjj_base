"""timer_presets

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "timer_presets",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("mode", sa.Enum("rounds", "countdown", "stopwatch", name="timer_mode",
                                  native_enum=False, create_constraint=True), nullable=False),
        sa.Column("config", sa.JSON, nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("timer_presets")
