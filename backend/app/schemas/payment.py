from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class PaymentConfigRead(BaseModel):
    provider: Literal["simulator", "halyk_sandbox", "halyk"]
    halyk_enabled: bool
    halyk_sandbox: bool
    simulator_enabled: bool
    script_url: str | None = None


class HalykInitiateRequest(BaseModel):
    language: Literal["en", "ru", "kk"] = "en"
    return_url: str | None = Field(default=None, max_length=1000)
    failure_return_url: str | None = Field(default=None, max_length=1000)


class HalykInitiateResponse(BaseModel):
    payment_id: int
    invoice_id: str
    script_url: str
    checkout_url: str
    payment_object: dict[str, Any]


class HalykVerifyRequest(BaseModel):
    invoice_id: str | None = Field(default=None, min_length=6, max_length=15)


class HalykWebhookPayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str | None = None
    invoiceId: str | None = None
    invoiceID: str | None = None
    amount: int | float | str | None = None
    currency: str | None = None
    terminal: str | None = None
    approvalCode: str | None = None
    reference: str | None = None
    code: str | int | None = None
    reason: str | None = None
    reasonCode: str | int | None = None
    statusName: str | None = None
    secret_hash: str | None = None

    @property
    def resolved_invoice_id(self) -> str:
        return (self.invoiceId or self.invoiceID or "").strip()


class HalykWebhookResponse(BaseModel):
    status: Literal["ok"] = "ok"
    payment_status: str
