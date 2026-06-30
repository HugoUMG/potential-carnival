r"""Migra los datos de PostgreSQL (Render) a otro PostgreSQL (Aiven), tabla por tabla.

No borra nada en el origen. Es idempotente (ON CONFLICT DO NOTHING), así que puedes
correrlo varias veces sin duplicar.

Uso (PowerShell):
    $env:SOURCE_DATABASE_URL="<URL externa de Render>"
    $env:DEST_DATABASE_URL="<Service URI de Aiven, con ?sslmode=require>"
    .venv\Scripts\python.exe scripts\migrate_to_aiven.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

SRC = os.getenv("SOURCE_DATABASE_URL")
DST = os.getenv("DEST_DATABASE_URL")

# Orden seguro respecto a llaves foráneas (padres antes que hijos).
TABLES = [
    "users",
    "classrooms",
    "worksheets",
    "worksheet_responses",
    "classroom_students",
    "classroom_worksheets",
    "user_sessions",
    "vocabulary_lists",
    "vocabulary_assignments",
    "vocabulary_reader_assignments",
    "guest_access_logs",
    "reader_access_logs",
]

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "db" / "schema.postgres.sql"


def ensure_schema(conn: psycopg.Connection) -> None:
    """Crea el esquema en el destino (idempotente: todo es IF NOT EXISTS)."""
    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        for statement in (s.strip() for s in sql.split(";") if s.strip()):
            cur.execute(statement)
    conn.commit()


def _dest_columns(dst: psycopg.Connection, table: str) -> set[str]:
    with dst.cursor() as cur:
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = %s", (table,))
        return {r[0] for r in cur.fetchall()}


def copy_table(src: psycopg.Connection, dst: psycopg.Connection, table: str) -> int:
    destcols = _dest_columns(dst, table)
    with src.cursor() as cur:
        cur.execute(f"SELECT * FROM {table}")
        srccols = [d.name for d in cur.description]
        rows = cur.fetchall()
    if not rows:
        print(f"  {table}: 0 filas")
        return 0
    # Solo columnas presentes en AMBAS bases (ignora columnas viejas como 'group_id').
    cols = [c for c in srccols if c in destcols]
    idxs = [srccols.index(c) for c in cols]
    skipped = [c for c in srccols if c not in destcols]
    collist = ", ".join(cols)
    placeholders = ", ".join(["%s"] * len(cols))
    insert = f"INSERT INTO {table} ({collist}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"
    with dst.cursor() as cur:
        for row in rows:
            values = [Jsonb(row[i]) if isinstance(row[i], (dict, list)) else row[i] for i in idxs]
            cur.execute(insert, values)
    dst.commit()
    extra = f" (ignoradas: {', '.join(skipped)})" if skipped else ""
    print(f"  {table}: {len(rows)} filas{extra}")
    return len(rows)


def main() -> None:
    if not SRC or not DST:
        sys.exit("Define SOURCE_DATABASE_URL (Render) y DEST_DATABASE_URL (Aiven) antes de correr.")
    with psycopg.connect(SRC) as src, psycopg.connect(DST) as dst:
        print("→ Asegurando el esquema en Aiven…")
        ensure_schema(dst)
        print("→ Copiando datos (Render → Aiven):")
        total = sum(copy_table(src, dst, table) for table in TABLES)
        print(f"\n✓ Migración terminada. {total} filas copiadas en total.")
        print("  Verifica la app apuntando DATABASE_URL a Aiven antes de dar de baja Render.")


if __name__ == "__main__":
    main()
