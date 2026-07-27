from __future__ import annotations

import os
from pathlib import Path

_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


def _load_dotenv() -> None:
    """Carga el .env del proyecto en os.environ (solo para desarrollo local).

    Vite ya lee .env por su cuenta para las VITE_*, pero el backend no leía nada: en local
    GEMINI_API_KEY / GROQ_API_KEY / GOOGLE_CLIENT_ID quedaban vacías aunque estuvieran en
    el archivo. En Render no aplica: allí las variables vienen del entorno y ganan siempre
    (no se pisa nada que ya esté definido).

    ponytail: parser de 6 líneas en vez de añadir python-dotenv. Entiende `CLAVE=valor`,
    comentarios y comillas — que es todo lo que tiene este .env. Si algún día hace falta
    valores multilínea, ahí sí: python-dotenv.
    """
    if not _ENV_FILE.exists():
        return
    # errors="replace" + quitar nulos: en Windows, `>>` de PowerShell 5.1 añade la línea en
    # UTF-16 sobre un archivo UTF-8 y queda un .env mezclado. Sin esto, esa línea no casa con
    # `CLAVE=valor` y la variable queda vacía SIN ningún error — se pierde media hora.
    # Quitar los \x00 recupera el texto ASCII escrito en UTF-16.
    text = _ENV_FILE.read_bytes().decode("utf-8", errors="replace").replace("\x00", "")
    for raw in text.splitlines():
        line = raw.strip().lstrip("﻿")
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip().strip('"').strip("'")


def get_allowed_origins() -> list[str]:
    configured = os.getenv("FRONTEND_ORIGINS")
    if configured:
        return [origin.strip() for origin in configured.split(",") if origin.strip()]
    return ["http://localhost:5173"]
