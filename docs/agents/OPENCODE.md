# OpenCode — este repositorio

Sigue [`AGENT.md`](AGENT.md) (instrucciones comunes a cualquier agente). Esto solo añade lo específico
de OpenCode.

## Orden de lectura

1. [`docs/00_OVERVIEW.md`](../00_OVERVIEW.md)
2. [`docs/01_ARCHITECTURE.md`](../01_ARCHITECTURE.md)
3. [`docs/12_RULES.md`](../12_RULES.md)

Después, **solo** el documento del dominio que toque la tarea (tabla en `AGENT.md` §2).

## Específico de OpenCode

- OpenCode busca `AGENTS.md` en la raíz del repositorio: ese archivo existe y apunta aquí. Si cambias
  de convención, mantén el puntero.
- **El modelo puede variar** (Kimi, GPT, Qwen, Claude…). No asumas ventana de contexto grande: abre
  los archivos por partes y busca por patrón antes de leer entero. `07_DSL.md`, `main.py` y
  `repository.py` superan las 1000 líneas cada uno.
- Si el modelo no conoce el proyecto, la ruta más barata a un buen resultado es
  `00_OVERVIEW` → `12_RULES` → el documento del dominio → el archivo de código concreto.
- El proyecto es **bilingüe a propósito**: documentación, interfaz y comentarios en **español**; el
  contenido evaluable de las hojas y las palabras clave del DSL, en **inglés**. No traduzcas ni una
  cosa ni la otra.
- Windows + PowerShell como shell por defecto.

## Errores típicos de un modelo que llega sin contexto

- Proponer un ORM, Alembic o `python-dotenv`. Ya se descartaron: ver `15_DECISIONS.md`.
- Escribir SQL fuera de `repository.py`.
- Añadir un campo de actividad solo en el parser (se descarta en silencio en el resto de la cadena).
- Tratar `speaking` como no implementado: **sí lo está**, en sus dos modos.
- Sugerir un `DROP COLUMN` "para limpiar". Nunca.
