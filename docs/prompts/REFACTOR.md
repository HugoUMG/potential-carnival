# Plantilla — Refactor

Reorganizar código **sin cambiar comportamiento**. **Modelo recomendado:** Qwen3.7 Plus; si es
grande o toca arquitectura, Claude Code (ver [`16_MODEL_SELECTION`](../16_MODEL_SELECTION.md)).

## Reglas propias del refactor

- **Comportamiento idéntico.** Cualquier cambio de comportamiento visible hace que la tarea se
  convierta en un `FEATURE.md` o un `BUGFIX.md`, no en un refactor.
- Según [`12_RULES`](../12_RULES.md) y la regla de cierre, un refactor sin cambio de comportamiento
  **no se documenta** en `docs/` (ver §5.1 de `docs/agents/AGENT.md`).

## Cómo se rellena

- `[OBJETIVO]` — qué se busca: menos acoplamiento, sacar una función de un archivo grande, unificar
  dos implementaciones, etc.
- `[CONTORNO]` — el conjunto de archivos permitido. Todo lo que quede fuera no se toca.

## Prompt

```
# Rol
Eres un ingeniero senior en MyDinoEnglish. Refactoriza sin cambiar comportamiento y sin tocar
nada fuera del contorno definido.

# Contexto que cargas (en este orden, y SOLO esto)
1. docs/12_RULES.md
2. El documento del dominio afectado: docs/[DOMINIO].md

# Objetivo
[OBJETIVO]

# Contorno permitido
[CONTORNO — archivos que sí se pueden tocar]

# Restricciones
- Comportamiento idéntico. Si descubres un bug o algo que cambia el resultado visible, PARA y
  dilo en vez de "arreglarlo" dentro del refactor.
- Respeta las decisiones ya tomadas (docs/15_DECISIONS.md): no reintroduzcas lo que se descartó.
- Sin dependencias nuevas. Nombres y estructura según el estilo del código de alrededor.
- No refactorices por refactorizar: si no hay una mejora medible, di que el refactor no aplica.

# Entregables
1. Código reorganizado, diff lo más corto posible.
2. Verificación real: python -m pytest backend/tests  y/o  npm run lint && npm run build.
3. Resumen de 3 líneas: qué cambió de estructura, qué se verificó, qué NO cambió de comportamiento.
```
