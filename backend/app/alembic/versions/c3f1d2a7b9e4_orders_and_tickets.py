"""orders and tickets

Revision ID: c3f1d2a7b9e4
Revises: a95da3a018b6
Create Date: 2026-10-15 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3f1d2a7b9e4"
down_revision: Union[str, Sequence[str], None] = "a95da3a018b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "orders",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("total_amount", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "paid",
                "cancelled",
                "expired",
                name="orderstatus",
                native_enum=False,
                length=20,
            ),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'paid', 'cancelled', 'expired')",
            name=op.f("ck_orders_order_status"),
        ),
        sa.CheckConstraint("total_amount >= 0", name=op.f("ck_orders_total_amount_non_negative")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_orders_user_id")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_orders")),
    )
    op.create_index(op.f("ix_orders_user_id"), "orders", ["user_id"], unique=False)
    op.create_index("ix_orders_user_id_status", "orders", ["user_id", "status"], unique=False)

    op.create_table(
        "tickets",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("event_id", sa.BigInteger(), nullable=False),
        sa.Column("order_id", sa.BigInteger(), nullable=True),
        sa.Column("ticket_code", sa.String(length=100), nullable=False),
        sa.Column("seat_number", sa.String(length=50), nullable=True),
        sa.Column("price", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "available",
                "reserved",
                "sold",
                "cancelled",
                name="ticketstatus",
                native_enum=False,
                length=20,
            ),
            server_default="available",
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('available', 'reserved', 'sold', 'cancelled')",
            name=op.f("ck_tickets_ticket_status"),
        ),
        sa.CheckConstraint("price >= 0", name=op.f("ck_tickets_price_non_negative")),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], name=op.f("fk_tickets_event_id")),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], name=op.f("fk_tickets_order_id")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tickets")),
    )
    op.create_index(op.f("ix_tickets_event_id"), "tickets", ["event_id"], unique=False)
    op.create_index(op.f("ix_tickets_order_id"), "tickets", ["order_id"], unique=False)
    op.create_index(op.f("ix_tickets_ticket_code"), "tickets", ["ticket_code"], unique=True)
    op.create_index("ix_tickets_event_id_status", "tickets", ["event_id", "status"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_tickets_event_id_status", table_name="tickets")
    op.drop_index(op.f("ix_tickets_ticket_code"), table_name="tickets")
    op.drop_index(op.f("ix_tickets_order_id"), table_name="tickets")
    op.drop_index(op.f("ix_tickets_event_id"), table_name="tickets")
    op.drop_table("tickets")
    op.drop_index("ix_orders_user_id_status", table_name="orders")
    op.drop_index(op.f("ix_orders_user_id"), table_name="orders")
    op.drop_table("orders")
