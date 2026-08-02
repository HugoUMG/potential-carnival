# 10 — Despliegue y entorno

## Desarrollo local

### Requisitos

Node.js LTS · Python 3.12 · (opcional) Docker para Postgres local.

### Backend

```bash
python -m venv .venv
```

```bash
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
# macOS / Linux
source .venv/bin/activate
```

```bash
pip install -r backend/requirements.txt
python scripts/init_db.py
uvicorn backend.app.main:app --reload
```

API en `http://localhost:8000`, documentación automática en `http://localhost:8000/docs`.

### Frontend

```bash
npm install
npm run dev
```

En `http://localhost:5173`.

### Scripts de npm

| Comando | Qué hace |
|---------|----------|
| `npm run dev` | Vite en `0.0.0.0` (accesible desde el móvil de la misma red) |
| `npm run build` | `tsc -b && vite build` |
| `npm run preview` | Sirve el build |
| `npm run lint` | ESLint 9, `--max-warnings 0` |
| `npm run backend:test` | `python -m pytest backend/tests` |

Sin `DATABASE_URL` el backend usa SQLite en `data/worksheet_builder.db`. Con ella, PostgreSQL.

> ⚠️ El backend lee el `.env` del proyecto al importar `backend.app`. Si ese `.env` apunta a Aiven,
> **un script o un test escribe en producción**; quitar `DATABASE_URL` del entorno no basta.

## Variables de entorno

### Backend

| Variable | Obligatoria | Valor / efecto |
|----------|-------------|----------------|
| `DATABASE_URL` | En producción | PostgreSQL (Aiven). Sin ella → SQLite local |
| `JWT_SECRET_KEY` | Sí | Clave de firma HS256 |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | No | Default 480 (8 h) |
| `FRONTEND_ORIGINS` | Sí | CORS, separado por comas. `https://constructor-hojas-web.onrender.com` |
| `GOOGLE_CLIENT_ID` | Sí | Client ID de OAuth (Web). **Sin ella `/auth/google` responde 503** |
| `GEMINI_API_KEY` | No | Gemini para generar y calificar |
| `GROQ_API_KEY` | No | Fallback de IA **y transcripción Whisper** de `speaking` |
| `GEMINI_MODEL` | No | Default `gemini-3.1-flash-lite` |
| `DB_POOL_MAX` | No | Tamaño máximo del pool de Postgres (default 5) |
| `SEED_DEMO_USERS` | — | `false` en producción |

### Frontend (build time)

| Variable | Valor |
|----------|-------|
| `VITE_API_URL` | `https://constructor-hojas-api.onrender.com` |
| `VITE_GOOGLE_CLIENT_ID` | El **mismo** Client ID que el backend. Sin ella el botón de Google no se pinta |

`VITE_*` se inyecta **en el build**: si cambia, hay que redesplegar el frontend.

## Producción

```
Render.com
├── constructor-hojas-api   Web Service (Python)   ← backend FastAPI
└── constructor-hojas-web   Static Site            ← frontend Vite

Aiven
└── PostgreSQL                                     ← la base real
```

`render.yaml` es el blueprint. El servicio de base de datos que declara (`constructor-hojas-db`) es
histórico: **la base de producción está en Aiven**, y `DATABASE_URL` apunta allí.

```bash
uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT
```

El frontend se sirve como estático con un rewrite `/*` → `/index.html` (SPA).

### Orden de despliegue

1. Repo en GitHub.
2. En Render, crear el Blueprint desde `render.yaml`.
3. Completar `FRONTEND_ORIGINS` en el backend con la URL final del frontend.
4. Completar `VITE_API_URL` y `VITE_GOOGLE_CLIENT_ID` en el frontend.
5. Desplegar el backend y verificar `/health`.
6. Redesplegar el frontend para que Vite inyecte las `VITE_*`.

### Notas de infraestructura

- **El backend no se apaga**: un monitor de **UptimeRobot** lo mantiene despierto pegándole a
  `/health`. No hay cold start de 15 minutos.
- **La lentitud percibida es la base**, no el arranque: Aiven añade unos segundos en la primera
  consulta. Por eso toda pantalla que dependa de la primera query muestra spinner. Al optimizar,
  atacar carga de BD (pool, N+1, caché), no el arranque del servicio.
- Pendiente de infraestructura: co-ubicar la región de Render con la de Aiven.

### Checklist antes de producción

- `FRONTEND_ORIGINS` y `VITE_API_URL` con los dominios reales.
- `JWT_SECRET_KEY` largo, aleatorio y privado.
- `SEED_DEMO_USERS=false`.
- `GOOGLE_CLIENT_ID` presente en backend y frontend, y el origen del frontend listado en Google Cloud
  Console.
- Respaldos activos (ver abajo).

## Respaldos

`.github/workflows/backup.yml` — cada lunes 06:00 UTC (y a mano desde Actions): ejecuta
`scripts/backup_db.py` contra el secreto `AIVEN_DATABASE_URL` y sube el JSON como artifact con 90
días de retención.

## Docker

No hay `Dockerfile`: Render construye directamente desde el repo (`pip install` / `npm run build`).
Docker solo aparece como opción para levantar un Postgres local — ver
[04_DATABASE](04_DATABASE.md#postgres-local-con-docker-opcional).
