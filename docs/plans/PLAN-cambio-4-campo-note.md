# Cambio 4 — Campo privado `note` para la IA (prompt Claude)

Solicitud original: «Añade un campo de descripción privado a las actividades (solo para la IA, nota:
decidido)». La decisión quedó en `docs/15_DECISIONS.md`: el campo se llama **`note`**, es **opcional**
y **por actividad**, y **solo lo lee la IA al calificar** (el alumno nunca lo ve).

Modelo recomendado: Claude Code (compleja, varias capas). Plantilla base: `docs/prompts/FEATURE.md`.

---

## Prompt (copiar/pegar en Claude)

```
# Rol
Eres un ingeniero senior en MyDinoEnglish. La tarea está diseñada y delimitada: no la rediseñes,
no amplíes alcance, no refactorices código ajeno.

# Contexto que cargas (en este orden, y SOLO esto)
1. docs/00_OVERVIEW.md (solo el resumen) y docs/01_ARCHITECTURE.md
2. docs/12_RULES.md  ← reglas duras. Leer especial SS20 (cadena del campo) y SS21 (tres sitios del DSL).
3. docs/07_DSL.md, docs/04_DATABASE.md, docs/06_AI.md, docs/05_API.md, docs/08_RENDERER.md
4. docs/15_DECISIONS.md (el ADR de este campo si ya existe; si no, créalo en el mismo cambio)
Entra a main.py, repository.py y 07_DSL.md con Grep / Read(offset, limit): superan las 1000 líneas.

# Tarea
Añadir a las actividades un campo opcional privado `note` (texto libre).

[COMPORTAMIENTO]
1. El profesor puede escribir una `note` en CUALQUIER actividad (más útil en abiertas: imagequestion,
   textbox, speaking), tanto en el modo visual como en el DSL.
2. `note` NO se muestra al alumno en ningún renderer (ni en pantalla ni en impresión). Solo existe
   dentro del backend para guiar a la calificación con IA.
3. El calificador con IA recibe la `note` como pista/contexto extra (p. ej., "en esta imagen el
   alumno debe mencionar el color rojo") y la usa para juzgar respuestas abiertas. La `note` tampoco
   se devuelve al alumno en el detalle de calificación.

# Restricciones
- Aplica la regla 20 de 12_RULES íntegra: el campo DEBE existir en parser.py, domain.py, models.py,
  src/types.ts y en normalizeActivity/withInstructions de services/api.ts. Si falta uno, se descarta
  en silencio al persistir o al leer.
- Regla 21: si el DSL enseña el campo, sincroniza a la vez docs/07_DSL.md, _WORKSHEET_SYSTEM (ai.py)
  y GENERATION_PROMPT (src/utils/generationPrompt.ts). La `note` no es un campo de la hoja generada
  por IA automáticamente (la escribe el profesor); decide tú si entra en el DLS de definición de
  tipos pero NO pidas a la IA que invente notes.
- La `note` se persiste dentro del activity JSON (json_content de la hoja). No es una columna nueva:
  NO DROP. Si requiere migración, idempotente y en AMBOS schema (db/schema.sql y .postgres.sql).
- El saned de clave de respuestas que entrega al alumno (PLAN-fuga-de-respuestas en curso) NO debe
  regresar: asegúrate de que `note` tampoco viaja al alumno aunque se incluya en json_content.
- Descartar `note` en el renderer y en `.public/*`. Textos de interfaz en español; contenido
  evaluable en inglés.
- Sin dependencias nuevas (regla 16).

# Entregables
1. Código, diff mínimo, mismo estilo; comentarios `ponytail:` para simplificaciones deliberadas.
2. Documentación actualizada EN EL MISMO cambio: 07_DSL.md, 04_DATABASE.md, 06_AI.md, 05_API.md,
   08_RENDERER.md, y ADR en 15_DECISIONS.md si no existe.
3. Verificación real con salida: python -m pytest backend/tests  y  npm run lint && npm run build.
4. Añade un test en backend/tests que persista una hoja con `note`, compruebe que se guarda y que el
   endpoint público/alumno NO lo expone.
5. Resumen de 3-5 líneas: qué cambió, qué verificaste, qué queda pendiente.

# Aceptación
- La `note` se persiste, es editable en visual y en DSL, la IA la usa al calificar, y NO aparece en
  el renderer (pantalla ni papel) ni en ninguna respuesta al alumno. pytest + lint + build pasan.
```

---

## Notas del orquestador

- Campo es **por actividad** (en `activity` del json). Si resulta más natural por hoja, avísalo en
  la respuesta ANTES de decidir; no cambies el alcance por ti mismo.
- Recordar: `_WORKSHEET_SYSTEM` es el bloque de `ai.py`; `GENERATION_PROMPT` es
  `src/utils/generationPrompt.ts`; la lista canónica de tipos es `SUPPORTED_BLOCKS` (parser.py).