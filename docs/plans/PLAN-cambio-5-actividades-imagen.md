# Cambio 5 — Actividades con imagen nuevas (prompt: REVIEW primero)

Solicitud original: «Expande las actividades de imagen». **Decisión del usuario:** empezar con **dos**
tipos nuevos, y el renderer de impresión los traduce a papel (sin DSL nuevo para imagen). Esto toca
parser, DSL, renderer, impresión, constructor visual, calificación y la IA: es **diseño > implementación**.
Primero un REVIEW (Claude Code) y después un FEATURE.

Modelo recomendado: Claude Code (REVIEW). Plantilla base: `docs/prompts/REVIEW.md`.

---

## Prompt 1 — REVIEW (diseño; NO escribe código)

```
# Rol
Eres el arquitecto senior de MyDinoEnglish. Tu trabajo es PENSAR, no escribir código. Puedes
ilustrar con fragmentos, pero no implementes la solución.

# Contexto que cargas (en este orden)
1. docs/00_OVERVIEW.md y docs/01_ARCHITECTURE.md
2. docs/12_RULES.md + docs/15_DECISIONS.md — LEE los ADR antes de proponer algo que los contradiga.
3. docs/07_DSL.md, docs/08_RENDERER.md, docs/06_AI.md y docs/13_ROADMAP.md (qué hay en curso).

# Pregunta a resolver
Queremos añadir actividades que integren imágenes de forma más rica. Dos candidatas a resolver:

A. **Opción múltiple con imagen**: una imagen + N opciones de texto (o una imagen por opción),
   el alumno elige; la clave queda en el servidor.
B. **Matching imagen-texto**: emparejar imágenes con palabras (estilo flashcards), igual que
   `matching` pero el lado tiene imágenes en lugar de texto.

Cada una se debe perseguir en TODA la cadena: un tipo nuevo en SUPPORTED_BLOCKS (parser.py) +
domain.py + models.py + types.ts + normalizeActivity/withInstructions (api.ts) + renderer
(WorksheetRenderer.tsx) + impresión (WorksheetPrint.tsx) + constructor visual
(VisualWorksheetBuilder.tsx) + DSL (docs/07_DSL.md, _WORKSHEET_SYSTEM, GENERATION_PROMPT) + IA
generadora (ai.py) + urls de imágenes (Cloudinary via subirImagen).

Diseña el DSL de cada tipo (nombres de campos exactos), cómo se reutiliza el flujo de imágenes ya
existente (subir/biblioteca, el mismo que usa imagequestion/ImageQuestionEditor), y cómo califica el
backend cada una. Indica qué parte de la cadena cambia por tipo y cuánto esfuerzo aproximado.

# Restricciones
- La base está en producción con datos reales; el flujo vivo es /w/:id. No romper hojas existentes
  (regla 18: retrocompatibilidad con hojas sin block {}).
- Un tipo nuevo sigue la regla 17 (SUPPORTED_BLOCKS) y la cadena completa (regla 20). Si un eslabón
  falta, la clave/imagen se descartarían en silencio.
- Respetar la regla 21 (tres sitios del DSL sincronizados).
- La impresión debe traducir el tipo a papel (el usuario lo decidió): pensar cómo se visualiza el
  matching imagen-texto en papel (¿colocar el número y la imagen?).
- El alumno nunca recibe la clave (PLAN-fuga-de-respuestas).

# Cómo responder
- 2-3 alternativas por tipo con trade-offs (riesgo, mantenimiento, contexto que ocupa). No te cases
  con tu primera idea.
- Redacta para cada tipo el DSL propuesto y el detalle de calificación.
- Si hay que decidir, redacta el ADR para docs/15_DECISIONS.md.
- Si hay que diseñar trabajo futuro: plan por fases con esfuerzo y qué verifica cada una.
```

Cuando el REVIEW esté resuelto, abrir el **Prompt 2 — FEATURE** (debajo) para implementarlo.

---

## Prompt 2 — FEATURE (después de que el REVIEW decida)

```
# Rol
Eres un ingeniero senior en MyDinoEnglish. La tarea está diseñada y delimitada por el REVIEW previo
(docs/plans/PLAN-cambio-5-actividades-imagen.md): no la rediseñes, no amplíes alcance.

# Contexto que cargas (en este orden, y SOLO esto)
1. docs/00_OVERVIEW.md y docs/01_ARCHITECTURE.md
2. docs/12_RULES.md (reglas 17, 18, 20, 21), docs/07_DSL.md, docs/08_RENDERER.md, docs/06_AI.md
3. docs/15_DECISIONS.md y el adr/plan resultante del REVIEW.

# Tarea
Implementar los tipos de actividad decididos en el REVIEW:
[ESCRIBIR AQUÍ los tipos finales, campos DSL exactos y criterio de calificación que decidió el REVIEW]

# Restricciones
- Cadena completa (regla 20) y DSL sincronizado (regla 21). Lista canónica = SUPPORTED_BLOCKS.
- Impresión: el tipo se traduce a papel (decidido por el usuario).
- Reutilizar el flujo de imágenes existente (subirImagen + ImagePickerModal + ImageQuestionEditor).
- Migraciones idempotentes en AMBOS schema; nunca DROP (reglas 1-3).
- El alumno nunca recibe la clave. Textos de interfaz en español; contenido en inglés.

# Entregables
1. Código, diff mínimo, mismo estilo; comentarios ponytail:.
2. Documentación del dominio actualizada EN EL MISMO cambio.
3. Tests: pytest con parseo + calificación de cada tipo nuevo, y que el final público no filtra clave.
4. Verificación real con salida: python -m pytest backend/tests y npm run lint && npm run build.
5. Resumen 3-5 líneas.
```

---

## Notas del orquestador

- La decisión "renderer de impresión traduce a papel (sin DSL nuevo)" ya la tomó el usuario: quedó en
  `docs/15_DECISIONS.md`. El REVIEW NO debe reabrirla, solo pensar cómo se traduce cada tipo al papel.
- El `note` (Cambio 4) es independiente y puede implementarse antes; añadir la `note` a los tipos
  nuevos es compatible porque `note` aplica a cualquier actividad.