from app.db.base_class import Base
from app.models.activation import EventActivation
from app.models.attendee import Attendee
from app.models.audit import AuditLog
from app.models.check_in import CheckInRecord
from app.models.event import Event
from app.models.event_image import EventImage
from app.models.hold import Hold
from app.models.order import Order, OrderItem
from app.models.organizer import OrganizerProfile, PayoutAccount
from app.models.payment import Payment, Refund
from app.models.staff import StaffAssignment
from app.models.support import SupportCase, SupportMessage
from app.models.ticket import Ticket
from app.models.ticket_type import TicketType
from app.models.token import UserToken
from app.models.user import User
# Import every model module here so Alembic's --autogenerate sees them.
# Unused imports are intentional (ruff F401 is disabled for this file).
