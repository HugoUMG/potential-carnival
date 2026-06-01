import pytest

from backend.app.security import create_access_token, decode_access_token, hash_password, needs_password_rehash, verify_password


def test_hash_password_does_not_store_plain_text_and_verifies(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    password_hash = hash_password("segura123")

    assert password_hash != "segura123"
    assert verify_password("segura123", password_hash)
    assert not verify_password("incorrecta", password_hash)
    assert not needs_password_rehash(password_hash)


def test_jwt_round_trip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")
    token = create_access_token("user-1", "teacher")
    payload = decode_access_token(token)

    assert payload["sub"] == "user-1"
    assert payload["role"] == "teacher"
