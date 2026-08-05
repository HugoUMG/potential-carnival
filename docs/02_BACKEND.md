# 02 — Backend (Python / FastAPI)

Lista de endpoints en [05_API](05_API.md). Aquí va la estructura, las convenciones y dónde vive cada
responsabilidad.

## Estructura

| Archivo | Líneas aprox. | Responsabilidad |
|---------|---------------|-----------------|
| `main.py` | 1300 | Todos los endpoints, dependencias de auth y calificación exacta |
| `repository.py` | 1300 | Todas las queries SQL (`WorksheetRepository`) |
| `database.py` | 225 | Conexión, pool de Postgres, migración de arranque, seed demo |
| `ai.py` | 900 | Gemini/Groq: generación, calificación, resumen, vocabulario, Whisper |
| `parser.py` | 550 | DSL → `WorksheetData` + validación (`SUPPORTED_BLOCKS`) |
| `models.py` | 320 | Modelos Pydantic = contrato HTTP |
| `security.py` | 79 | JWT (HS256) y hashing PBKDF2-SHA256 |
| `domain.py` | 68 | Dataclasses internas: `ActivityData`, `BlockData`, `WorksheetData` |
| `settings.py` | 42 | Carga de `.env` y orígenes CORS |
| `__init__.py` | 10 | Llama a `_load_dotenv()` **al importar el paquete** |

No hay `routers/` ni `services/`: la app es un solo `FastAPI()` en `main.py` con **83 rutas**. No fue
una decisión de diseño: creció por fases (alumnos registrados primero, invitados después) y cada una
añadió sus rutas al final del mismo módulo. Ver [15_DECISIONS, ADR-12](15_DECISIONS.md), que además
dice cuál sería el primer corte sensato si algún día se parte.

## Dependencias

```
fastapi · uvicorn[standard] · pydantic>=2.8
python-jose[cryptography]      JWT
psycopg[binary] · psycopg_pool PostgreSQL
edge-tts                       TTS
httpx                          Gemini, Groq y validación del ID token de Google
python-multipart               subida de audio (speaking)
pytest
```

**No hay ORM y no hay `python-dotenv`**: SQL a mano y un parser de `.env` de seis líneas en
`settings.py`. Antes de añadir una dependencia, ver [12_RULES](12_RULES.md).

## Arranque

```python
# backend/app/__init__.py
_load_dotenv()   # ANTES de cualquier import que lea el entorno
```

Se carga en `__init__` porque hay constantes que se leen del entorno **al importar** (el modelo de
Gemini arma su URL en tiempo de import). Las variables ya presentes en el entorno **ganan**, así que
en Render no cambia nada.

> ⚠️ Importar `backend.app` en un script o un test **carga el `.env` de verdad**: si ese `.env`
> apunta a Aiven, cualquier escritura va a producción. Borrar `DATABASE_URL` del entorno del proceso
> no basta. (memoria `env-loading-hits-production`)

```python
@app.on_event("startup")
def startup(): initialize_database()
```

`initialize_database()` aplica el schema y las migraciones idempotentes. Ver
[04_DATABASE](04_DATABASE.md).

## Autenticación y permisos

Dependencias FastAPI en `main.py`, todas devuelven `PublicUser`:

| Dependencia | Qué exige |
|-------------|-----------|
| `get_current_user` | JWT válido |
| `require_teacher_or_admin` | rol `teacher` o `admin` |
| `require_admin` | rol `admin` |
| `require_student` | rol `student` |

Y comprobaciones de propiedad, que lanzan 403/404:

| Función | Regla |
|---------|-------|
| `require_student_owner_or_staff(student_id, user)` | El propio alumno o un profesor/admin |
| `require_student_manager(student_id, user)` | Solo el profesor que creó al alumno (`users.created_by`) o el admin |
| `require_worksheet_manager(worksheet_id, user)` | Solo el dueño de la hoja o el admin |
| `require_classroom_manager(classroom_id, user)` | Solo el dueño del aula o el admin |

**Todo endpoint nuevo lleva una de estas dependencias.** Las excepciones son las rutas `/public/*`,
que existen a propósito sin JWT para el modo invitado y el enlace directo.

Cuando una ruta **ramifica por rol** dentro del cuerpo (`PUT /users/{id}` y su `/password`), el rol no
contemplado tiene que salir por **403 explícito**, no por el final de la función: con una cadena
`if … elif …` sin cierre, un rol nuevo hereda permiso total en silencio. Pasó con `reader` (ADR-23).

