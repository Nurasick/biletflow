"""Notifications: §4.10's triggers, written to an outbox and sent later.

    notify(db, "order.confirmed", {...}, email=..., user_id=...)

writes rows inside the caller's transaction and does not commit, exactly like
audit.record(): a rolled-back refund leaves no "your refund is complete" email
behind. `deliver_pending` (run on a timer from app.main) sends the email rows.

Each call writes an `email` row always, and an `in_app` row as well when the
recipient has an account. In-app rows are born `sent`: there is nothing to
deliver, the feed just reads them.
"""

import logging
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import settings
from app.models.notification import Channel, DeliveryStatus, Notification
from app.models.user import User
from app.services import mailer

logger = logging.getLogger(__name__)

# How many emails one tick of the sender takes. Small on purpose: a tick is
# a single transaction, and a slow SMTP server must not hold it open for long.
BATCH = 25

# (subject, body) per template and locale. `{name}` placeholders are filled
# from the row's payload; a missing one renders as an empty string rather than
# failing the send. Russian is the fallback (users.locale defaults to 'ru').
_T: dict[str, dict[str, tuple[str, str]]] = {
    "order.confirmed": {
        "en": (
            "Your tickets for {event_title}",
            "Order {order_number} is confirmed. Open your tickets, download the PDF "
            "and add the event to your calendar:\n{link}",
        ),
        "ru": (
            "Ваши билеты: {event_title}",
            "Заказ {order_number} подтверждён. Откройте билеты, скачайте PDF и "
            "добавьте событие в календарь:\n{link}",
        ),
        "kk": (
            "Билеттеріңіз: {event_title}",
            "{order_number} тапсырысы расталды. Билеттерді ашып, PDF жүктеп алыңыз "
            "және іс-шараны күнтізбеге қосыңыз:\n{link}",
        ),
    },
    "payment.failed": {
        "en": (
            "Payment failed for order {order_number}",
            "The (simulated) payment for {event_title} was declined: {reason}. "
            "No tickets were issued and the reservation was released. You can try again:\n{link}",
        ),
        "ru": (
            "Оплата заказа {order_number} не прошла",
            "Платёж (демонстрационный) за {event_title} отклонён: {reason}. "
            "Билеты не выпущены, бронь снята. Попробуйте ещё раз:\n{link}",
        ),
        "kk": (
            "{order_number} тапсырысының төлемі өтпеді",
            "{event_title} үшін (демонстрациялық) төлем қабылданбады: {reason}. "
            "Билеттер шығарылмады, бронь босатылды. Қайта көріңіз:\n{link}",
        ),
    },
    "order.cancelled": {
        "en": (
            "Your registration for {event_title} was cancelled",
            "Order {order_number} was cancelled by the organizer. Its tickets are no "
            "longer valid.\n{link}",
        ),
        "ru": (
            "Регистрация на {event_title} отменена",
            "Заказ {order_number} отменён организатором. Билеты больше недействительны.\n{link}",
        ),
        "kk": (
            "{event_title} тіркелуі тоқтатылды",
            "{order_number} тапсырысын ұйымдастырушы тоқтатты. Билеттер енді жарамсыз.\n{link}",
        ),
    },
    "refund.completed": {
        "en": (
            "Refund completed for order {order_number}",
            "{amount} was refunded (simulated) for {event_title}. The tickets of this "
            "order are no longer valid.\n{link}",
        ),
        "ru": (
            "Возврат по заказу {order_number} выполнен",
            "Возвращено {amount} (демонстрационно) за {event_title}. Билеты этого "
            "заказа больше недействительны.\n{link}",
        ),
        "kk": (
            "{order_number} тапсырысы бойынша қайтарым жасалды",
            "{event_title} үшін {amount} қайтарылды (демонстрациялық). Бұл тапсырыстың "
            "билеттері енді жарамсыз.\n{link}",
        ),
    },
    "event.updated": {
        "en": (
            "{event_title} was updated",
            "The organizer changed: {changes}. Check the event page for the current "
            "details:\n{link}",
        ),
        "ru": (
            "Событие {event_title} обновлено",
            "Организатор изменил: {changes}. Актуальные данные на странице события:\n{link}",
        ),
        "kk": (
            "{event_title} іс-шарасы жаңартылды",
            "Ұйымдастырушы өзгертті: {changes}. Өзекті мәліметтер іс-шара бетінде:\n{link}",
        ),
    },
    "event.cancelled": {
        "en": (
            "{event_title} was cancelled",
            "The event was cancelled. Free registrations are cancelled and paid orders "
            "are refunded in full. An updated calendar file is here:\n{link}",
        ),
        "ru": (
            "Событие {event_title} отменено",
            "Событие отменено. Бесплатные регистрации аннулированы, оплаченные заказы "
            "возвращены полностью. Обновлённый файл календаря:\n{link}",
        ),
        "kk": (
            "{event_title} іс-шарасы тоқтатылды",
            "Іс-шара тоқтатылды. Тегін тіркелулер жойылды, ақылы тапсырыстар толық "
            "қайтарылды. Жаңартылған күнтізбе файлы:\n{link}",
        ),
    },
    "payout.status": {
        "en": (
            "Paid sales for {event_title}: {status}",
            "Paid sales for {event_title} are now {status}. Payouts are simulated in "
            "this demonstration; no real money moves.\n{link}",
        ),
        "ru": (
            "Платные продажи {event_title}: {status}",
            "Статус платных продаж для {event_title}: {status}. Выплаты в этой "
            "демонстрации симулируются, реальные деньги не переводятся.\n{link}",
        ),
        "kk": (
            "{event_title} ақылы сатылымы: {status}",
            "{event_title} ақылы сатылым мәртебесі: {status}. Бұл демонстрацияда "
            "төлемдер симуляцияланады, нақты ақша аударылмайды.\n{link}",
        ),
    },
    "support.message": {
        "en": (
            "New reply in support case {case_number}",
            "{author} replied in “{subject}”:\n\n{excerpt}\n\n{link}",
        ),
        "ru": (
            "Новый ответ в обращении {case_number}",
            "{author} ответил(а) в «{subject}»:\n\n{excerpt}\n\n{link}",
        ),
        "kk": (
            "{case_number} өтінішінде жаңа жауап",
            "{author} «{subject}» өтінішіне жауап берді:\n\n{excerpt}\n\n{link}",
        ),
    },
    "support.assigned": {
        "en": (
            "Support case {case_number} was assigned to you",
            "You are now handling “{subject}”.\n{link}",
        ),
        "ru": (
            "Вам назначено обращение {case_number}",
            "Теперь вы ведёте обращение «{subject}».\n{link}",
        ),
        "kk": (
            "{case_number} өтініші сізге тағайындалды",
            "Енді «{subject}» өтінішін сіз жүргізесіз.\n{link}",
        ),
    },
    "support.status": {
        "en": (
            "Support case {case_number}: {status}",
            "The status of “{subject}” changed to {status}.\n{link}",
        ),
        "ru": (
            "Обращение {case_number}: {status}",
            "Статус обращения «{subject}» изменён: {status}.\n{link}",
        ),
        "kk": (
            "{case_number} өтініші: {status}",
            "«{subject}» өтінішінің мәртебесі өзгерді: {status}.\n{link}",
        ),
    },
    "support.opened": {
        "en": (
            "New support case {case_number}: {subject}",
            "{author} opened a new support case:\n\n{excerpt}\n\n{link}",
        ),
        "ru": (
            "Новое обращение {case_number}: {subject}",
            "{author} открыл(а) новое обращение:\n\n{excerpt}\n\n{link}",
        ),
        "kk": (
            "Жаңа өтініш {case_number}: {subject}",
            "{author} жаңа өтініш ашты:\n\n{excerpt}\n\n{link}",
        ),
    },
    "support.received": {
        "en": (
            "Support case {case_number} received",
            "Your support case “{subject}” was received. We will reply as soon as "
            "possible.\n{link}",
        ),
        "ru": (
            "Обращение {case_number} принято",
            "Ваше обращение «{subject}» принято. Мы ответим как можно скорее.\n{link}",
        ),
        "kk": (
            "{case_number} өтініші қабылданды",
            "Сіздің «{subject}» өтінішіңіз қабылданды. Біз мүмкіндігінше тезірек жауап береміз.\n{link}",
        ),
    },
}


