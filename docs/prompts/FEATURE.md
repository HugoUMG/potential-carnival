# Plantilla — Feature

Implementar una funcionalidad nueva. **Modelo recomendado:** simple (1 dominio) → Qwen3.7 Plus /
DeepSeek V4 Pro; compleja (varias capas, decisiones) → Claude Code o GLM-5.2 (ver
[`16_MODEL_SELECTION`](../16_MODEL_SELECTION.md)).

## Cómo se rellena

- `[COMPORTAMIENTO]` — qué debe poder hacer el usuario al terminar. **No** la solución técnica.
- `[DOMINIO]` — `02_BACKEND` / `03_FRONTEND` / `04_DATABASE` / `05_API` / `06_AI` / `07_DSL` /
  `08_RENDERER` / `09_SECURITY`.
- `[REGLA_CADENA]` — solo si toca un campo o tipo de actividad: copiar la regla 20 de `12_RULES`.
- `[ACEPTACION]` — el comportamiento mínimo que demuestra que funciona.

## Prompt

```
# Rol
Eres un ingeniero senior en MyDinoEnglish. La tarea está diseñada y delimitada: no la rediseñes,
no amplíes alcance, no refactorices código ajeno.

# Contexto que cargas (en este orden, y SOLO esto)
1. docs/00_OVERVIEW.md (solo el resumen) y docs/01_ARCHITECTURE.md
2. docs/12_RULES.md  ← reglas duras, no negociables
3. El documento del dominio que toque la tarea: docs/[DOMINIO].md
4. Si la tarea puede chocar con una decisión pasada: docs/15_DECISIONS.md
Entra a main.py, repository.py y 07_DSL.md con Grep / Read(offset, limit): superan las 1000 líneas.

# Tarea
[COMPORTAMIENTO]

# Restricciones
- NUNCA DROP TABLE/COLUMN. Migraciones idempotentes y en AMBOS schema (db/schema.sql y .postgres.sql).
- Todo el SQL en repository.py; todo fetch en src/services/api.ts. No inventes endpoints ni tipos:
  la lista canónica está en SUPPORTED_BLOCKS (parser.py) y main.py.
- [REGLA_CADENA]
- Modo oscuro solo por CSS (:root[data-theme='dark']). Textos de interfaz en español; contenido
  evaluable en inglés.
- Sin dependencias nuevas sin justificación (regla 16).

# Entregables
1. Código, diff mínimo, mismo estilo que el de alrededor; comentarios `ponytail:` para
   simplificaciones deliberadas.
2. Documentación del dominio actualizada EN EL MISMO cambio (tabla de docs/agents/AGENT.md §5.1).
   Si no aplica, dilo explícitamente.
3. Verificación real, con salida: python -m pytest backend/tests  y/o  npm run lint && npm run build.
4. Resumen de 3-5 líneas: qué cambió, qué verificaste, qué queda pendiente.

# Aceptación
[ACEPTACION]
```
