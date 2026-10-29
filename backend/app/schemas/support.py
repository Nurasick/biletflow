"""Support cases (§4.13). Two serializer families, one per side of the case.

The requester's models have no `is_internal_note` field at all, so a note
cannot leak through them by a forgotten flag (06-support.md). The query that
loads the requester's thread also leaves notes out; this is the second wall.
"""

from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from app.models.support import CaseAudience, CaseCategory, CaseStatus, MessageSender

MAX_MESSAGE_LENGTH = 5000

MessageBody = Field(min_length=1, max_length=MAX_MESSAGE_LENGTH)


class CaseCreate(BaseModel):
    """What the requester sends. Context comes from the page the case was
    opened on (§4.13), so the client fills it in, never the user.

    Attendee cases name at least one of event, order or ticket: that is how
    the case finds the organizer who must answer it. A guest proves the order
    is theirs with the order's signed link token.
    """

    audience: CaseAudience = CaseAudience.ATTENDEE
    category: CaseCategory
    body: str = MessageBody

    # Required for guests; members are always answered at their account email.
    contact_email: EmailStr | None = None

    event_id: int | None = None
    order_number: str | None = Field(default=None, max_length=32)
    ticket_code: str | None = Field(default=None, max_length=32)
    order_token: str | None = None

    @model_validator(mode="after")
    def check_context(self) -> Self:
        has_order_context = self.order_number is not None or self.ticket_code is not None
        if self.audience == CaseAudience.ATTENDEE:
            if self.event_id is None and not has_order_context:
                raise ValueError("an attendee case needs an event, order or ticket")
        elif has_order_context:
            # An organizer writes to the platform about their account or an
            # event, not about one attendee's order.
            raise ValueError("an organizer case can only refer to an event")
        return self


class MessageCreate(BaseModel):
    body: str = MessageBody


class StaffMessageCreate(BaseModel):
    body: str = MessageBody
    is_internal_note: bool = False


class CaseUpdate(BaseModel):
    """Staff actions. `waiting_for_customer -> in_progress` is not here: per
    state-machines.md §8 only the requester's reply makes that move."""

    status: Literal["in_progress", "waiting_for_customer", "resolved"] | None = None
    # null unassigns, so null is meaningful here, unlike status.
    assigned_to_user_id: int | None = None

    @model_validator(mode="after")
    def check_not_null(self) -> Self:
        if "status" in self.model_fields_set and self.status is None:
            raise ValueError("status cannot be null")
        if not self.model_fields_set:
            raise ValueError("send status, assigned_to_user_id, or both")
        return self


class CaseContext(BaseModel):
    """The attached context, shown so the requester can confirm it is the right
    ticket. Public identifiers only: order numbers and ticket codes, not ids."""

    event_id: int | None
    event_title: str | None
    order_number: str | None
    ticket_code: str | None


# --- the requester's side -----------------------------------------------------


class RequesterMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sender: MessageSender
    body: str
    created_at: datetime


class RequesterCaseSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    case_number: str
    audience: CaseAudience
    category: CaseCategory
    status: CaseStatus
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None


class RequesterCaseRead(RequesterCaseSummary):
    context: CaseContext
    messages: list[RequesterMessageRead]


class CaseCreated(RequesterCaseRead):
    # Set for guests only: the token for the signed link, also emailed to them.
    access_token: str | None


# --- the staff side -----------------------------------------------------------


class StaffMessageRead(RequesterMessageRead):
    author_user_id: int | None
    is_internal_note: bool


class StaffCaseSummary(RequesterCaseSummary):
    contact_email: str
    opened_by_user_id: int | None
    assigned_to_user_id: int | None
    event_id: int | None


class StaffCaseRead(StaffCaseSummary):
    context: CaseContext
    messages: list[StaffMessageRead]
