from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt

ALGORITHM = "HS256"
DEFAULT_ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 8
PASSWORD_ALGORITHM = "pbkdf2_sha256"
PASSWORD_ITERATIONS = 390_000


def get_jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET_KEY")
    if secret:
        return secret
    if os.getenv("DATABASE_URL"):
        raise RuntimeError("Falta configurar JWT_SECRET_KEY para producción")
    return "dev-only-change-this-secret"


def get_access_token_expire_minutes() -> int:
    configured = os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES")
    if not configured:
        return DEFAULT_ACCESS_TOKEN_EXPIRE_MINUTES
    return int(configured)


def _derive_password_hash(password: str, salt: bytes, iterations: int) -> str:
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return base64.urlsafe_b64encode(digest).decode("ascii")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    encoded_salt = base64.urlsafe_b64encode(salt).decode("ascii")
    digest = _derive_password_hash(password, salt, PASSWORD_ITERATIONS)
    return f"{PASSWORD_ALGORITHM}${PASSWORD_ITERATIONS}${encoded_salt}${digest}"


def verify_password(password: str, stored_hash: str) -> bool:
    if stored_hash.startswith(f"{PASSWORD_ALGORITHM}$"):
        try:
            _, iterations, encoded_salt, expected_digest = stored_hash.split("$", 3)
            salt = base64.urlsafe_b64decode(encoded_salt.encode("ascii"))
            actual_digest = _derive_password_hash(password, salt, int(iterations))
            return hmac.compare_digest(actual_digest, expected_digest)
        except (ValueError, TypeError):
            return False
    return hmac.compare_digest(password, stored_hash)


def needs_password_rehash(stored_hash: str) -> bool:
    if not stored_hash.startswith(f"{PASSWORD_ALGORITHM}$"):
        return True
    try:
        _, iterations, _, _ = stored_hash.split("$", 3)
    except ValueError:
        return True
    return int(iterations) < PASSWORD_ITERATIONS


def create_access_token(subject: str, role: str, expires_delta: timedelta | None = None) -> str:
    expires_at = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=get_access_token_expire_minutes()))
    payload: dict[str, Any] = {"sub": subject, "role": role, "exp": expires_at}
    return jwt.encode(payload, get_jwt_secret(), algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, get_jwt_secret(), algorithms=[ALGORITHM])
    except JWTError as exc:
        raise ValueError("Token inválido o expirado") from exc
