"""Support cases (§4.13). Two sides, two sets of routes, two serializers.

/support/cases/...        the requester: an attendee (member or guest) or an
                          organizer writing to the platform
/staff/support/cases/...  whoever answers: the event's organizer for attendee
                          cases, Platform Admins for organizer cases

Polling these endpoints is the specified delivery (§9): no WebSockets.
"""

from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentUser, DbSession, OptionalUser
from app.models.support import CaseCategory, CaseStatus, SupportCase
from app.schemas.support import (
    CaseCreate,
    CaseCreated,
    CaseUpdate,
    MessageCreate,
    RequesterCaseRead,
    RequesterCaseSummary,
    StaffCaseRead,
    StaffCaseSummary,
    StaffMessageCreate,
)
from app.services import support as support_service

router = APIRouter(tags=["support"])

MAX_PAGE_SIZE = 100

# Missing and not-yours are the same 404, so case numbers cannot be probed.
CASE_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "Support case not found")

CaseToken = Annotated[str | None, Query(description="The signed link token for guests")]


def _requester_read(db: DbSession, support_case: SupportCase) -> dict:
    return RequesterCaseRead.model_validate(
        {
            **RequesterCaseSummary.model_validate(support_case).model_dump(),
            "context": support_service.context(db, support_case),
            "messages": support_service.requester_thread(db, support_case),
        }
    ).model_dump()


def _staff_read(db: DbSession, support_case: SupportCase) -> dict:
    return StaffCaseRead.model_validate(
        {
            **StaffCaseSummary.model_validate(support_case).model_dump(),
            "context": support_service.context(db, support_case),
            "messages": support_service.staff_thread(db, support_case),
        }
    ).model_dump()


# --- the requester's side -----------------------------------------------------


@router.post("/support/cases", response_model=CaseCreated, status_code=status.HTTP_201_CREATED)
def open_case(data: CaseCreate, user: OptionalUser, db: DbSession) -> dict:
    """Open a case. Guests may, and get back the token for their signed link."""
    try:
        support_case, token = support_service.open_case(db, user, data)
    except support_service.ContactEmailRequired:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "contact_email is required without an account"
        ) from None
    except support_service.OrganizerProfileRequired:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only organizers can open cases for the platform"
        ) from None
    except support_service.ContextNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event, order or ticket not found") from None
    except support_service.ContextMismatch:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "The event, order and ticket do not belong together",
        ) from None
    return {**_requester_read(db, support_case), "access_token": token}


@router.get("/support/cases", response_model=list[RequesterCaseSummary])
def list_my_cases(user: CurrentUser, db: DbSession) -> Sequence[SupportCase]:
    return support_service.list_requester_cases(db, user)


@router.get("/support/cases/{case_number}", response_model=RequesterCaseRead)
def read_my_case(case_number: str, user: OptionalUser, db: DbSession, token: CaseToken = None):
    support_case = support_service.get_requester_case(db, case_number, user, token)
    if support_case is None:
        raise CASE_NOT_FOUND
    return _requester_read(db, support_case)


@router.post("/support/cases/{case_number}/messages", response_model=RequesterCaseRead)
def reply_to_my_case(
    case_number: str,
    data: MessageCreate,
    user: OptionalUser,
    db: DbSession,
    token: CaseToken = None,
):
    support_case = support_service.get_requester_case(db, case_number, user, token, lock=True)
    if support_case is None:
        raise CASE_NOT_FOUND
    support_service.add_requester_message(db, support_case, user, data.body)
    return _requester_read(db, support_case)


# --- the staff side -----------------------------------------------------------


@router.get("/staff/support/cases", response_model=list[StaffCaseSummary])
def list_staff_cases(
    user: CurrentUser,
    db: DbSession,
    case_status: Annotated[CaseStatus | None, Query(alias="status")] = None,
    category: CaseCategory | None = None,
    event_id: int | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Sequence[SupportCase]:
    """The cases the caller may answer. Empty, not 403, for a user who may
    answer none: the queue is simply theirs, and it is empty."""
    return support_service.list_staff_cases(
        db,
        user,
        status=case_status,
        category=category,
        event_id=event_id,
        limit=limit,
        offset=offset,
    )


@router.get("/staff/support/cases/{case_number}", response_model=StaffCaseRead)
def read_staff_case(case_number: str, user: CurrentUser, db: DbSession):
    support_case = support_service.get_staff_case(db, user, case_number)
    if support_case is None:
        raise CASE_NOT_FOUND
    return _staff_read(db, support_case)


@router.post("/staff/support/cases/{case_number}/messages", response_model=StaffCaseRead)
def reply_as_staff(case_number: str, data: StaffMessageCreate, user: CurrentUser, db: DbSession):
    support_case = support_service.get_staff_case(db, user, case_number, lock=True)
    if support_case is None:
        raise CASE_NOT_FOUND
    support_service.add_staff_message(
        db, support_case, user, data.body, internal=data.is_internal_note
    )
    return _staff_read(db, support_case)


@router.patch("/staff/support/cases/{case_number}", response_model=StaffCaseRead)
def update_staff_case(case_number: str, data: CaseUpdate, user: CurrentUser, db: DbSession):
    """Change status, assign, or both. Moves follow state-machines.md §8."""
    support_case = support_service.get_staff_case(db, user, case_number, lock=True)
    if support_case is None:
        raise CASE_NOT_FOUND
    try:
        support_service.update_case(db, support_case, user, data)
    except support_service.InvalidTransition as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"A case cannot go from {exc.current} to {exc.target}"
        ) from None
    except support_service.InvalidAssignee:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That user cannot work on this case"
        ) from None
    return _staff_read(db, support_case)
