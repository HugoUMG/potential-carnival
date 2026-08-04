# 04 — Base de datos

PostgreSQL en producción (**Aiven**, no Render). SQLite en desarrollo local. El backend elige según
exista o no `DATABASE_URL`.

| Entorno | Motor | Dónde |
|---------|-------|-------|
| Producción | PostgreSQL | Aiven (`DATABASE_URL`) |
| Desarrollo | SQLite | `data/worksheet_builder.db` |

Archivos canónicos: `db/schema.postgres.sql` y `db/schema.sql`. **Deben mantenerse en paralelo**: una
tabla que solo esté en uno revienta en el otro entorno (ya pasó con las tablas de vocabulario, que
faltaban en SQLite y hacían fallar `/vocabulary` en local con `no such table`).

---

## ⚠️ Regla crítica de migraciones

**La base está en producción con datos reales. NUNCA `DROP TABLE` ni `DROP COLUMN`.**

```sql
-- CORRECTO
CREATE TABLE IF NOT EXISTS nueva_tabla (...);
ALTER TABLE worksheets ADD COLUMN IF NOT EXISTS nueva_col JSONB;
CREATE INDEX IF NOT EXISTS ...;

-- PROHIBIDO
DROP TABLE worksheets;
ALTER TABLE users DROP COLUMN email;
```

`DROP INDEX IF EXISTS` sí se usa (los índices se reconstruyen; los datos no).

Las migraciones **son el propio schema**: todo es idempotente y se ejecuta en cada arranque
(`initialize_database()`). No hay Alembic ni versiones numeradas — se añade un `ALTER TABLE … IF NOT
EXISTS` al final del archivo. Ver [15_DECISIONS, ADR-04](15_DECISIONS.md).

---

## Tablas

```sql
-- Usuarios (todos los roles)
users (id, name, email, username, password_hash, role, created_at,
       created_by)   -- profesor que dio de alta al alumno; NULL = sin dueño (solo admin)
-- role CHECK IN ('admin','teacher','student','reader')

-- Hojas de trabajo
worksheets (id, title, description, script_content, json_content JSONB,
            created_by → users, created_at, published, archived,
            max_attempts, theme JSONB, ai_grading, ai_tolerance)
-- ai_tolerance: 0 estricto … 100 permisivo (default 50)

-- Respuestas de estudiantes e invitados
worksheet_responses (id, worksheet_id → worksheets, student_id → users,
                     student_name, answers_json JSONB, details_json JSONB,
                     score, correct_count, pending_count, submitted_at,
                     guest_token)

-- Aulas
classrooms (id, name, created_by → users, created_at, is_public BOOLEAN)

classroom_students   (classroom_id, student_id, assigned_at)              -- PK compuesta
classroom_worksheets (classroom_id, worksheet_id, assigned_at, due_date)  -- PK compuesta, due_date nullable

-- Sesiones
user_sessions (id, user_id → users, logged_in_at, logged_out_at)

-- Vocabulario
vocabulary_lists (id, title, description, created_by → users, created_at, items JSONB)
vocabulary_assignments        (list_id, classroom_id, assigned_at)  -- PK compuesta
vocabulary_reader_assignments (reader_id, list_id, assigned_at)     -- PK compuesta

-- Registros de acceso
guest_access_logs  (id, guest_token, name, classroom_id, classroom_name, accessed_at)
reader_access_logs (id, reader_id → users, reader_name, accessed_at)

-- Biblioteca de imágenes personal del profesor (coexiste con la gratuita, que es
-- src/data/image-library.json estático, no una tabla)
teacher_images (id, teacher_id → users, public_id, url, created_at)
```

### Convenciones

- **Ids: UUID v4** generados en Python, columna `TEXT`. Nunca autoincremento — así se pueden
  compartir por URL (`/w/:worksheetId`) sin ser adivinables, que es lo que sostiene el enlace directo.
- **JSON: `JSONB` en Postgres, `TEXT` en SQLite.** `repository._decode_json` normaliza la lectura.
- **Fechas: `TIMESTAMPTZ` en UTC.** SQLite las devuelve como texto; `_parse_datetime` /
  `_to_naive_utc` lo resuelven.
- **Booleanos:** `BOOLEAN` en Postgres, `INTEGER` (0/1) en SQLite. `is_public`, `published`,
  `archived`, `ai_grading`.
- `due_date` es nullable — no asumir que existe.
- Los `ON DELETE CASCADE` cuelgan de `classrooms`, `worksheets`, `users` y `vocabulary_lists`:
  borrar una hoja borra sus respuestas.

