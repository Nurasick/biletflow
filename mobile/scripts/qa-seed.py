"""Fixtures for the disposable mobile QA database only; never run on the development DB."""
import json
import os
import sys
from datetime import UTC, datetime, timedelta

sys.path.insert(0, "/app")
from urllib.parse import urlparse

url = urlparse(os.environ.get("DATABASE_URL", ""))
if (
    os.environ.get("BILETFLOW_MOBILE_QA") != "1"
    or not (url.hostname or "").startswith("biletflow-mobile-qa-")
    or not (url.hostname or "").endswith("-db")
    or url.path != "/mobile_qa"
):
    raise SystemExit("Refusing to seed a non-QA database")

from sqlalchemy import select

from app.core import qr
from app.core.security import get_password_hash
from app.db.base import Base  # register all canonical models
from app.db.session import SessionLocal
from app.models.event import Event
from app.models.organizer import OrganizerProfile
from app.models.staff import StaffAssignment
from app.models.ticket import Ticket
from app.models.ticket_type import TicketType
from app.models.user import User

payload = json.load(sys.stdin)
mode = sys.argv[1]
with SessionLocal() as db:
    if mode == "init":
        if db.scalar(select(User.id).limit(1)) is not None:
            raise SystemExit("QA database is not empty")
        hashed = get_password_hash(payload["password"])
        users = {}
        for role in ["owner", "door", "attendee", "outsider", "platform"]:
            user = User(
                email=f"{role}@example.com", hashed_password=hashed,
                first_name="QA", last_name=role, is_email_verified=True,
                is_platform_admin=role == "platform", locale="en",
            )
            db.add(user)
            db.flush()
            users[role] = user
        profile = OrganizerProfile(user_id=users["owner"].id, display_name="QA Organizer", contact_email=users["owner"].email)
        db.add(profile)
        db.flush()
        now = datetime.now(UTC)
        events = []
        for index in range(3):
            event = Event(
                organizer_profile_id=profile.id, slug=f"qa-event-{index}", title=f"QA event {index}",
                venue_name="QA Venue", venue_address="QA Address", starts_at=now+timedelta(days=1),
                ends_at=now+timedelta(days=1,hours=2), timezone="Asia/Almaty", status="published",
                published_at=now, capacity=100,
            )
            db.add(event)
            db.flush()
            events.append(event)
        general = TicketType(event_id=events[0].id, name="General", price_minor=0, currency="KZT", quantity_total=100, max_per_order=20)
        db.add(general)
        for event in events[:2]:
            db.add(StaffAssignment(event_id=event.id, user_id=users["door"].id, assigned_by_user_id=users["owner"].id))
        db.commit()
        print(json.dumps({"users":{role:{"id":user.id,"email":user.email} for role,user in users.items()},"event_ids":[event.id for event in events],"slug":events[0].slug,"ticket_type_id":general.id}))
    elif mode == "ticket-states":
        cancelled = db.scalar(select(Ticket).where(Ticket.public_code == payload["cancelled"]))
        refunded = db.scalar(select(Ticket).where(Ticket.public_code == payload["refunded"]))
        first = db.scalar(select(Ticket).where(Ticket.public_code == payload["campaign_source"]))
        if cancelled is None or refunded is None or first is None:
            raise SystemExit("QA tickets missing")
        cancelled.status = "cancelled"
        refunded.status = "refunded"
        db.commit()
        print(json.dumps({"campaign":qr.sign(qr.CAMPAIGN,first.public_code,first.event_id,first.qr_nonce)}))
    else:
        raise SystemExit("Unknown QA fixture mode")
