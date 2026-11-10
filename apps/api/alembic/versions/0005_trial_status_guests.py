"""guests on attendance, status and member_since on trials

Revision ID: 0005
Revises: 0004
"""
import sqlalchemy as sa

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

STATUSES = ("offen", "mitglied", "zahlt_pro_besuch")


def _attendance(guests: bool) -> sa.Table:
    """Target table shape, because 0004's unnamed CHECKs cannot be dropped by name."""
    cols = [
        sa.Column("date", sa.Date, primary_key=True),
        sa.Column("cancelled", sa.Boolean, nullable=False),
        sa.Column("total", sa.Integer, nullable=True),
        sa.Column("trials", sa.Integer, nullable=False),
    ]
    if guests:
        cols.append(sa.Column("guests", sa.Integer, nullable=False, server_default="0"))
    cols += [
        sa.Column("open_mat", sa.Integer, nullable=True),
        sa.Column("beginner", sa.Integer, nullable=True),
        sa.Column("updated_by", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    ]
    g = " + guests" if guests else ""
    ng = " AND guests >= 0" if guests else ""
    return sa.Table(
        "attendance", sa.MetaData(), *cols,
        sa.CheckConstraint(f"total IS NULL OR trials{g} <= total"),
        sa.CheckConstraint(
            f"(total IS NULL OR total >= 0) AND trials >= 0{ng}"
            " AND (open_mat IS NULL OR open_mat >= 0) AND (beginner IS NULL OR beginner >= 0)"
        ),
    )


def _fk(on: bool) -> None:
    # table rebuilds drop parents of trial_attendance; PRAGMA is a no-op inside a transaction,
    # but SQLite DDL runs outside one here (pysqlite legacy mode)
    op.execute(f"PRAGMA foreign_keys={'ON' if on else 'OFF'}")


def upgrade() -> None:
    _fk(False)
    with op.batch_alter_table("attendance", copy_from=_attendance(False)) as b:
        b.add_column(sa.Column("guests", sa.Integer, nullable=False, server_default="0"))
    # rebuild again so the CHECKs use the new shape
    with op.batch_alter_table("attendance", copy_from=_attendance(True), recreate="always"):
        pass
    with op.batch_alter_table("trials") as b:
        b.add_column(sa.Column("status", sa.String(16), nullable=False, server_default="offen"))
        b.add_column(sa.Column("member_since", sa.Date, nullable=True))
        b.create_check_constraint(
            "ck_trials_trial_status", "status IN (" + ", ".join(f"'{s}'" for s in STATUSES) + ")"
        )
    _fk(True)


def downgrade() -> None:
    _fk(False)
    with op.batch_alter_table("trials") as b:
        b.drop_constraint("ck_trials_trial_status", type_="check")
        b.drop_column("member_since")
        b.drop_column("status")
    # target shape lacks guests, so the rebuild drops it and restores the old CHECKs
    with op.batch_alter_table("attendance", copy_from=_attendance(False), recreate="always"):
        pass
    _fk(True)
