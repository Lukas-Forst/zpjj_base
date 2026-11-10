"""slots.location (None = home gym, e.g. "Rheinheim" for the second location)

Revision ID: 0006
Revises: 0005
"""
import sqlalchemy as sa

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("slots", sa.Column("location", sa.String(50), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("slots") as b:
        b.drop_column("location")