---

## Índices

```sql
-- Búsquedas por dueño y estado
idx_worksheets_created_by · idx_worksheets_published · idx_worksheets_archived
idx_classrooms_created_by · idx_users_created_by
idx_vocabulary_lists_created_by · idx_vocabulary_assignments_classroom_id · idx_vocab_reader_list_id

-- Respuestas
idx_responses_worksheet_id · idx_responses_student_id
idx_responses_worksheet_student           -- NO único (ver abajo)

-- Un invitado, un envío por hoja
CREATE UNIQUE INDEX idx_responses_guest_attempt
ON worksheet_responses (worksheet_id, guest_token) WHERE guest_token IS NOT NULL;

-- Sesiones y logs
idx_sessions_user_id · idx_sessions_logged_in
idx_guest_access_logs_token · idx_guest_access_logs_at
idx_reader_access_logs_reader · idx_reader_access_logs_at

-- Imágenes del profesor
idx_teacher_images_teacher_id
```

> **Ojo con el histórico:** existió un `UNIQUE INDEX idx_responses_unique_attempt (worksheet_id,
> student_id)` que impedía más de una respuesta por alumno y **rompía `max_attempts` > 1 e
> ilimitada**. El schema lo elimina (`DROP INDEX IF EXISTS`) y lo sustituye por uno no único. Los
> intentos se cuentan **por filas** y el doble envío accidental se evita en la app (bloqueo de 5 s +
> conteo + 409). El índice único de invitados **sí** sigue vivo.

---

## Aislamiento de alumnos por profesor (`users.created_by`)

`GET /students` filtra por dueño y `require_student_manager` bloquea con 403 editar, borrar o cambiar
la contraseña de un alumno ajeno. Las aulas ya estaban aisladas por `created_by`.

**Aislamiento total: no hay excepción para `created_by IS NULL`.** Un alumno sin dueño no lo ve ni lo
administra ningún profesor — solo el admin (falla en cerrado).

El backfill de los alumnos heredados corre **dentro de la propia migración de arranque**, en el mismo
arranque que crea la columna: se les asigna el **profesor más antiguo**. Así no hay ventana entre
desplegar y acordarse de correr un script. Sin ningún profesor en la base, se quedan en `NULL`.

`scripts/backfill_student_owner.py` sigue existiendo como red de seguridad para reasignar a mano
(dry-run por defecto; `--owner @usuario --apply` para escribir). Cubierto por
`backend/tests/test_student_isolation.py`.

---

## Conexiones y pool

`database.get_connection()` entrega conexiones de un **pool caliente** de `psycopg_pool` en vez de
abrir una nueva por consulta (antes ~74 call sites hacían handshake TCP/TLS/auth por query, mucha
carga para Aiven). `min_size=1`, `max_size` = `DB_POOL_MAX` (default **5**, prudente por el límite de
Aiven). Los `with get_connection() as conn:` existentes no cambiaron. SQLite no usa pool.

---

## Desarrollo local

```bash
python scripts/init_db.py     # crea/migra data/worksheet_builder.db y siembra usuarios demo
```

Con `DATABASE_URL` definida, el mismo script aplica `db/schema.postgres.sql`.

### Postgres local con Docker (opcional)

```bash
docker run --name worksheet-postgres \
  -e POSTGRES_USER=worksheet -e POSTGRES_PASSWORD=worksheet \
  -e POSTGRES_DB=worksheet_builder -p 5432:5432 -d postgres:16

export DATABASE_URL="postgresql://worksheet:worksheet@localhost:5432/worksheet_builder"
export JWT_SECRET_KEY="dev-local-secret-change-me"
```

> ⚠️ Importar `backend.app` carga el `.env` real. Si ese `.env` apunta a Aiven, **cualquier escritura
> desde un script o un test va a producción**; quitar `DATABASE_URL` del entorno del proceso no basta
> porque `_load_dotenv()` la repone. Usa un `.env` distinto o `monkeypatch` del path.

---

## Respaldos

`.github/workflows/backup.yml` corre `scripts/backup_db.py` cada lunes a las 06:00 UTC (y a mano
desde la pestaña Actions), vuelca la base a JSON y lo sube como artifact con 90 días de retención.
Necesita el secreto `AIVEN_DATABASE_URL`.

Para migrar datos de SQLite a Postgres puntualmente hay un ejemplo de script en el historial de
`docs/POSTGRESQL.md` (git) y `scripts/migrate_to_aiven.py` para el caso Render → Aiven.
