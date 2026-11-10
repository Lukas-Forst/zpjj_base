"""attendance, trials, trial_attendance

Revision ID: 0004
Revises: 0003
"""
import sqlalchemy as sa

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "attendance",
        sa.Column("date", sa.Date, primary_key=True),
        sa.Column("cancelled", sa.Boolean, nullable=False),
        sa.Column("total", sa.Integer, nullable=True),
        sa.Column("trials", sa.Integer, nullable=False),
        sa.Column("open_mat", sa.Integer, nullable=True),
        sa.Column("beginner", sa.Integer, nullable=True),
        sa.Column("updated_by", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        sa.CheckConstraint("total IS NULL OR trials <= total"),
        sa.CheckConstraint(
            "(total IS NULL OR total >= 0) AND trials >= 0"
            " AND (open_mat IS NULL OR open_mat >= 0) AND (beginner IS NULL OR beginner >= 0)"
        ),
    )
    op.create_table(
        "trials",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("name_key", sa.String(100), nullable=False, unique=True),
        sa.Column("first_date", sa.Date, nullable=False),
    )
    op.create_table(
        "trial_attendance",
        sa.Column("trial_id", sa.Integer, sa.ForeignKey("trials.id"), primary_key=True),
        sa.Column("date", sa.Date, sa.ForeignKey("attendance.date"), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("trial_attendance")
    op.drop_table("trials")
    op.drop_table("attendance")
