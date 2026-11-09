"""vacations, substitutes, sync_state

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vacations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("start_date", sa.Date, nullable=False),
        sa.Column("end_date", sa.Date, nullable=False),
        sa.Column("source", sa.Enum("base", "calendar", name="vacation_source", native_enum=False,
                                    create_constraint=True), nullable=False),
        sa.Column("gcal_event_id", sa.String(255), nullable=True, unique=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        sa.CheckConstraint("end_date >= start_date"),
    )
    op.create_table(
        "substitutes",
        sa.Column("slot_id", sa.Integer, sa.ForeignKey("slots.id"), primary_key=True),
        sa.Column("date", sa.Date, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), primary_key=True),
    )
    op.create_table(
        "sync_state",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("last_ok_at", sa.DateTime, nullable=True),
        sa.Column("error_since", sa.DateTime, nullable=True),
        sa.Column("error", sa.String(500), nullable=True),
        sa.Column("unmatched", sa.JSON, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("sync_state")
    op.drop_table("substitutes")
    op.drop_table("vacations")
