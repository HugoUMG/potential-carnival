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


def _add_column_if_missing(connection: sqlite3.Connection, table: str, definition: str) -> None:
    column_name = definition.split()[0]
    existing_columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
    if column_name not in existing_columns:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")


def initialize_database() -> None:
    with get_connection() as connection:
        connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        _add_column_if_missing(connection, "users", "username TEXT")
        _add_column_if_missing(connection, "worksheets", "max_attempts INTEGER")
        _add_column_if_missing(connection, "worksheet_responses", "details_json TEXT NOT NULL DEFAULT '[]'")
        _add_column_if_missing(connection, "worksheet_responses", "correct_count INTEGER NOT NULL DEFAULT 0")
        _add_column_if_missing(connection, "worksheet_responses", "pending_count INTEGER NOT NULL DEFAULT 0")
        connection.execute("UPDATE users SET username = 'profesor' WHERE id = 'teacher-demo' AND username IS NULL")
        connection.execute("UPDATE users SET username = 'estudiante' WHERE id = 'student-demo' AND username IS NULL")
