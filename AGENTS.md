# Agentes

Las instrucciones para cualquier agente que trabaje en este repositorio están en
**[`docs/agents/AGENT.md`](docs/agents/AGENT.md)** — independientes del modelo y de la herramienta.

Variantes específicas: [`docs/agents/CLAUDE.md`](docs/agents/CLAUDE.md) ·
[`docs/agents/OPENCODE.md`](docs/agents/OPENCODE.md).

La documentación técnica está en [`docs/`](docs/), organizada por dominio; empieza por
[`docs/00_OVERVIEW.md`](docs/00_OVERVIEW.md).

## Regla de cierre

Antes de dar por terminada cualquier tarea que **cambie comportamiento**, actualiza el documento del
dominio que tocaste. Si no aplica ninguno, **dilo explícitamente** en vez de callarlo.

| Tocaste… | Actualiza |
|----------|-----------|
| `parser.py`: tipo, campo o validación | `docs/07_DSL.md` + `_WORKSHEET_SYSTEM` (`ai.py`) + `GENERATION_PROMPT` (`generationPrompt.ts`) |
| Un endpoint (nuevo, borrado o con otro contrato) | `docs/05_API.md` |
| Tabla, columna, índice o migración | `docs/04_DATABASE.md` |
| Prompts o lógica de IA | `docs/06_AI.md` |
| Renderer o componente de actividad | `docs/08_RENDERER.md` |
| Auth, roles o permisos | `docs/09_SECURITY.md` |
| Variable de entorno o despliegue | `docs/10_DEPLOYMENT.md` |
| Cerraste o abriste un pendiente | `docs/13_ROADMAP.md` |
| Descartaste una alternativa por un motivo que no se lee en el código | `docs/15_DECISIONS.md` |

Un término propio nuevo va a `docs/14_GLOSSARY.md`. Una regla dura nueva, a `docs/12_RULES.md`.
**La documentación se actualiza en el mismo cambio, no "después".**
