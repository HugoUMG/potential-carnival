# Cambio 12 — Modo físico/impresión para la IA (prompt Claude)

Solicitud original: «Modo de impresión / físico para la IA». El usuario decidió: cuando el profesor
genera con IA, poder pedir un resultado que se **canjea bien a papel**, y que el renderer de
impresión ya traduce a papel (sin DSL nuevo).

Hoy `WorksheetPrint` (componente) ya **omite** `speaking` y todos los `listening*` (ver
`docs/08_RENDERER.md`), y `WorksheetEditor` solo elige nivel/tema/duración/actividades. El hueco es
que la IA puede proponer actividades no imprimibles y eso no se sabe de antemano.

Modelo recomendado: Claude Code (cruza 06_AI + 05_API + 08_RENDERER). Plantilla base:
`docs/prompts/FEATURE.md` (compleja).

---

## Prompt (copiar/pegar en Claude)

```
# Rol
Eres un ingeniero senior en MyDinoEnglish. La tarea está diseñada y delimitada: no la rediseñes,
no amplíes alcance, no refactorices código ajeno.

# Contexto que cargas (en este orden, y SOLO esto)
1. docs/00_OVERVIEW.md (solo el resumen) y docs/01_ARCHITECTURE.md
2. docs/12_RULES.md  ← reglas duras (regla 21 especialmente)
3. docs/06_AI.md, docs/05_API.md y docs/08_RENDERER.md
4. docs/15_DECISIONS.md (decisión: el renderer de impresión traduce; sin DSL nuevo de imagen)
Entra a main.py, repository.py y 07_DSL.md con Grep / Read(offset, limit): superan las 1000 líneas.

# Tarea
Añadir un modo «físico / imprimible» a la generación con IA.

[COMPORTAMIENTO]
1. En el panel «Generar con IA» del WorksheetEditor hay un botón/interruptor «Modo físico
   (imprimible)». Si está activo, la hoja que genera la IA queda restringida a actividades que sí
   pasan a papel.
2. Restricción de tipos en modo físico: se EXCLUYEN de la generación `speaking` y todos los
   `listening*` (la misma lista de tipos que hoy omite WorksheetPrint). Se favorece además contenido
   que se resuelva a mano: fillblank, dragdrop, matching, truefalse, multiplechoice, multiselect,
   textbox, reading, readingtruefalse, content, imagequestion, conversation (el enunciado escrito,
   sin audio).
3. La pieza de IA (ai.py) recibe el flag y, además de pedírselo en el prompt, FILTRA o recusa
   cualesquiera actividades no imprimibles que haya podido devolver, para que la clave resultante
   siempre sea papel-amigable. Decide tú si el filtro es *prompt + filtro posterior* o solo
   *prompt*, y justifícalo (prompt solo es barato pero puede fallar).
4. El prompt general (GENERATION_PROMPT, src/utils/generationPrompt.ts) documenta que existe este
   modo; `_WORKSHEET_SYSTEM` (ai.py) refleja el mismo criterio (regla 21).

# Restricciones
- No romper el modo normal de generación: el flag es opcional y queda por defecto apagado.
- Regla 21: sincroniza docs/07_DSL.md, _WORKSHEET_SYSTEM y GENERATION_PROMPT.
- Contrato de API: si el endpoint de generación cambia (mismo endpoint + flag, o campo en el body),
  documenta docs/05_API.md en el mismo cambio. No rompas llamadas existentes.
- El alumno nunca recibe la clave (PLAN-fuga-de-respuestas sigue aplicando).
- Sin dependencias nuevas (regla 16).

# Entregables
1. Código, diff mínimo, mismo estilo; comentarios `ponytail:`.
2. Documentación actualizada EN EL MISMO cambio: 06_AI.md, 05_API.md, 08_RENDERER.md, y 07_DSL.md
   solo si la nota del criterio vive allí.
3. Verificación real con salida: python -m pytest backend/tests y npm run lint && npm run build.
4. Test de backend: con flag activo, una generación (o un corpus de ejemplo) no contiene tipos no
   imprimibles, o los descarta antes de persistir.
5. Resumen de 3-5 líneas.

# Aceptación
- El modo físico genera y persiste hojas sin speaking ni listening*, y es opcional (defecto apagado).
- La lista de tipos imprimibles coincide con la que ya usa WorksheetPrint. pytest + lint + build.

```

---

## Notas del orquestador

- La fuente de verdad de «imprimible» debe ser la MISMA lista que omite `WorksheetPrint` hoy. Si no
  está extraída como constante, proponla en el mismo cambio (sin renombrar lo que ya existe).
- `imagequestion` en texto con URL sí imprime; las `conversation` imprimen el guion. Aclara en la
  respuesta cuál es tu recorte exacto de «imprimible».