from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Literal

from .security import hash_password

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE_URL = PROJECT_ROOT / "data" / "worksheet_builder.db"
SQLITE_SCHEMA_PATH = PROJECT_ROOT / "db" / "schema.sql"
POSTGRES_SCHEMA_PATH = PROJECT_ROOT / "db" / "schema.postgres.sql"
DatabaseBackend = Literal["sqlite", "postgresql"]


def get_database_backend() -> DatabaseBackend:
    return "postgresql" if os.getenv("DATABASE_URL") else "sqlite"


def get_database_path() -> Path:
    configured = os.getenv("WORKSHEET_DATABASE_PATH")
    if configured:
        return Path(configured).expanduser().resolve()
    return DEFAULT_DATABASE_URL


def get_database_url() -> str:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("Falta configurar DATABASE_URL para PostgreSQL")
    return database_url


def get_connection():
    if get_database_backend() == "postgresql":
        import psycopg
        from psycopg.rows import dict_row

        return psycopg.connect(get_database_url(), row_factory=dict_row)

    database_path = get_database_path()
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def _table_exists(connection: sqlite3.Connection, table: str) -> bool:
    return connection.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone() is not None


def _add_column_if_missing(connection: sqlite3.Connection, table: str, definition: str) -> None:
    if not _table_exists(connection, table):
        return
    column_name = definition.split()[0]
    existing_columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
    if column_name not in existing_columns:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")


def _ensure_admin_role_supported(connection: sqlite3.Connection) -> None:
    table = connection.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").fetchone()
    if not table or "'admin'" in (table["sql"] or ""):
        return
    connection.execute("ALTER TABLE users RENAME TO users_legacy")
    connection.execute(
        """
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE,
          username TEXT UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    connection.execute(
        """
        INSERT INTO users (id, name, email, username, password_hash, role, created_at)
        SELECT id, name, email, username, password_hash, role, created_at FROM users_legacy
        """
    )
    connection.execute("DROP TABLE users_legacy")


def _should_seed_demo_users() -> bool:
    configured = os.getenv("SEED_DEMO_USERS")
    if configured is not None:
        return configured.lower() in {"1", "true", "yes", "on"}
    return get_database_backend() == "sqlite"


def _seed_demo_users() -> None:
    if not _should_seed_demo_users():
        return

    users = (
        ("admin-demo", "Administrador Demo", "admin@demo.com", "admin", hash_password(os.getenv("DEMO_ADMIN_PASSWORD", "admin123")), "admin"),
        ("teacher-demo", "Profesor Demo", "profesor@demo.com", "profesor", hash_password(os.getenv("DEMO_TEACHER_PASSWORD", "profesor123")), "teacher"),
        ("student-demo", "Estudiante Demo", None, "estudiante", hash_password(os.getenv("DEMO_STUDENT_PASSWORD", "estudiante123")), "student"),
    )

    with get_connection() as connection:
        if get_database_backend() == "postgresql":
            connection.executemany(
                """
                INSERT INTO users (id, name, email, username, password_hash, role)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                users,
            )
        else:
            connection.executemany(
                """
                INSERT OR IGNORE INTO users (id, name, email, username, password_hash, role)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                users,
            )


def _initialize_sqlite_database() -> None:
    with get_connection() as connection:
        _ensure_admin_role_supported(connection)
        _add_column_if_missing(connection, "worksheets", "archived INTEGER NOT NULL DEFAULT 0")
        connection.executescript(SQLITE_SCHEMA_PATH.read_text(encoding="utf-8"))
        _add_column_if_missing(connection, "users", "username TEXT")
        _add_column_if_missing(connection, "worksheets", "max_attempts INTEGER")
        _add_column_if_missing(connection, "worksheets", "theme TEXT")
        _add_column_if_missing(connection, "worksheets", "archived INTEGER NOT NULL DEFAULT 0")
        _add_column_if_missing(connection, "worksheet_responses", "details_json TEXT NOT NULL DEFAULT '[]'")
        _add_column_if_missing(connection, "worksheet_responses", "correct_count INTEGER NOT NULL DEFAULT 0")
        _add_column_if_missing(connection, "worksheet_responses", "pending_count INTEGER NOT NULL DEFAULT 0")
        _add_column_if_missing(connection, "worksheet_responses", "guest_token TEXT")
        _add_column_if_missing(connection, "classrooms", "is_public INTEGER NOT NULL DEFAULT 0")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS guest_access_logs (
              id TEXT PRIMARY KEY,
              guest_token TEXT NOT NULL,
              name TEXT NOT NULL,
              classroom_id TEXT NOT NULL,
              classroom_name TEXT NOT NULL,
              accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS reader_access_logs (
              id TEXT PRIMARY KEY,
              reader_id TEXT NOT NULL,
              reader_name TEXT NOT NULL,
              accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute("UPDATE users SET username = 'admin' WHERE id = 'admin-demo' AND username IS NULL")
        connection.execute("UPDATE users SET username = 'profesor' WHERE id = 'teacher-demo' AND username IS NULL")
        connection.execute("UPDATE users SET username = 'estudiante' WHERE id = 'student-demo' AND username IS NULL")


def _initialize_postgresql_database() -> None:
    statements = [statement.strip() for statement in POSTGRES_SCHEMA_PATH.read_text(encoding="utf-8").split(";") if statement.strip()]
    with get_connection() as connection:
        for statement in statements:
            connection.execute(statement)


def initialize_database() -> None:
    if get_database_backend() == "postgresql":
        _initialize_postgresql_database()
    else:
        _initialize_sqlite_database()
    _seed_demo_users()
