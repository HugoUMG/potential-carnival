# AI Worksheet Builder

A full-stack prototype for creating, generating, publishing, and completing interactive English worksheets. Teachers author or AI-generate `WorksheetScript`; the backend parses it into validated JSON; the frontend renders all activities through a registry-driven React component system.

## Architecture

- **Frontend:** React, Vite, TypeScript, TailwindCSS-style utility design.
- **Backend:** FastAPI with Pydantic models and a WorksheetScript parser.
- **Persistence target:** PostgreSQL-ready repository boundary; the prototype uses an in-memory repository.
- **Authentication target:** JWT-ready role model for teachers and students.

## WorksheetScript flow

```text
Teacher prompt → AI → WorksheetScript → parser → JSON → React activity registry → interactive worksheet
```

AI generation is intentionally constrained to return WorksheetScript, never raw HTML.

## Supported activities

- Fill blank
- Multiple choice
- Text box
- Matching
- Speaking prompt
- Reading passage
- Image question

## Local development

```bash
npm install
npm run dev
```

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload
```

## Checks

```bash
npm run build
python -m pytest backend/tests
```
