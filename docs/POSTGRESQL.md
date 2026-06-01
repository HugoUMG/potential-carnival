# Estructura PostgreSQL y migración de datos

Este proyecto puede trabajar con SQLite para desarrollo local o con PostgreSQL para producción. El backend selecciona PostgreSQL automáticamente cuando existe la variable `DATABASE_URL`; si no existe, usa SQLite local.

## 1. Variables necesarias

```bash
DATABASE_URL=postgresql://usuario:password@host:5432/worksheet_builder
JWT_SECRET_KEY=un-secreto-largo-y-aleatorio
FRONTEND_ORIGINS=https://tu-frontend.onrender.com
SEED_DEMO_USERS=false
```

Para desarrollo local con Docker:

```bash
docker run --name worksheet-postgres \
  -e POSTGRES_USER=worksheet \
  -e POSTGRES_PASSWORD=worksheet \
  -e POSTGRES_DB=worksheet_builder \
  -p 5432:5432 \
  -d postgres:16

export DATABASE_URL="postgresql://worksheet:worksheet@localhost:5432/worksheet_builder"
export JWT_SECRET_KEY="dev-local-secret-change-me"
```

## 2. Inicializar la base

El backend inicializa la base al arrancar, pero también puedes ejecutar:

```bash
python scripts/init_db.py
```

Con `DATABASE_URL` configurada, el script aplica `db/schema.postgres.sql`.

## 3. Estructura SQL para PostgreSQL

El archivo canónico está en `db/schema.postgres.sql`:

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  username TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worksheets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  script_content TEXT NOT NULL,
  json_content JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  max_attempts INTEGER,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS worksheet_responses (
  id TEXT PRIMARY KEY,
  worksheet_id TEXT NOT NULL,
  student_id TEXT,
  student_name TEXT NOT NULL,
  answers_json JSONB NOT NULL,
  details_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  score DOUBLE PRECISION,
  correct_count INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (worksheet_id) REFERENCES worksheets(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_worksheets_created_by ON worksheets(created_by);
CREATE INDEX IF NOT EXISTS idx_worksheets_published ON worksheets(published);
CREATE INDEX IF NOT EXISTS idx_worksheets_archived ON worksheets(archived);
CREATE INDEX IF NOT EXISTS idx_responses_worksheet_id ON worksheet_responses(worksheet_id);
CREATE INDEX IF NOT EXISTS idx_responses_student_id ON worksheet_responses(student_id);
```

## 4. Migrar datos existentes desde SQLite

Si ya tienes datos en `data/worksheet_builder.db`, crea primero la estructura PostgreSQL y luego ejecuta una migración controlada. Ejemplo base:

```python
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SQLITE_PATH = PROJECT_ROOT / "data" / "worksheet_builder.db"
DATABASE_URL = os.environ["DATABASE_URL"]

sqlite = sqlite3.connect(SQLITE_PATH)
sqlite.row_factory = sqlite3.Row

with psycopg.connect(DATABASE_URL) as pg:
    for row in sqlite.execute("SELECT * FROM users"):
        pg.execute(
            """
            INSERT INTO users (id, name, email, username, password_hash, role, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              email = EXCLUDED.email,
              username = EXCLUDED.username,
              password_hash = EXCLUDED.password_hash,
              role = EXCLUDED.role
            """,
            (row["id"], row["name"], row["email"], row["username"], row["password_hash"], row["role"], row["created_at"]),
        )

    for row in sqlite.execute("SELECT * FROM worksheets"):
        pg.execute(
            """
            INSERT INTO worksheets (id, title, description, script_content, json_content, created_by, created_at, published, archived, max_attempts)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              description = EXCLUDED.description,
              script_content = EXCLUDED.script_content,
              json_content = EXCLUDED.json_content,
              published = EXCLUDED.published,
              archived = EXCLUDED.archived,
              max_attempts = EXCLUDED.max_attempts
            """,
            (
                row["id"],
                row["title"],
                row["description"],
                row["script_content"],
                Jsonb(json.loads(row["json_content"])),
                row["created_by"],
                row["created_at"],
                bool(row["published"]),
                bool(row["archived"]),
                row["max_attempts"],
            ),
        )

    for row in sqlite.execute("SELECT * FROM worksheet_responses"):
        pg.execute(
            """
            INSERT INTO worksheet_responses (id, worksheet_id, student_id, student_name, answers_json, details_json, score, correct_count, pending_count, submitted_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
              answers_json = EXCLUDED.answers_json,
              details_json = EXCLUDED.details_json,
              score = EXCLUDED.score,
              correct_count = EXCLUDED.correct_count,
              pending_count = EXCLUDED.pending_count
            """,
            (
                row["id"],
                row["worksheet_id"],
                row["student_id"],
                row["student_name"],
                Jsonb(json.loads(row["answers_json"])),
                Jsonb(json.loads(row["details_json"] or "[]")),
                row["score"],
                row["correct_count"],
                row["pending_count"],
                row["submitted_at"],
            ),
        )

sqlite.close()
```

## 5. Validación después de migrar

```bash
python scripts/init_db.py
uvicorn backend.app.main:app --reload
curl http://localhost:8000/health
```

Luego inicia sesión desde el frontend o prueba `/auth/login` con un usuario creado.
