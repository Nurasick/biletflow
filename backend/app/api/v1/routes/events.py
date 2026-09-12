from datetime import datetime

from fastapi import APIRouter

from app.schemas.event import EventRead

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/test", response_model=EventRead)
def test_event_schema():
    """Проверочный ручка: отдаёт фейковые данные через схему EventRead."""
    return EventRead(
        id=1,
        title="Тестовый концерт",
        description="Проверка работы схемы",
        category="concert",
        image_url=None,
        venue_name="Астана Арена",
        venue_address="Кабанбай батыра, 45",
        start_time=datetime.now(),
        end_time=None,
        capacity=100,
        registration_start=None,
        registration_end=None,
        status="published",
        visibility="public",
        organizer_id=1,
        created_at=datetime.now(),
        updated_at=datetime.now(),
    )
