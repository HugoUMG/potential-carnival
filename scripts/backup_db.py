r"""Respaldo y restauración de la base de datos PostgreSQL (Aiven) sin pg_dump.

Vuelca todas las tablas a un JSON con marca de tiempo en backups/, o restaura
desde uno de esos archivos.

Backup (PowerShell):
    $env:DATABASE_URL="<Service URI de Aiven>"
    .venv\Scripts\python.exe scripts\backup_db.py

Restaurar a una base (¡cuidado!):
    $env:DATABASE_URL="<URI destino>"
    .venv\Scripts\python.exe scripts\backup_db.py restore backups\backup_YYYYMMDD_HHMMSS.json
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

URL = os.getenv("DATABASE_URL") or os.getenv("BACKUP_DATABASE_URL")

# Orden seguro respecto a llaves foráneas (para restaurar).
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

ROOT = Path(__file__).resolve().parent.parent
BACKUP_DIR = ROOT / "backups"
SCHEMA_PATH = ROOT / "db" / "schema.postgres.sql"


def backup() -> None:
    BACKUP_DIR.mkdir(exist_ok=True)
    data: dict[str, dict] = {}
    with psycopg.connect(URL) as conn:
        for table in TABLES:
            with conn.cursor() as cur:
                cur.execute(f"SELECT * FROM {table}")
                cols = [d.name for d in cur.description]
                rows = [list(r) for r in cur.fetchall()]
            data[table] = {"columns": cols, "rows": rows}
            print(f"  {table}: {len(rows)} filas")
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = BACKUP_DIR / f"backup_{stamp}.json"
    # default=str convierte fechas a ISO; los jsonb ya son dict/list serializables.
    out.write_text(json.dumps(data, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"\n✓ Respaldo guardado: {out}")


def _ensure_schema(conn: psycopg.Connection) -> None:
    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        for statement in (s.strip() for s in sql.split(";") if s.strip()):
            cur.execute(statement)
    conn.commit()


def restore(path: str) -> None:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    with psycopg.connect(URL) as conn:
        _ensure_schema(conn)
        for table in TABLES:
            block = data.get(table)
            if not block or not block["rows"]:
                continue
            with conn.cursor() as cur:
                cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = %s", (table,))
                destcols = {r[0] for r in cur.fetchall()}
            srccols = block["columns"]
            cols = [c for c in srccols if c in destcols]
            idxs = [srccols.index(c) for c in cols]
            insert = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) ON CONFLICT DO NOTHING"
            with conn.cursor() as cur:
                for row in block["rows"]:
                    values = [Jsonb(row[i]) if isinstance(row[i], (dict, list)) else row[i] for i in idxs]
                    cur.execute(insert, values)
            conn.commit()
            print(f"  {table}: {len(block['rows'])} filas restauradas")
    print("\n✓ Restauración terminada.")


def main() -> None:
    if not URL:
        sys.exit("Define DATABASE_URL (o BACKUP_DATABASE_URL) antes de correr.")
    if len(sys.argv) >= 3 and sys.argv[1] == "restore":
        restore(sys.argv[2])
    else:
        backup()


if __name__ == "__main__":
    main()
