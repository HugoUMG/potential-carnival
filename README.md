# MyDinoEnglish — constructor de hojas de trabajo

Plataforma web educativa para clases de inglés. El **profesor** crea hojas de trabajo interactivas —a
mano, con un constructor visual o generándolas con IA—, las asigna a sus aulas y revisa las
respuestas. El **alumno** las resuelve desde su portal, desde un enlace directo o como invitado sin
cuenta.

- **19 tipos de actividad**: gramática, lectura, comprensión auditiva, producción oral y escritura
  abierta.
- **Audio sintetizado** con TTS: no hay que grabar ni subir archivos.
- **Calificación automática** de lo cerrado + **calificación por IA** de lo abierto, con comentario
  en español.
- **Compartir sin fricción**: un enlace por hoja, sin login para el alumno.

React 19 + Vite + TypeScript · FastAPI · PostgreSQL / SQLite · Render + Aiven.

---

## Documentación

**Toda la documentación técnica está en [`docs/`](docs/), organizada por dominio.**
Empieza por **[`docs/00_OVERVIEW.md`](docs/00_OVERVIEW.md)**.

| | |
|---|---|
| [00 Overview](docs/00_OVERVIEW.md) | Qué es, estado, módulos |
| [01 Architecture](docs/01_ARCHITECTURE.md) | Cómo encajan las piezas |
| [02 Backend](docs/02_BACKEND.md) · [05 API](docs/05_API.md) | FastAPI, endpoints, permisos |
| [03 Frontend](docs/03_FRONTEND.md) · [08 Renderer](docs/08_RENDERER.md) | React, portales, actividades |
| [04 Database](docs/04_DATABASE.md) | Tablas, índices, migraciones |
| [06 AI](docs/06_AI.md) | Proveedores, prompts, calificación |
| [07 DSL](docs/07_DSL.md) | El lenguaje de las hojas — referencia completa |
| [09 Security](docs/09_SECURITY.md) · [10 Deployment](docs/10_DEPLOYMENT.md) · [11 Testing](docs/11_TESTING.md) | |
| [12 Rules](docs/12_RULES.md) | Reglas del proyecto |
| [13 Roadmap](docs/13_ROADMAP.md) · [14 Glossary](docs/14_GLOSSARY.md) · [15 Decisions](docs/15_DECISIONS.md) | |
| [docs/agents/](docs/agents/) | Instrucciones para agentes de IA |

---

## Arranque local

Requisitos: **Node.js LTS** y **Python 3.12**.

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

API en `http://localhost:8000`, documentación OpenAPI en `http://localhost:8000/docs`.

### Frontend

```bash
npm install
npm run dev
```

En `http://localhost:5173`.

Sin `DATABASE_URL` el backend usa SQLite (`data/worksheet_builder.db`). Con ella, PostgreSQL.
Variables completas en [10_DEPLOYMENT](docs/10_DEPLOYMENT.md).

### Verificación

```bash
python -m pytest backend/tests
```

```bash
npm run lint
```

```bash
npm run build
```

---

## Una hoja mínima

El profesor escribe (o pide a la IA) un script en el DSL propio:

```text
worksheet {
  title: "Práctica A1 de presente continuo"
  description: "Hoja para practicar acciones en progreso."

  fillblank {
    text: "She _____ reading now."
    answer: "is"
  }

  multiplechoice {
    question: "Choose the correct sentence."
    options:
    - She is reading.
    - She are reading.
    - She reading.
    answer: "She is reading."
  }

  textbox {
    prompt: "Write three sentences using the present continuous."
  }
}
```

El backend lo parsea, lo valida y lo guarda; el frontend lo pinta como actividades interactivas.
Los 19 tipos, sus campos y sus reglas están en [07_DSL](docs/07_DSL.md).

> Las palabras clave del DSL van en **inglés** (forman parte del lenguaje) y el contenido evaluable
> también. La interfaz y la documentación, en **español**.