Y para los `/public/*` que gastan CPU o cuota de una API externa:

| Función | Regla |
|---------|-------|
| `_rate_limit(request, limit, window=60)` | Ventana deslizante por IP; lanza **429** al pasarse |
| `_client_ip(request)` | IP real: entrada más a la **derecha** del `X-Forwarded-For` |

Detalle y números en [09_SECURITY](09_SECURITY.md#topes-en-los-endpoints-públicos); el porqué, en
[ADR-23](15_DECISIONS.md).

## Calificación (en `main.py`)

| Función | Qué hace |
|---------|----------|
| `_build_answer_details(worksheet, answers)` | Recorre las actividades **leyendo la clave de `worksheet.json_content`** (no de lo que manda el cliente) y produce un `AnswerDetail` por unidad de puntaje |
| `_score_details(details)` | `score = correct / (correct + incorrect) * 100`; los `pending` no entran en el denominador |
| `_norm_answer(v)` | `strip` + `lower` + quita comillas residuales |
| `_resolve_correct_answers(answer)` | Normaliza `answer` string o lista a lista |
| `_speaking_match(said, target)` | Similitud por subsecuencia común (LCS→Dice) ≥ 0.85 |

Unidades de puntaje: una actividad puede generar varias (`truefalse` → una por enunciado,
`matching`/`listeningmatching` → una por par, `reading` → una por pregunta). El id compuesto es
`f"{activity_id}:{index}"`. `content` no genera ninguna (`continue`). Tabla completa en
[07_DSL §7](07_DSL.md#7-calificación-automática).

Después, si `worksheets.ai_grading` está activo, `ai.ai_grade_activities(details, título, tolerancia)`
revisa el resultado — ver [06_AI](06_AI.md).

## Convenciones

- **Respuestas tipadas**: cada endpoint declara `response_model`. El contrato es `models.py`.
- **Errores**: `HTTPException` con mensaje en español. Códigos usados: 400 (DSL inválido, datos mal),
  401, 403, 404, 409 (doble envío, editar una hoja con respuestas), 503 (falta una API key).
- **Ids**: UUID v4 generado en Python, columna `TEXT`. Nunca autoincremento.
- **Fechas**: se guardan en UTC; `repository._to_naive_utc` normaliza lo que vuelve de la BD porque
  SQLite devuelve texto y Postgres `TIMESTAMPTZ`.
- **Nada de SQL fuera de `repository.py`.**
- **Sin `executemany` sobre la conexión de psycopg**: no existe en la conexión (solo en el cursor);
  hay un test que lo fija (`test_psycopg_no_expone_executemany_en_la_conexion`).
- El parser **valida y lanza** `WorksheetScriptError`; `main.py` la traduce a 400 con el número de
  actividad y el motivo.

## Rendimiento

La lentitud percibida viene de la **latencia de la base** (Aiven), no de un cold start: un monitor de
UptimeRobot mantiene el servicio despierto. Al optimizar, mirar carga de BD:

- **Pool de conexiones** (`database._get_pool`, `psycopg_pool`): `get_connection()` entrega
  conexiones de un pool caliente en vez de abrir una nueva por consulta. `min_size=1`,
  `max_size` = `DB_POOL_MAX` (default 5, prudente por el límite de Aiven). SQLite no usa pool.
- **`teacher_dashboard`**: filtra las respuestas en SQL (`list_responses(worksheet_ids=…)`) y cuenta
  alumnos por aula en una sola query (`count_students_per_classroom`). Antes leía la tabla entera y
  hacía N+1.
- **`/public/readers-vocabulary`**: `list_all_readers_vocabulary()` trae todo en un JOIN.

Pendiente: caché de lecturas públicas, co-ubicar región Render↔Aiven, revisar más N+1.

## Scripts

| Script | Para qué |
|--------|----------|
| `scripts/init_db.py` | Crea/migra la base a mano (SQLite o Postgres según `DATABASE_URL`) |
| `scripts/backfill_student_owner.py` | Reasigna alumnos huérfanos a un profesor (dry-run por defecto; `--owner @usuario --apply`) |
| `scripts/backup_db.py` | Respaldo a JSON — lo ejecuta el workflow semanal de GitHub Actions |
| `scripts/migrate_to_aiven.py` | Migración puntual Render → Aiven |