class _Blank(dict):
    def __missing__(self, key: str) -> str:
        return ""


def render(template_key: str, payload: dict, locale: str = "ru") -> tuple[str, str]:
    """Subject and body for an email. An unknown key degrades to a generic
    message instead of raising: a template rename must not wedge the outbox."""
    variants = _T.get(template_key)
    if variants is None:
        return f"{settings.PROJECT_NAME}: {template_key}", str(payload.get("link", ""))
    subject, body = variants.get(locale) or variants["ru"]
    values = _Blank(payload)
    return subject.format_map(values), body.format_map(values)


def notify(
    db: Session,
    template_key: str,
    payload: dict,
    *,
    email: str,
    user_id: int | None = None,
    in_app: bool = True,
) -> None:
    """Queue one notification. Inside the caller's transaction; does not commit.

    `payload` must be JSON-serializable and should carry a `link`, which both
    the email and the feed turn into the thing to click.
    """
    db.add(
        Notification(
            user_id=user_id,
            email=email,
            channel=Channel.EMAIL,
            template_key=template_key,
            payload=payload,
            status=DeliveryStatus.PENDING,
        )
    )
    if user_id is not None and in_app:
        db.add(
            Notification(
                user_id=user_id,
                email=email,
                channel=Channel.IN_APP,
                template_key=template_key,
                payload=payload,
                status=DeliveryStatus.SENT,
                sent_at=utcnow(),
            )
        )


