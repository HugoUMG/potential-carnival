# 01 — Arquitectura

Cómo encajan las piezas. Sin detalles de implementación (esos van en `02`–`09`).

## Vista general

```
┌─────────────────────────────┐        HTTP/JSON        ┌──────────────────────────────┐
│  Frontend (React 19 + Vite) │ ──────────────────────► │  Backend (FastAPI, Python)   │
│  Static Site en Render      │ ◄────────────────────── │  Web Service en Render       │
└─────────────────────────────┘   JWT Bearer o /public  └──────────────┬───────────────┘
        │                                                              │
        │ Google Identity Services (ID token)                          │ psycopg + pool
        ▼                                                              ▼
   accounts.google.com                                        PostgreSQL (Aiven)
                                                              SQLite (desarrollo)
                                                                       │
                                          edge-tts (TTS) ──────────────┤
                                          Gemini / Groq (IA) ──────────┤
                                          Groq Whisper (speaking) ─────┘
```

No hay servidor de sesiones ni caché: **el estado vive en la base de datos**. El frontend guarda el
JWT en `localStorage` y nada más (salvo el tema y el contador de intentos del enlace directo).

## Backend

Monolito FastAPI de un solo módulo de rutas (`main.py`), con capas explícitas:

```
main.py        Endpoints + auth + calificación exacta   (HTTP, validación, permisos)
   │
   ├── parser.py      DSL → WorksheetData        (texto del profesor)
   ├── ai.py          Gemini/Groq/Whisper        (generación, calificación, transcripción)
   ├── models.py      Pydantic (contrato HTTP)
   ├── domain.py      Dataclasses internas
   │
repository.py  Todas las queries SQL             (patrón Repository)
   │
database.py    Conexión, pool y migración de arranque
```

Regla: **`main.py` no escribe SQL** y `repository.py` no sabe de HTTP.

## Frontend

SPA con `react-router-dom`. Un único componente grande (`App.tsx`) sirve los tres portales
autenticados (profesor / admin / alumno) y las páginas sueltas viven en `src/pages/`.

```
main.tsx           Rutas + initTheme() antes del primer render
  ├── SiteLayout   Sitio público (/, /acerca, /actividades, /aprende)
  ├── LoginPage / RegisterPage
  ├── App.tsx      Portales /teacher/:section, /admin/:section, /student/:section
  ├── ReaderPortal, VocabPublicPage, VocabDirectPage
  ├── GuestPage, DirectWorksheetPage
  └── services/api.ts   Cliente HTTP único (JWT desde localStorage)
```

Las **secciones del portal son rutas**, no estado: la pestaña activa se deriva de `useParams`.

## Comunicación

- Todo pasa por `src/services/api.ts`. Ningún componente hace `fetch` por su cuenta.
- El JWT viaja en `Authorization: Bearer`. Los endpoints `/public/*` **no llevan JWT**: los usan el
  modo invitado y el enlace directo.
- CORS se controla con `FRONTEND_ORIGINS`.
- El audio no viaja como archivo: el navegador pide `GET /tts?text=…` y recibe un `audio/mpeg` en
  streaming.

## Flujo de una hoja, de punta a punta

```
Profesor escribe DSL (o lo genera la IA)
        │
        ▼  POST /worksheets
  parser.parse_worksheet_script()  ──► WorksheetScriptError si algo quedaría sin responder
        │
        ▼
  worksheets.script_content (texto original) + worksheets.json_content (JSONB parseado)
        │
        ▼  GET /worksheets/{id} · /public/worksheets/{id} · /students/{id}/worksheets
  WorksheetRenderer.tsx → activityRegistry.tsx (un componente por tipo)
        │
        ▼  POST /responses  ó  POST /public/responses
  _build_answer_details()   calificación exacta, leyendo la clave DE LA BD (no del cliente)
        │
        ▼  si worksheets.ai_grading
  ai.ai_grade_activities()  rescata incorrectos y resuelve los pending
        │
        ▼
  _score_details() → score, correct_count, pending_count → worksheet_responses
```

Detalle importante: **la calificación nunca confía en el cliente**. `_build_answer_details` relee
`json_content` desde la base. Por eso el plan de [fuga de respuestas](plans/PLAN-fuga-de-respuestas.md)
es viable sin tocar la corrección.

## Organización de carpetas

```
potential-carnival/
├── backend/
│   ├── app/
│   │   ├── main.py        Endpoints FastAPI, auth y calificación exacta
│   │   ├── repository.py  Queries a la BD (patrón Repository)
│   │   ├── database.py    Conexión, pool y migración de arranque
│   │   ├── models.py      Modelos Pydantic (contrato de la API)
│   │   ├── domain.py      Dataclasses internas (ActivityData, BlockData, WorksheetData)
│   │   ├── parser.py      Parser del DSL → WorksheetData (SUPPORTED_BLOCKS)
│   │   ├── ai.py          Gemini/Groq: generación, calificación, resumen, Whisper
│   │   ├── security.py    JWT y hashing PBKDF2-SHA256
│   │   └── settings.py    Lectura de .env y orígenes CORS
│   ├── tests/             pytest
│   └── requirements.txt
├── src/
│   ├── App.tsx            Portales profesor/admin/alumno (incluye revisión de respuestas)
│   ├── main.tsx           Rutas
│   ├── pages/             Páginas sueltas y sitio público
│   ├── components/        Renderer, editor, constructor visual, impresión, etc.
│   ├── services/api.ts    Cliente HTTP centralizado
│   ├── utils/             theme, sfx, dslSerializer, generationPrompt, voicePreference
│   ├── styles/app.css     Tailwind + bloque de modo oscuro
│   └── types.ts
├── db/
│   ├── schema.postgres.sql   Producción
│   └── schema.sql            SQLite (desarrollo) — debe mantenerse en paralelo
├── scripts/               init_db, backfill, backup, migración, capturas
├── docs/                  Esta documentación
├── public/                Assets estáticos
├── render.yaml            Blueprint de Render
└── package.json
```

## Decisiones estructurales

El *por qué* de esta arquitectura (monolito, DSL propio, calificación server-side, dos bases de
datos, modo oscuro por CSS…) está en [15_DECISIONS](15_DECISIONS.md).
