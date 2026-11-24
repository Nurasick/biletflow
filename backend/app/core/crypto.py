"""Optional application-level encryption wrapper for sensitive stored fields (§7).

Supports:
1. A pluggable KMS provider registered via `register_kms_provider(encrypt_fn, decrypt_fn)`
   (e.g., AWS KMS / GCP KMS / HashiCorp Vault Transit).
2. A Fernet key supplied via `FIELD_ENCRYPTION_KEY` (when `cryptography` is installed).
3. Transparent pass-through when neither is configured (relying on encrypted PostgreSQL
   volumes / KMS-encrypted RDS disks, as documented in `docs/backup-recovery.md`).

Ciphertexts are tagged with `enc:v1:` so existing plaintext records remain readable during
online key rollouts without downtime. Fails closed if `FIELD_ENCRYPTION_KEY` is configured
but `cryptography` is unavailable or the key is invalid.
"""

from collections.abc import Callable

from app.core.config import settings

ENC_PREFIX = "enc:v1:"

_kms_encrypt: Callable[[str], str] | None = None
_kms_decrypt: Callable[[str], str] | None = None


class EncryptionConfigurationError(RuntimeError):
    """Raised when FIELD_ENCRYPTION_KEY is set without a valid cipher backend."""


def register_kms_provider(
    encrypt_fn: Callable[[str], str] | None,
    decrypt_fn: Callable[[str], str] | None,
) -> None:
    """Attach (or clear) a custom KMS encrypt/decrypt pair."""
    global _kms_encrypt, _kms_decrypt
    _kms_encrypt = encrypt_fn
    _kms_decrypt = decrypt_fn


def _fernet():
    key = settings.FIELD_ENCRYPTION_KEY.strip()
    if not key:
        return None
    try:
        from cryptography.fernet import Fernet
    except ImportError as exc:
        raise EncryptionConfigurationError(
            "FIELD_ENCRYPTION_KEY is set, but 'cryptography' is not installed. "
            "Install cryptography, register a KMS provider, or clear FIELD_ENCRYPTION_KEY "
            "and use encrypted PostgreSQL volumes."
        ) from exc
    try:
        return Fernet(key.encode("ascii"))
    except Exception as exc:
        raise EncryptionConfigurationError("Invalid Fernet FIELD_ENCRYPTION_KEY") from exc


def encrypt_field(value: str | None) -> str | None:
    if value is None or value == "" or value.startswith(ENC_PREFIX):
        return value
    if _kms_encrypt is not None:
        return ENC_PREFIX + _kms_encrypt(value)
    fernet = _fernet()
    if fernet is None:
        return value
    return ENC_PREFIX + fernet.encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_field(value: str | None) -> str | None:
    if value is None or not value.startswith(ENC_PREFIX):
        return value
    token = value.removeprefix(ENC_PREFIX)
    if _kms_decrypt is not None:
        return _kms_decrypt(token)
    fernet = _fernet()
    if fernet is None:
        raise EncryptionConfigurationError(
            "Encrypted field encountered without FIELD_ENCRYPTION_KEY or KMS provider"
        )
    return fernet.decrypt(token.encode("ascii")).decode("utf-8")
