"""Platform-wide settings a Platform Admin can change at runtime (§4.12).

The environment supplies the defaults (app.core.config). A row in
platform_settings overrides one. Values already copied onto a record, such
as the activation fee quoted to an organizer, do not change when the setting
does: see models/activation.py.
"""

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.platform import PlatformSetting
from app.models.user import User
from app.services import audit

# key -> (default, minimum, maximum). The bounds are validation, not policy:
# they stop a typo (a fee of 25 000 % instead of 2.5 %) from reaching checkout.
DEFINITIONS: dict[str, tuple[int, int, int]] = {
    "activation_fee_minor": (settings.ACTIVATION_FEE_MINOR, 0, 100_000_000),
    "processing_fee_bps": (settings.PROCESSING_FEE_BPS, 0, 2_000),
}


class UnknownSetting(Exception):
    pass


class SettingOutOfRange(Exception):
    def __init__(self, low: int, high: int):
        super().__init__(f"must be between {low} and {high}")
        self.low, self.high = low, high


def get_int(db: Session, key: str) -> int:
    row = db.get(PlatformSetting, key)
    return row.value if row is not None else DEFINITIONS[key][0]


def all_settings(db: Session) -> dict[str, int]:
    return {key: get_int(db, key) for key in DEFINITIONS}


def set_int(db: Session, key: str, value: int, admin: User) -> None:
    """Does not commit; the route does, so the audit row lands with the change."""
    if key not in DEFINITIONS:
        raise UnknownSetting
    _, low, high = DEFINITIONS[key]
    if not low <= value <= high:
        raise SettingOutOfRange(low, high)
    row = db.get(PlatformSetting, key)
    before = row.value if row is not None else DEFINITIONS[key][0]
    if row is None:
        db.add(PlatformSetting(key=key, value=value, updated_by_user_id=admin.id))
    else:
        row.value = value
        row.updated_by_user_id = admin.id
    # §7 "Organizer and administrator actions shall be auditable."
    audit.record(
        db,
        action="platform.setting_changed",
        entity_type="platform_setting",
        entity_id=0,
        actor=admin,
        summary=f"Platform setting {key} changed from {before} to {value}",
        payload={"key": key, "from": before, "to": value},
    )


def processing_fee(db: Session, amount_minor: int) -> int:
    """The processing charge on an amount, rounded half up to a whole tiyn."""
    return (amount_minor * get_int(db, "processing_fee_bps") + 5_000) // 10_000
