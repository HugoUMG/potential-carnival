# Plantillas de prompt

Prompts profesionales, listos para copiar, pensados para **MyDinoEnglish**. El objetivo es que cada
tarea se delegue con el mismo rigor sea quien sea el modelo que la ejecute (Claude, Kimi, Qwen,
DeepSeek…), sin reescribir el contexto en cada sesión.

## Cómo usar

1. El **orquestador** (o tú) clasifica la tarea y elige la plantilla:
   - [`FEATURE.md`](FEATURE.md) — implementar una funcionalidad nueva.
   - [`BUGFIX.md`](BUGFIX.md) — corregir un bug con su causa verificada.
   - [`REFACTOR.md`](REFACTOR.md) — reorganizar código sin cambiar comportamiento.
   - [`REVIEW.md`](REVIEW.md) — diseño, decisión de arquitectura o revisión de una implementación.
   - [`TESTING.md`](TESTING.md) — escribir, corregir o ampliar tests.
   - [`DOCUMENTATION.md`](DOCUMENTATION.md) — escribir o actualizar `docs/`.
   - [`WORKSHEET.md`](WORKSHEET.md) — generar una hoja de trabajo en el DSL.
2. Sustituye los marcadores (`[TAREA]`, `[DOMINIO]`, etc.) por el caso concreto.
3. Copia el bloque en el modelo elegido según [`16_MODEL_SELECTION`](../16_MODEL_SELECTION.md).

## Qué tienen todas

- **Rol** explícito de qué se le pide y qué *no* (no rediseñar, no ampliar alcance).
- **Orden de lectura** fijo: `00_OVERVIEW` → `12_RULES` → dominio, y **nada más**. Ahorra contexto.
- **Cadena completa** cuando el cambio toca un campo o tipo (regla 20 de `12_RULES`).
- **Verificación real**: `pytest`, `lint`, `build`, con salida, no con un "funciona".
- **Regla de cierre**: documentación del dominio en el mismo cambio (tabla de
  [`../agents/AGENT.md`](../agents/AGENT.md) §5.1).

## Modelo por plantilla

| Plantilla | Recomendado | Por qué |
|-----------|------------|---------|
| FEATURE (simple) | Qwen3.7 Plus / DeepSeek V4 Pro | Delimitada, un dominio |
| FEATURE (compleja) | Claude Code / GLM-5.2 | Varias capas, decisiones |
| BUGFIX | DeepSeek V4 Flash / Qwen3.7 Plus | Verificado y acotado |
| REFACTOR | Qwen3.7 Plus / Claude (si es grande) | Sin cambio de comportamiento |
| REVIEW | Claude Code | Juzgar calidad y alternativas |
| TESTING | Qwen3.7 Plus / MiMo-V2.5-Pro | Mecánico pero cuidadoso |
| DOCUMENTATION | Claude Code | Coherencia entre dominios |
| WORKSHEET | GLM-5.2 / DeepSeek V4 Pro | Calidad de contenido + DSL |

Los criterios de fondo están en [`../16_MODEL_SELECTION.md`](../16_MODEL_SELECTION.md).