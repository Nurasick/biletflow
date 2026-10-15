from app.db.base_class import Base
from app.models.event import Event
from app.models.organizer import OrganizerProfile, PayoutAccount
from app.models.staff import StaffAssignment
from app.models.ticket_type import TicketType
from app.models.token import UserToken
from app.models.user import User
# Import every model module here so Alembic's --autogenerate sees them.
# Unused imports are intentional (ruff F401 is disabled for this file).
