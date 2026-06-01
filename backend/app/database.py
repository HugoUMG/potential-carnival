from __future__ import annotations

import os
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE_URL = PROJECT_ROOT / "data" / "worksheet_builder.db"
SCHEMA_PATH = PROJECT_ROOT / "db" / "schema.sql"


def get_database_path() -> Path:
    configured = os.getenv("WORKSHEET_DATABASE_PATH")
    if configured:
        return Path(configured).expanduser().resolve()
    return DEFAULT_DATABASE_URL


def get_connection() -> sqlite3.Connection:
    database_path = get_database_path()
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database() -> None:
    with get_connection() as connection:
        connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
