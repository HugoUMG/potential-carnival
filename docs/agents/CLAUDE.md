# Claude Code — este repositorio

Sigue [`AGENT.md`](AGENT.md) (instrucciones comunes a cualquier agente). Esto solo añade lo específico
de Claude Code.

## Orden de lectura

1. [`docs/00_OVERVIEW.md`](../00_OVERVIEW.md)
2. [`docs/01_ARCHITECTURE.md`](../01_ARCHITECTURE.md)
3. [`docs/12_RULES.md`](../12_RULES.md)

Después, **solo** el documento del dominio que toque la tarea (tabla en `AGENT.md` §2). No cargues
`docs/` entero: `07_DSL.md` por sí solo son ~2500 líneas.

## Específico de Claude Code

- **`CLAUDE.md` en la raíz se carga solo** en cada sesión: es un índice deliberadamente corto. La
  documentación de verdad está en `docs/`.
- Usa **Read con `offset`/`limit`** o **Grep** para entrar en `07_DSL.md`, `main.py` y `repository.py`
  (todos superan las 1000 líneas). Leerlos enteros gasta contexto sin aportar.
- **Herramientas de archivo antes que comandos de shell**: Read, Grep y Glob en vez de `cat`, `grep`
  y `find`.
- Plataforma **Windows**: el shell por defecto es PowerShell, pero también hay Bash. Cada uno con su
  sintaxis; no mezclarlas.
- **No lances subagentes** salvo que el usuario los pida.
- Al entregar una hoja de trabajo: **solo el DSL en el chat**, sin archivo aparte.
