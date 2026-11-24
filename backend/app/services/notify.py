"""Notifications: §4.10's triggers, written to an outbox and sent later.

    notify(db, "order.confirmed", {...}, email=..., user_id=...)

writes rows inside the caller's transaction and does not commit, exactly like
audit.record(): a rolled-back refund leaves no "your refund is complete" email
behind. `deliver_pending` (run on a timer from app.main) sends the email rows.

Each call writes an `email` row always, and an `in_app` row as well when the
recipient has an account. In-app rows are born `sent`: there is nothing to
deliver, the feed just reads them.
"""

import html
import logging
from collections.abc import Sequence
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.orm import Session

from app.core.clock import as_utc, utcnow
from app.core.config import settings
from app.models.notification import Channel, DeliveryStatus, Notification
from app.models.user import User
from app.services import mailer

logger = logging.getLogger(__name__)

# How many emails one tick of the sender takes. Small on purpose: a tick is
# a single transaction, and a slow SMTP server must not hold it open for long.
BATCH = 25
MAX_RETRIES = 5
RETRY_BASE_SECONDS = 30

# (subject, body) per template and locale. `{name}` placeholders are filled
# from the row's payload; a missing one renders as an empty string rather than
# failing the send. Russian is the fallback (users.locale defaults to 'ru').
_T: dict[str, dict[str, tuple[str, str]]] = {
    "auth.email_verification": {
        "en": (
            "Confirm your BiletFlow email",
            "Confirm your email address by opening this link:\n{link}\n\n"
            "This link expires in {expire_hours} hours.",
        ),
        "ru": (
            "Подтвердите электронную почту в BiletFlow",
            "Подтвердите ваш адрес электронной почты, перейдя по ссылке:\n{link}\n\n"
            "Ссылка действует {expire_hours} ч.",
        ),
        "kk": (
            "BiletFlow электрондық поштаңызды растаңыз",
            "Электрондық поштаңызды растау үшін мына сілтемені ашыңыз:\n{link}\n\n"
            "Сілтеме {expire_hours} сағат бойы жарамды.",
        ),
    },
    "auth.password_reset": {
        "en": (
            "Reset your BiletFlow password",
            "Open this link to choose a new password:\n{link}\n\n"
            "It works once and expires in {expire_minutes} minutes. "
            "If you did not ask for this, ignore this email.",
        ),
        "ru": (
            "Сброс пароля в BiletFlow",
            "Перейдите по ссылке, чтобы задать новый пароль:\n{link}\n\n"
            "Ссылка одноразовая и действует {expire_minutes} мин. "
            "Если вы не запрашивали сброс, просто проигнорируйте это письмо.",
        ),
        "kk": (
            "BiletFlow құпиясөзін қалпына келтіру",
            "Жаңа құпиясөз орнату үшін мына сілтемені ашыңыз:\n{link}\n\n"
            "Сілтеме бір рет қана жарамды және {expire_minutes} минуттан кейін аяқталады. "
            "Егер сіз мұны сұрамаған болсаңыз, бұл хатты елемеңіз.",
        ),
    },
    "order.confirmed": {
        "en": (
            "Your tickets for {event_title}",
            "Order {order_number} is confirmed.{details} Open your tickets, download the PDF "
            "and add the event to your calendar:\n{link}",
        ),
        "ru": (
            "Ваши билеты: {event_title}",
            "Заказ {order_number} подтверждён.{details} Откройте билеты, скачайте PDF и "
            "добавьте событие в календарь:\n{link}",
        ),
        "kk": (
            "Билеттеріңіз: {event_title}",
            "{order_number} тапсырысы расталды.{details} Билеттерді ашып, PDF жүктеп алыңыз "
            "және іс-шараны күнтізбеге қосыңыз:\n{link}",
        ),
    },
    "ticket.assigned": {
        "en": (
            "Your ticket for {event_title}",
            "A ticket for {event_title} (order {order_number}) has been issued to you.{details} "
            "Open your ticket or download the attached PDF:\n{link}",
        ),
        "ru": (
            "Ваш билет: {event_title}",
            "Вам оформлен билет на {event_title} (заказ {order_number}).{details} "
            "Откройте билет или скачайте прикреплённый PDF:\n{link}",
        ),
        "kk": (
            "Сіздің билетіңіз: {event_title}",
            "Сізге {event_title} іс-шарасына билет рәсімделді (тапсырыс {order_number}).{details} "
            "Билетті ашыңыз немесе тіркелген PDF файлын жүктеңіз:\n{link}",
        ),
    },
    "activation.fee_failed": {
        "en": (
            "Activation fee payment failed for {event_title}",
            "The (simulated) activation fee payment for {event_title} was declined: {reason}. "
            "Paid sales remain inactive until the fee succeeds:\n{link}",
        ),
        "ru": (
            "Оплата сбора активации для {event_title} не прошла",
            "Платёж (демонстрационный) сбора активации для {event_title} отклонён: {reason}. "
            "Платные продажи остаются неактивными до успешной оплаты:\n{link}",
        ),
        "kk": (
            "{event_title} іске қосу алымының төлемі өтпеді",
            "{event_title} үшін іске қосу алымының (демонстрациялық) төлемі қабылданбады: {reason}. "
            "Төлем сәтті өткенге дейін ақылы сатылым іске қосылмайды:\n{link}",
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
    "support.escalated": {
        "en": (
            "Escalated support case {case_number}: {subject}",
            "{author} escalated an attendee support case to Platform Admins.\n\n"
            "Reason: {reason}\n\n{link}",
        ),
        "ru": (
            "Эскалированное обращение {case_number}: {subject}",
            "{author} передал(а) обращение участника администраторам платформы.\n\n"
            "Причина: {reason}\n\n{link}",
        ),
        "kk": (
            "Эскалацияланған өтініш {case_number}: {subject}",
            "{author} қатысушының өтінішін платформа әкімшілеріне жіберді.\n\n"
            "Себебі: {reason}\n\n{link}",
        ),
    },
}


# Category and status labels for support emails, the same texts the web shows
# (web/src/i18n/locales/*.json, keys support.category.* and support.status.*).
# Only render() uses them: the payload in the database keeps raw keys, because
# the in-app feed reads it too.
_SUPPORT_CATEGORIES: dict[str, dict[str, str]] = {
    "ru": {
        "ticket_delivery": "Получение билетов",
        "payment": "Оплата",
        "refund": "Возврат",
        "seating": "Посадочные места",
        "event_info": "Информация о событии",
        "check_in": "Проверка на входе",
        "account": "Аккаунт",
        "activation": "Активация платных продаж",
        "technical": "Техническая проблема",
    },
    "kk": {
        "ticket_delivery": "Билетті жеткізу",
        "payment": "Төлем",
        "refund": "Қаражатты қайтару",
        "seating": "Орындар",
        "event_info": "Іс-шара туралы ақпарат",
        "check_in": "Кіреберісте тексеру",
        "account": "Аккаунт",
        "activation": "Ақылы сатылымды іске қосу",
        "technical": "Техникалық мәселе",
    },
    "en": {
        "ticket_delivery": "Ticket delivery",
        "payment": "Payment",
        "refund": "Refund",
        "seating": "Seating",
        "event_info": "Event information",
        "check_in": "Check-in",
        "account": "Account",
        "activation": "Paid-sales activation",
        "technical": "Technical problem",
    },
}

_SUPPORT_STATUSES: dict[str, dict[str, str]] = {
    "ru": {
        "open": "Открыто",
        "in_progress": "В работе",
        "waiting_for_customer": "Ожидает ответа заявителя",
        "resolved": "Решено",
    },
    "kk": {
        "open": "Ашық",
        "in_progress": "Қаралуда",
        "waiting_for_customer": "Өтініш берушінің жауабы күтілуде",
        "resolved": "Шешілді",
    },
    "en": {
        "open": "Open",
        "in_progress": "In progress",
        "waiting_for_customer": "Waiting for requester",
        "resolved": "Resolved",
    },
}

_PAYOUT_STATUSES: dict[str, dict[str, str]] = {
    "ru": {
        "active": "активны",
        "suspended": "приостановлены",
        "pending": "в ожидании",
        "processing": "в обработке",
        "paid": "выплачено",
        "failed": "ошибка выплаты",
    },
    "kk": {
        "active": "белсенді",
        "suspended": "уақытша тоқтатылды",
        "pending": "күтуде",
        "processing": "өңделуде",
        "paid": "төленді",
        "failed": "төлем сәтсіз аяқталды",
    },
    "en": {
        "active": "active",
        "suspended": "suspended",
        "pending": "pending",
        "processing": "processing",
        "paid": "paid",
        "failed": "failed",
    },
}


_EVENT_FIELDS: dict[str, dict[str, str]] = {
    "en": {
        "title": "title",
        "description": "description",
        "timezone": "time zone",
        "starts_at": "start time",
        "ends_at": "end time",
        "capacity": "capacity",
        "venue_name": "venue",
        "venue_address": "venue address",
        "venue_city": "city",
        "visibility": "visibility",
        "refund_policy": "refund policy",
        "refunds_allowed": "refund eligibility",
        "refund_cutoff_hours_before_start": "refund deadline",
    },
    "ru": {
        "title": "название",
        "description": "описание",
        "timezone": "часовой пояс",
        "starts_at": "время начала",
        "ends_at": "время окончания",
        "capacity": "вместимость",
        "venue_name": "площадка",
        "venue_address": "адрес площадки",
        "venue_city": "город",
        "visibility": "видимость",
        "refund_policy": "правила возврата",
        "refunds_allowed": "возможность возврата",
        "refund_cutoff_hours_before_start": "срок возврата",
    },
    "kk": {
        "title": "атауы",
        "description": "сипаттамасы",
        "timezone": "уақыт белдеуі",
        "starts_at": "басталу уақыты",
        "ends_at": "аяқталу уақыты",
        "capacity": "сыйымдылығы",
        "venue_name": "өткізу орны",
        "venue_address": "мекенжайы",
        "venue_city": "қаласы",
        "visibility": "көрінуі",
        "refund_policy": "қайтару шарттары",
        "refunds_allowed": "қайтару мүмкіндігі",
        "refund_cutoff_hours_before_start": "қайтару мерзімі",
    },
}


def _format_ticket_details(payload: dict) -> str:
    parts: list[str] = []
    venue = payload.get("venue_name")
    address = payload.get("venue_address")
    if venue:
        parts.append(f"Venue: {venue}" + (f", {address}" if address else ""))
    starts_at = payload.get("starts_at")
    tz_name = payload.get("timezone")
    if starts_at:
        try:
            dt = as_utc(datetime.fromisoformat(starts_at))
            if tz_name:
                dt = dt.astimezone(ZoneInfo(tz_name))
                parts.append(f"Schedule: {dt.strftime('%Y-%m-%d %H:%M')} ({tz_name})")
            else:
                parts.append(f"Schedule: {dt.strftime('%Y-%m-%d %H:%M UTC')}")
        except Exception:
            parts.append(f"Schedule: {starts_at}")
    codes = payload.get("ticket_codes")
    if isinstance(codes, list) and codes:
        parts.append("Ticket code(s): " + ", ".join(str(c) for c in codes))
    elif payload.get("ticket_code"):
        code_line = f"Ticket code: {payload['ticket_code']}"
        if payload.get("seat_label"):
            code_line += f" ({payload['seat_label']})"
        parts.append(code_line)
    return ("\n\n" + "\n".join(parts) + "\n\n") if parts else " "


def _localize_support(template_key: str, payload: dict, locale: str) -> dict:
    """Swap raw category, field, and status keys for labels in the recipient's language.
    Works on a copy: `payload` is the row's own dict. Unknown keys, and rows
    queued before `status_key` existed, keep the value they came with."""
    if template_key == "payout.status":
        payout_statuses = _PAYOUT_STATUSES.get(locale) or _PAYOUT_STATUSES["ru"]
        localized = dict(payload)
        raw_status = localized.get("status_key") or localized.get("status")
        if raw_status in payout_statuses:
            localized["status"] = payout_statuses[raw_status]
        return localized
    if template_key == "event.updated":
        field_labels = _EVENT_FIELDS.get(locale) or _EVENT_FIELDS["ru"]
        localized = dict(payload)
        changed_fields = localized.get("changed_fields")
        if isinstance(changed_fields, list) and changed_fields:
            localized["changes"] = ", ".join(
                field_labels.get(str(field), str(field).replace("_", " "))
                for field in changed_fields
            )
        return localized
    if template_key in ("order.confirmed", "ticket.assigned"):
        localized = dict(payload)
        localized["details"] = _format_ticket_details(localized)
        return localized
    if not template_key.startswith("support."):
        return payload
    categories = _SUPPORT_CATEGORIES.get(locale) or _SUPPORT_CATEGORIES["ru"]
    statuses = _SUPPORT_STATUSES.get(locale) or _SUPPORT_STATUSES["ru"]
    localized = dict(payload)
    if "subject" in localized:
        localized["subject"] = categories.get(localized["subject"], localized["subject"])
    if "status_key" in localized:
        localized["status"] = statuses.get(localized["status_key"], localized.get("status"))
    return localized


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
    values = _Blank(_localize_support(template_key, payload, locale))
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


def _build_ticket_delivery(
    db: Session, row: Notification, subject: str, body: str
) -> tuple[str | None, list[mailer.Attachment]]:
    """Build rich HTML and printable PDF ticket attachment(s) for ticket emails."""
    if row.template_key not in ("order.confirmed", "ticket.assigned"):
        return None, []
    payload = row.payload or {}

    from app.core import qr
    from app.models.attendee import Attendee
    from app.models.event import Event
    from app.models.order import Order
    from app.models.ticket import Ticket, TicketStatus
    from app.models.ticket_type import TicketType
    from app.services import seating as seating_service
    from app.services import ticket_pdf

    order: Order | None = None
    if payload.get("order_id") is not None:
        order = db.get(Order, int(payload["order_id"]))
    elif payload.get("order_number"):
        order = db.scalar(select(Order).where(Order.order_number == str(payload["order_number"])))

    printable: list[ticket_pdf.PrintableTicket] = []
    event: Event | None = None
    if order is not None:
        event = db.get(Event, order.event_id)
        query = (
            select(Ticket, Attendee.full_name, TicketType.name)
            .join(Attendee, Attendee.id == Ticket.attendee_id)
            .join(TicketType, TicketType.id == Ticket.ticket_type_id)
            .where(
                Ticket.order_id == order.id,
                Ticket.status.in_((TicketStatus.VALID, TicketStatus.CHECKED_IN)),
            )
            .order_by(Ticket.id)
        )
        single_code = (
            str(payload["ticket_code"]).upper()
            if row.template_key == "ticket.assigned" and payload.get("ticket_code")
            else None
        )
        if single_code:
            query = query.where(Ticket.public_code == single_code)
        if event is not None:
            for ticket, attendee_name, type_name in db.execute(query):
                printable.append(
                    ticket_pdf.PrintableTicket(
                        public_code=ticket.public_code,
                        qr_payload=qr.sign(
                            qr.ADMISSION, ticket.public_code, ticket.event_id, ticket.qr_nonce
                        ),
                        event_title=event.title,
                        starts_at=event.starts_at,
                        ends_at=event.ends_at,
                        timezone=event.timezone,
                        venue_name=event.venue_name,
                        venue_address=event.venue_address,
                        ticket_type_name=type_name,
                        attendee_name=attendee_name,
                        order_number=order.order_number,
                        seat_label=seating_service.format_seat_label(
                            ticket.section_name, ticket.row_label, ticket.seat_number
                        ),
                    )
                )

    attachments: list[mailer.Attachment] = []
    if printable:
        filename_stem = (
            str(payload["ticket_code"]).upper()
            if row.template_key == "ticket.assigned" and payload.get("ticket_code")
            else (order.order_number if order is not None else "tickets")
        )
        attachments.append(
            mailer.Attachment(
                filename=f"biletflow-{filename_stem}.pdf",
                content_type="application/pdf",
                data=ticket_pdf.render(printable),
            )
        )

    event_title = html.escape(str(payload.get("event_title") or (event.title if event else "")))
    order_number = html.escape(str(payload.get("order_number") or ""))
    link = html.escape(str(payload.get("link") or ""))
    venue_text = ""
    if event is not None:
        venue_text = html.escape(f"{event.venue_name}, {event.venue_address}")
        local_start = as_utc(event.starts_at).astimezone(ZoneInfo(event.timezone))
        schedule_text = html.escape(f"{local_start.strftime('%Y-%m-%d %H:%M')} ({event.timezone})")
    else:
        venue_text = html.escape(
            ", ".join(p for p in (payload.get("venue_name"), payload.get("venue_address")) if p)
        )
        schedule_text = html.escape(str(payload.get("starts_at") or ""))

    rows_html = ""
    if printable:
        items = []
        for item in printable:
            seat = f" — {html.escape(item.seat_label)}" if item.seat_label else ""
            items.append(
                f"<li><strong>{html.escape(item.public_code)}</strong> "
                f"({html.escape(item.ticket_type_name)}{seat}) — "
                f"{html.escape(item.attendee_name)}</li>"
            )
        rows_html = "<ul>" + "".join(items) + "</ul>"
    elif payload.get("ticket_codes"):
        items = [
            f"<li><strong>{html.escape(str(c))}</strong></li>" for c in payload["ticket_codes"]
        ]
        rows_html = "<ul>" + "".join(items) + "</ul>"
    elif payload.get("ticket_code"):
        rows_html = f"<ul><li><strong>{html.escape(str(payload['ticket_code']))}</strong></li></ul>"

    html_body = (
        "<!doctype html><html><body style='font-family:sans-serif;color:#111;line-height:1.5'>"
        f"<h2>{html.escape(subject)}</h2>"
        f"<p><strong>{event_title}</strong>"
        + (f"<br/>Order: <code>{order_number}</code>" if order_number else "")
        + (f"<br/>{schedule_text}" if schedule_text else "")
        + (f"<br/>{venue_text}" if venue_text else "")
        + "</p>"
        + rows_html
        + (
            "<p>Your printable ticket PDF (including QR code) is attached to this email.</p>"
            if attachments
            else ""
        )
        + (f"<p><a href='{link}'>Open your tickets &amp; calendar options</a></p>" if link else "")
        + "</body></html>"
    )
    return html_body, attachments


def deliver_pending(db: Session, now: datetime | None = None) -> int:
    """Send up to BATCH queued or retry-eligible emails. Returns how many were attempted.

    Each row is claimed with a conditional UPDATE before it is sent, so two
    workers running this at once never send the same email twice. Failed sends
    are retried with exponential backoff up to MAX_RETRIES attempts.
    """
    now = now or utcnow()
    due_filter = or_(
        Notification.status == DeliveryStatus.PENDING,
        and_(
            Notification.status == DeliveryStatus.FAILED,
            Notification.retry_count < MAX_RETRIES,
            Notification.next_retry_at.is_not(None),
            Notification.next_retry_at <= now,
        ),
    )
    rows = db.scalars(
        select(Notification)
        .where(Notification.channel == Channel.EMAIL, due_filter)
        .order_by(Notification.id)
        .limit(BATCH)
    ).all()
    attempted = 0
    for row in rows:
        claimed = db.execute(
            update(Notification)
            .where(Notification.id == row.id, Notification.status == row.status)
            .values(status=DeliveryStatus.SENT, sent_at=now, next_retry_at=None)
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
            html_body, attachments = _build_ticket_delivery(db, row, subject, body)
            mailer.send(row.email, subject, body, html=html_body, attachments=attachments)
        except Exception as exc:
            logger.exception("sending notification %s failed", row.id)
            next_retries = (row.retry_count or 0) + 1
            backoff = timedelta(seconds=RETRY_BASE_SECONDS * (2 ** (next_retries - 1)))
            next_retry_at = (now + backoff) if next_retries < MAX_RETRIES else None
            db.execute(
                update(Notification)
                .where(Notification.id == row.id)
                .values(
                    status=DeliveryStatus.FAILED,
                    sent_at=None,
                    retry_count=next_retries,
                    next_retry_at=next_retry_at,
                    last_error=str(exc)[:500],
                )
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


def mark_one_read(
    db: Session, user: User, notification_id: int, now: datetime | None = None
) -> bool:
    row = db.scalar(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == user.id,
            Notification.channel == Channel.IN_APP,
        )
    )
    if row is None:
        return False
    if row.read_at is None:
        row.read_at = now or utcnow()
        db.commit()
    return True
