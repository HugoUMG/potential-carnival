"""Comprobaciones de `_verify_google_id_token`: es la puerta de entrada del único registro
abierto de la app, así que cada rechazo tiene su caso. Sin red: se sustituye `httpx.Client`."""
import pytest
from fastapi import HTTPException

from backend.app import main

VALID = {
    "aud": "mi-app.apps.googleusercontent.com",
    "iss": "https://accounts.google.com",
    "email": "profe@gmail.com",
    "email_verified": "true",
}


class _FakeClient:
    """Devuelve siempre la misma respuesta, sea cual sea la petición."""

    def __init__(self, status_code: int, payload: dict) -> None:
        self.status_code = status_code
        self.payload = payload

    def __call__(self, *args, **kwargs):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def get(self, url, params=None):
        return self

    def json(self):
        return self.payload


@pytest.fixture
def google(monkeypatch):
    """Configura el Client ID y deja que cada test decida qué contesta tokeninfo."""
    monkeypatch.setenv("GOOGLE_CLIENT_ID", VALID["aud"])

    def responde(claims: dict, status_code: int = 200):
        monkeypatch.setattr(main.httpx, "Client", _FakeClient(status_code, claims))

    return responde


def test_acepta_un_token_valido(google):
    google(VALID)
    assert main._verify_google_id_token("tok")["email"] == "profe@gmail.com"


def test_sin_client_id_responde_503_y_no_llama_a_google(monkeypatch):
    """Falla en cerrado: sin `aud` que comparar, un ID token de CUALQUIER otra app de
    Google abriría cuentas aquí. Mejor 503 que dejar pasar."""
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)

    def explota(*args, **kwargs):
        raise AssertionError("no debe consultarse a Google sin Client ID configurado")

    monkeypatch.setattr(main.httpx, "Client", explota)
    with pytest.raises(HTTPException) as err:
        main._verify_google_id_token("tok")
    assert err.value.status_code == 503


@pytest.mark.parametrize(
    "cambio",
    [
        {"aud": "otra-app.apps.googleusercontent.com"},  # token de otra aplicación
        {"iss": "accounts.evil.com"},
        {"email_verified": False},
    ],
    ids=["aud-ajena", "emisor-desconocido", "correo-sin-verificar"],
)
def test_rechaza_claims_invalidos(google, cambio):
    google({**VALID, **cambio})
    with pytest.raises(HTTPException) as err:
        main._verify_google_id_token("tok")
    assert err.value.status_code == 401


def test_token_rechazado_por_google_es_401(google):
    """tokeninfo devuelve 400 en tokens caducados o falsos: ahí se valida el `exp`."""
    google({"error": "invalid_token"}, status_code=400)
    with pytest.raises(HTTPException) as err:
        main._verify_google_id_token("tok")
    assert err.value.status_code == 401
