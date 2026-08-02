# MyDinoEnglish (`potential-carnival`) — índice para Claude Code

Plataforma web educativa para clases de inglés: el profesor crea hojas de trabajo interactivas (a
mano, con un constructor visual o con IA), las asigna a sus aulas y revisa las respuestas.
React 19 + Vite · FastAPI · PostgreSQL (Aiven) · Render.

**La documentación vive en [`docs/`](docs/), organizada por dominio. Este archivo es solo el índice.**

## Lee primero (siempre)

1. [`docs/00_OVERVIEW.md`](docs/00_OVERVIEW.md) — qué es y en qué estado está
2. [`docs/01_ARCHITECTURE.md`](docs/01_ARCHITECTURE.md) — cómo encajan las piezas
3. [`docs/12_RULES.md`](docs/12_RULES.md) — **reglas duras, no negociables**

Luego carga **solo** el documento del dominio que toque la tarea. No cargues `docs/` entero:
`07_DSL.md` son ~2500 líneas por sí solo.

| La tarea toca… | Abre |
|----------------|------|
| Endpoints, permisos, calificación | [`02_BACKEND`](docs/02_BACKEND.md) · [`05_API`](docs/05_API.md) |
| React, portales, editor | [`03_FRONTEND`](docs/03_FRONTEND.md) |
| Tablas, queries, migraciones | [`04_DATABASE`](docs/04_DATABASE.md) |
| Prompts, generación o calificación por IA | [`06_AI`](docs/06_AI.md) |
| Sintaxis del DSL, parser, tipos de actividad | [`07_DSL`](docs/07_DSL.md) |
| Cómo se pinta y se resuelve una actividad | [`08_RENDERER`](docs/08_RENDERER.md) |
| Auth, roles, JWT, Google | [`09_SECURITY`](docs/09_SECURITY.md) |
| Variables, Render, arranque local | [`10_DEPLOYMENT`](docs/10_DEPLOYMENT.md) |
| Tests | [`11_TESTING`](docs/11_TESTING.md) |
| Qué falta o está en curso | [`13_ROADMAP`](docs/13_ROADMAP.md) |
| Un término desconocido | [`14_GLOSSARY`](docs/14_GLOSSARY.md) |
| "¿Por qué está hecho así?" antes de proponer un cambio | [`15_DECISIONS`](docs/15_DECISIONS.md) |

Instrucciones de trabajo para agentes: [`docs/agents/AGENT.md`](docs/agents/AGENT.md) (neutral) y
[`docs/agents/CLAUDE.md`](docs/agents/CLAUDE.md) (específico de Claude Code).

## Cuatro reglas que no se pueden perder de vista

1. **NUNCA `DROP TABLE` ni `DROP COLUMN`.** La base está en producción con datos reales; toda
   migración es idempotente (`IF NOT EXISTS`).
2. **Importar `backend.app` carga el `.env` real.** Si apunta a Aiven, cualquier escritura desde un
   script o un test va a **producción**. Borrar `DATABASE_URL` del entorno no basta.
3. **Un campo o tipo de actividad nuevo se recorre entero** (parser → domain → models → types.ts →
   api.ts → renderer → serializador visual → docs → test) o se pierde **en silencio**.
4. **Al pedir el usuario una hoja de trabajo: solo el DSL en el chat**, sin crear un archivo aparte.

## Verificación

```bash
python -m pytest backend/tests
```

```bash
npm run lint
```

```bash
npm run build
```
