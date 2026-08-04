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

## RESULTADO DEL REVIEW (2026-08-03) — decidido e implementado

### El criterio que decide las dos

Las dos actividades son variantes visuales de tipos que **ya existen y ya se califican bien**
(`multiplechoice` y `matching`). Todo diseño que obligue a escribir una rama de calificación nueva
está pagando de más. Así que la pregunta del REVIEW no era «cómo represento imágenes» sino **«qué
representación deja intacta la clave de respuestas»** — porque la clave es lo que recorre
`_build_answer_details`, la pantalla de revisión del profesor y la impresión.

De ahí sale la regla común a los dos tipos: **la imagen es un campo paralelo, nunca el valor de la
clave.** El texto sigue siendo la respuesta; la URL solo decide qué se pinta.

### A · `imagechoice` — opción múltiple con imagen

Tres alternativas evaluadas:

| Alternativa | Coste | Por qué se descarta / elige |
|---|---|---|
| A1 · `multiplechoice` + campo `image:` (una imagen de enunciado) | casi cero | Cubre solo la mitad del caso de clase: no permite *elegir entre imágenes* |
| A2 · `options` con URLs dentro | bajo | La clave sería una URL: ilegible en la pantalla de revisión y en el resumen para el profesor |
| **A3 · `options` de texto + `option_images` paralelo** ← elegida | bajo | Clave legible, calificación idéntica a `multiplechoice`, cubre A1 y A2 a la vez |

```
imagechoice {
  image: "https://res.cloudinary.com/…/park.png"   # opcional: imagen de enunciado
  question: "Where are the children playing?"
  options:
  - in the park
  - at school
  - at home
  answer: "in the park"
}

imagechoice {                                       # variante «elegir entre imágenes»
  question: "Which one is the apple?"
  options:
  - apple
  - banana
  option_images:
  - https://res.cloudinary.com/…/apple.png
  - https://res.cloudinary.com/…/banana.png
  answer: "apple"
}
```

- `option_images` es **paralelo a `options`** por índice. Si falta una entrada, esa opción se pinta
  como texto: una lista más corta no rompe nada.
- Cuando una opción tiene imagen, el alumno ve **solo la imagen** (el texto viaja como `alt`, que es
  lo que necesita un lector de pantalla). Si se mostrara el texto debajo, «¿cuál es la manzana?» se
  respondería leyendo.
- **Calificación: la de `multiplechoice`, sin una línea nueva** — `answer` es una de las `options`.

### B · `imagematching` — emparejar imagen con palabra

Tres alternativas evaluadas:

| Alternativa | Coste | Por qué se descarta / elige |
|---|---|---|
| B1 · `left` con URLs dentro | cero | La clave queda `{"https://…/dog.png": "dog"}`: la pantalla de revisión del profesor muestra una URL de 90 caracteres como enunciado |
| B2 · bloques `pair { image match }` + `options` (copiar `listeningmatching`) | medio | Cambia la interacción a un desplegable por ítem; el usuario pidió *«igual que matching»*, o sea unir con líneas |
| **B3 · `left_images` paralelo a `left`, con `left` autogenerado** ← elegida | bajo | Conserva el modelo de respuesta de `matching` entero: unir con líneas, misma calificación, misma impresión |

```
imagematching {
  left_images:
  - https://res.cloudinary.com/…/dog.png
  - https://res.cloudinary.com/…/cat.png
  right:
  - dog
  - cat
}
```

- `left` es **opcional**: si no se escribe, el parser lo rellena con `Image 1`, `Image 2`, … Así el
  profesor no escribe cada palabra dos veces y la clave sigue siendo legible
  (`{"Image 1": "dog"}`) en vez de una URL.
- `right[i]` es la pareja correcta de `left_images[i]`, exactamente como en `matching`.
- **Calificación: la de `matching`, añadiendo el tipo a la condición que ya existe.** Hereda también
  el rescate por IA de `_AI_RESCUABLE` (una pareja distinta de la clave puede ser válida).

### Qué cambia de la cadena, por tipo

Los dos recorren lo mismo; ninguno toca la base de datos (campos dentro de `json_content`):

| Eslabón | `imagechoice` | `imagematching` |
|---|---|---|
| `SUPPORTED_BLOCKS` + `parse_activity` | rama nueva | rama nueva + relleno de `left` |
| `_activity_problem` | regla de `multiplechoice` + `option_images` no más largo que `options` | regla de `matching` + `left_images` no vacío |
| `domain.py` / `models.py` | `option_images` | `left_images` |
| `_build_answer_details` | se suma a la rama de `multiplechoice` | se suma a la rama de `matching` |
| `types.ts` / `api.ts` | interfaz + `normalizeActivity` | interfaz + `normalizeActivity` |
| Renderer | envuelve `MultipleChoiceRenderer` | parámetro de imagen en `MatchingRenderer` |
| Impresión | opciones con miniatura | filas con miniatura y línea |
| Constructor visual | editor con selector de imagen por opción | editor de filas (imagen ↔ palabra) |
| DSL ×3 (07_DSL, `_WORKSHEET_SYSTEM`, `GENERATION_PROMPT`) | sí | sí |

### Impresión (ADR-21: el papel traduce, no hay DSL nuevo)

- `imagechoice`: enunciado, imagen del enunciado si la hay, y las opciones como `A) B) C)` con la
  miniatura dentro de cada opción cuando existe.
- `imagematching`: la tabla de dos columnas de `matching` — a la izquierda `1.` + línea para escribir
  + la miniatura; a la derecha `A) B) C)` con las palabras barajadas. Es exactamente el ejercicio de
  papel de toda la vida.

### Riesgos aceptados

- **Listas paralelas descuadradas.** El parser no puede saber qué imagen quiso el profesor para qué
  opción si escribe menos URLs. Se degrada a texto en vez de fallar, y `_activity_problem` rechaza
  el caso al revés (más imágenes que opciones), que sí es un error de escritura.
- **La IA generadora no inventa URLs.** Igual que en `imagequestion`, solo escribe estos tipos si el
  profesor le da las imágenes. Queda dicho en los tres sitios del DSL.
- **El `alt` es legible en el DOM.** No es un agujero nuevo: hoy la clave entera viaja en
  `json_content` (fuga conocida, fase 1 del plan de fuga de respuestas).

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