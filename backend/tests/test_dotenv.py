import os

import pytest

from backend.app import settings


@pytest.fixture
def env_file(tmp_path, monkeypatch):
    path = tmp_path / ".env"
    monkeypatch.setattr(settings, "_ENV_FILE", path)
    return path


def test_parses_plain_utf8(env_file, monkeypatch):
    env_file.write_bytes(b'# comentario\nFOO=bar\nQUOTED="con espacios"\nVACIA=\n')
    monkeypatch.delenv("FOO", raising=False)
    monkeypatch.delenv("QUOTED", raising=False)
    settings._load_dotenv()

    assert os.environ["FOO"] == "bar"
    assert os.environ["QUOTED"] == "con espacios"


def test_recovers_line_appended_as_utf16(env_file, monkeypatch):
    """PowerShell 5.1 añade en UTF-16 sobre un archivo UTF-8 y deja bytes nulos.
    Antes esa línea se ignoraba en silencio y la variable quedaba vacía."""
    env_file.write_bytes(b"FOO=bar\n" + "GEMINI_API_KEY=clave123\n".encode("utf-16-le"))
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    settings._load_dotenv()

    assert os.environ["GEMINI_API_KEY"] == "clave123"


def test_existing_environment_wins(env_file, monkeypatch):
    """En Render las variables vienen del entorno: el archivo no debe pisarlas."""
    env_file.write_bytes(b"YA_DEFINIDA=del-archivo\n")
    monkeypatch.setenv("YA_DEFINIDA", "del-entorno")
    settings._load_dotenv()

    assert os.environ["YA_DEFINIDA"] == "del-entorno"


def test_missing_file_is_not_an_error(env_file):
    assert not env_file.exists()
    settings._load_dotenv()  # en producción no hay .env
