# 00 — Visión general

> **Punto de entrada de la documentación.** Si eres un agente o un desarrollador nuevo, lee este
> archivo y [01_ARCHITECTURE](01_ARCHITECTURE.md); luego carga solo el dominio que necesites.

## Qué es

**MyDinoEnglish** (repositorio `potential-carnival`) es una plataforma web educativa para clases de
inglés. Un **profesor** crea hojas de trabajo interactivas —a mano, con un constructor visual o
generándolas con IA—, las asigna a sus aulas y revisa las respuestas. El **alumno** las resuelve
desde su portal, desde un enlace directo o como invitado sin cuenta.

## Qué problema resuelve

Crear una evaluación de inglés con audio, imágenes y autocorrección normalmente exige una
herramienta de pago o mucho trabajo manual. Aquí el profesor escribe (o pide a la IA) un texto en un
DSL propio y obtiene una hoja interactiva con:

- **21 tipos de actividad** (gramática, lectura, escucha, habla, escritura abierta).
- **Audio sintetizado** por TTS: no hay que grabar ni subir archivos.
- **Calificación automática** de lo cerrado + **calificación por IA** de lo abierto, con comentario
  en español para el alumno.
- **Reparto sin fricción**: enlace directo por hoja, sin login ni cuenta para el alumno.

## Estado actual

En producción, con datos reales, desplegado en Render + Aiven. Funcionan los 21 tipos de actividad,
el sistema de aulas, la calificación IA, el modo invitado, el enlace directo, la impresión en papel
y el portal de vocabulario.

**El flujo vivo es el enlace directo `/w/:worksheetId`.** Las aulas y los alumnos registrados
funcionan y se mantienen, pero hoy no son lo que más se usa en producción: fueron la primera fase del
proyecto y el reparto sin cuentas los desplazó. Tenerlo en cuenta antes de invertir en funciones que
solo tocan al alumno registrado (ver [15_DECISIONS, ADR-07](15_DECISIONS.md)).

Rama de trabajo actual: `feat/student-ux`.
Pendiente mayor conocido: [la hoja entrega al alumno su propia clave de respuestas](plans/PLAN-fuga-de-respuestas.md).
Ver [13_ROADMAP](13_ROADMAP.md) para el resto.

## Tecnologías

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19 + Vite 7 + TypeScript 5.8 + Tailwind CSS 3 |
| Backend | Python + FastAPI (Pydantic v2) |
| Base de datos | PostgreSQL en producción (Aiven) / SQLite en desarrollo |
| Autenticación | JWT con roles + Google Identity Services |
| TTS | `edge-tts` (6 voces curadas US/UK/AU incl. infantil + velocidad de síntesis; las ~47 en inglés valen en el DSL; las conversaciones eligen voz por hablante con `male_voice`/`female_voice`) |
| IA | Google Gemini (`gemini-3.1-flash-lite`) con fallback a Groq (`llama-3.3-70b-versatile`) |
| Transcripción | Groq Whisper |
| Deploy | Render.com — Static Site (frontend) + Web Service (backend) |

## Roles y modos de acceso

| Rol | Permisos |
|-----|---------|
| `admin` | Gestiona profesores, estudiantes y todo el contenido |
| `teacher` | Crea aulas, hojas y listas de vocabulario; asigna contenido; revisa respuestas |
| `student` | Completa las hojas de su aula, ve resultados y notas |
| `reader` | Solo el portal de vocabulario; no puede cambiar su contraseña |

Además, sin cuenta:

- **Enlace directo** (`/w/:worksheetId`) — el flujo priorizado. El profesor copia el enlace de una
  hoja publicada y el alumno la resuelve sin login ni menú.
- **Modo invitado** (`/guest`) — nombre + aula pública, identificado por `guest_token`. Sigue vivo
  pero **sus entradas están ocultas en la UI**.
- **Portal público de vocabulario** (`/vocab`, `/v/:vocabId`).

## Flujo principal

1. El profesor se registra **solo con Google** (`/registro`), o el admin le crea la cuenta.
2. Crea un aula → le asigna estudiantes y hojas.
3. Crea una hoja (IA, constructor visual o DSL a mano) → la publica → la asigna o comparte su enlace.
4. El alumno entra → ve solo las hojas de su aula (o abre el enlace) → resuelve → envía.
5. El backend califica: exacto lo cerrado, IA lo abierto. El profesor puede corregir a mano.
6. Dashboard del profesor: métricas, notificaciones recientes, actividad de los alumnos.

## Módulos

| Módulo | Dónde | Documento |
|--------|-------|-----------|
| API y lógica de negocio | `backend/app/main.py` | [02_BACKEND](02_BACKEND.md), [05_API](05_API.md) |
| Acceso a datos | `backend/app/repository.py`, `database.py` | [04_DATABASE](04_DATABASE.md) |
| DSL de hojas | `backend/app/parser.py` | [07_DSL](07_DSL.md) |
| Integración con IA | `backend/app/ai.py` | [06_AI](06_AI.md) |
| Autenticación | `backend/app/security.py` | [09_SECURITY](09_SECURITY.md) |
| Portales React | `src/App.tsx`, `src/pages/` | [03_FRONTEND](03_FRONTEND.md) |
| Render de actividades | `src/components/activityRegistry.tsx` | [08_RENDERER](08_RENDERER.md) |

## Índice completo

`00` Visión general · `01` Arquitectura · `02` Backend · `03` Frontend · `04` Base de datos ·
`05` API · `06` IA · `07` DSL · `08` Renderer · `09` Seguridad · `10` Despliegue · `11` Testing ·
`12` Reglas · `13` Roadmap · `14` Glosario · `15` Decisiones · `16` Selección de modelo ·
`prompts/` plantillas de prompt por tipo de tarea · `agents/` instrucciones para agentes
(incluido el [orquestador](agents/ORCHESTRATOR.md)).