def notify_user(db: Session, user: User, template_key: str, payload: dict) -> None:
    notify(db, template_key, payload, email=user.email, user_id=user.id)


def web_link(path: str) -> str:
    return settings.PUBLIC_WEB_URL.rstrip("/") + path


def deliver_pending(db: Session, now: datetime | None = None) -> int:
    """Send up to BATCH queued emails. Returns how many were attempted.

    Each row is claimed with a conditional UPDATE before it is sent, so two
    workers running this at once never send the same email twice: the second
    one finds the row no longer `pending` and skips it.
    """
    now = now or utcnow()
    rows = db.scalars(
        select(Notification)
        .where(Notification.channel == Channel.EMAIL, Notification.status == DeliveryStatus.PENDING)
        .order_by(Notification.id)
        .limit(BATCH)
    ).all()
    attempted = 0
    for row in rows:
        claimed = db.execute(
            update(Notification)
            .where(Notification.id == row.id, Notification.status == DeliveryStatus.PENDING)
            .values(status=DeliveryStatus.SENT, sent_at=now)
            .execution_options(synchronize_session=False)
        )
        if claimed.rowcount == 0:
            continue
        attempted += 1
        locale = "ru"
        if row.user_id is not None:
            locale = db.scalar(select(User.locale).where(User.id == row.user_id)) or "ru"
        subject, body = render(row.template_key, row.payload or {}, locale)
        try:
            mailer.send(row.email, subject, body)
        except Exception:
            # Marked failed rather than left pending, so one bad address
            # cannot block the queue by being retried forever.
            logger.exception("sending notification %s failed", row.id)
            db.execute(
                update(Notification)
                .where(Notification.id == row.id)
                .values(status=DeliveryStatus.FAILED, sent_at=None)
                .execution_options(synchronize_session=False)
            )
    db.commit()
    return attempted


# --- the in-app feed ---------------------------------------------------------


def feed(db: Session, user: User, limit: int = 30) -> Sequence[Notification]:
    return db.scalars(
        select(Notification)
        .where(Notification.user_id == user.id, Notification.channel == Channel.IN_APP)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
    ).all()


def unread_count(db: Session, user: User) -> int:
    return db.scalar(
        select(func.count()).where(
            Notification.user_id == user.id,
            Notification.channel == Channel.IN_APP,
            Notification.read_at.is_(None),
        )
    )


def mark_all_read(db: Session, user: User, now: datetime | None = None) -> None:
    db.execute(
        update(Notification)
        .where(
            Notification.user_id == user.id,
            Notification.channel == Channel.IN_APP,
            Notification.read_at.is_(None),
        )
        .values(read_at=now or utcnow())
        .execution_options(synchronize_session=False)
    )
    db.commit()
