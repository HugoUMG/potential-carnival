"""La firma de subida a Cloudinary debe ser la que Cloudinary espera.

Si el orden de los parámetros o el formato cambia, Cloudinary responde 401 y la subida falla
en silencio desde el punto de vista del backend — este test es el único aviso.

Se llama a la función directamente, sin TestClient: instanciar TestClient(app) dispara el
evento `startup` y `initialize_database()` correría contra la base de PRODUCCIÓN.
"""
import hashlib

import pytest
from fastapi import HTTPException

from backend.app.main import upload_signature
from backend.app.models import PublicUser, UserRole

PROFE = PublicUser(id="teacher-1", name="Profe", username="profe", role=UserRole.teacher)


@pytest.fixture
def cloudinary_env(monkeypatch):
    monkeypatch.setenv("CLOUDINARY_CLOUD_NAME", "demo-cloud")
    monkeypatch.setenv("CLOUDINARY_API_KEY", "123456")
    monkeypatch.setenv("CLOUDINARY_API_SECRET", "s3cr3t")


def test_firma_coincide_con_el_algoritmo_de_cloudinary(cloudinary_env):
    body = upload_signature(PROFE)

    assert body["cloud_name"] == "demo-cloud"
    assert body["folder"] == "mydinoenglish/teacher-1"  # cada profesor en su carpeta

    esperada = hashlib.sha1(
        f"folder={body['folder']}&timestamp={body['timestamp']}s3cr3t".encode()
    ).hexdigest()
    assert body["signature"] == esperada


def test_sin_credenciales_responde_503(cloudinary_env, monkeypatch):
    monkeypatch.delenv("CLOUDINARY_API_SECRET")
    with pytest.raises(HTTPException) as error:
        upload_signature(PROFE)
    assert error.value.status_code == 503
