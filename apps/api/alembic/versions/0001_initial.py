"""initial: users, slots, slot_trainers

Revision ID: 0001
Revises:
"""
import sqlalchemy as sa

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("role", sa.Enum("gesellschafter", "trainer", name="role", native_enum=False,
                                  create_constraint=True), nullable=False),
        sa.Column("is_trainer", sa.Boolean, nullable=False),
        sa.Column("active", sa.Boolean, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    )
    op.create_table(
        "slots",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("weekday", sa.Integer, nullable=False),
        sa.Column("start_time", sa.Time, nullable=False),
        sa.Column("end_time", sa.Time, nullable=False),
        sa.Column("kind", sa.Enum("no_gi", "gi", "open_mat", name="slot_kind", native_enum=False,
                                  create_constraint=True), nullable=False),
        sa.Column("active", sa.Boolean, nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False),
        sa.UniqueConstraint("weekday", "start_time", "kind"),
        sa.CheckConstraint("weekday BETWEEN 1 AND 7"),
    )
    op.create_table(
        "slot_trainers",
        sa.Column("slot_id", sa.Integer, sa.ForeignKey("slots.id"), primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("slot_trainers")
    op.drop_table("slots")
    op.drop_table("users")
