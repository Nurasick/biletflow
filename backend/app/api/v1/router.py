from fastapi import APIRouter

from app.api.v1.routes import (
    activation,
    admin,
    auth,
    check_in,
    event_images,
    event_reports,
    events,
    health,
    orders,
    organizer,
    support,
    ticket_types,
    users,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(health.router)
api_router.include_router(users.router)
api_router.include_router(events.router)
api_router.include_router(event_images.router)
api_router.include_router(ticket_types.router)
api_router.include_router(orders.router)
api_router.include_router(organizer.router)
api_router.include_router(activation.router)
api_router.include_router(event_reports.router)
api_router.include_router(check_in.router)
api_router.include_router(admin.router)
api_router.include_router(support.router)
