# Referencia Completa — DSL y JSON de Hojas de Trabajo

> Documento generado tras revisión exhaustiva de `parser.py`, `domain.py`, `models.py`, `main.py`, `types.ts`, `activityRegistry.tsx` y `WorksheetRenderer.tsx`.  
> Cubre cada tipo de actividad, campos, variaciones, calificación automática y errores comunes.

---

## Tabla de Contenidos

1. [Arquitectura del sistema](#1-arquitectura-del-sistema)
2. [Estructura JSON global](#2-estructura-json-global)
3. [El DSL — Reglas globales](#3-el-dsl--reglas-globales)
4. [Actividades](#4-actividades)
   - [fillblank](#41-fillblank)
   - [multiplechoice](#42-multiplechoice)
   - [textbox](#43-textbox)
   - [matching](#44-matching)
   - [reading](#45-reading)
   - [imagequestion](#46-imagequestion)
   - [listening](#47-listening)
   - [listeningfillblank](#48-listeningfillblank)
   - [listeningmultiplechoice](#49-listeningmultiplechoice)
   - [listeningmatching](#410-listeningmatching)
   - [listeningtruefalse](#411-listeningtruefalse)
   - [truefalse](#412-truefalse)
   - [readingtruefalse](#413-readingtruefalse)
   - [multiselect](#414-multiselect)
   - [dragdrop](#415-dragdrop)
   - [speaking](#416-speaking)
   - [listeningorder](#417-listeningorder)
   - [conversation](#418-conversation)
   - [content](#419-content)
5. [Sistema de bloques — block {}](#5-sistema-de-bloques--block-)
6. [Sistema de temas — theme {}](#6-sistema-de-temas--theme-)
7. [Calificación automática](#7-calificación-automática)
8. [Instrucciones por actividad — instructions](#8-instrucciones-por-actividad--instructions)
9. [Saltos de línea — \n](#9-saltos-de-línea--n)
10. [Errores comunes](#10-errores-comunes)
11. [Hojas de trabajo completas — ejemplos](#11-hojas-de-trabajo-completas--ejemplos)
12. [Dónde se documenta el DSL](#12-dónde-se-documenta-el-dsl-mantener-sincronizado)
13. [Grupos por habilidad (taxonomía pedagógica)](#13-grupos-por-habilidad-taxonomía-pedagógica)
14. [Guía de calidad al generar hojas](#14-guía-de-calidad-al-generar-hojas)

---

## 1. Arquitectura del sistema

```
PROFESOR escribe DSL (texto)
        │
        ▼
  parser.py → parse_worksheet_script()
        │
        ▼
  WorksheetData (Python dataclass)
  ├── title
  ├── description
  ├── activities: list[ActivityData]   ← si no hay blocks
  ├── blocks: list[BlockData]          ← si hay block {}
  └── theme: dict | None
        │
        ▼
  BD PostgreSQL / SQLite
  ├── worksheets.json_content  → WorksheetJson (actividades parseadas)
  └── worksheets.theme         → columna separada
        │
        ▼
  API FastAPI → GET /worksheets/{id}
        │
        ▼
  FRONTEND React
  └── WorksheetRenderer.tsx
      └── activityRegistry.tsx (renderiza cada tipo)
```

**Flujo de datos en el envío de respuestas:**
```
Student envía answers_json  →  _build_answer_details()  →  ai_grade_activities()
                                     │                              │
                               calificación                    IA revisa/corrige
                               automática exacta               respuestas pending
                                     │                              │
                                     └──────────────────────────────┘
                                                  │
                                          _score_details()
                                    (correct_count, pending_count, score%)
```

---

## 2. Estructura JSON global

Lo que guarda la base de datos en `worksheets.json_content`:

```json
{
  "title": "Título de la hoja",
  "description": "Descripción visible al estudiante",
  "activities": [],
  "blocks": []
}
```

**Regla:** `activities` y `blocks` son mutuamente excluyentes en la práctica:
- Si el DSL usa `block {}` → el JSON tendrá `blocks` con actividades adentro; `activities` estará vacío.
- Si el DSL no usa `block {}` → el JSON tendrá `activities` plano; `blocks` estará vacío.
- El frontend maneja ambos casos con un fallback en `WorksheetRenderer.tsx`.

### Estructura de `blocks[]`

```json
{
  "blocks": [
    {
      "title": "Part 1: Grammar",
      "instructions": "Complete each sentence with the correct form.",
      "activities": [
        { "id": "uuid", "type": "fillblank", ... },
        { "id": "uuid", "type": "multiplechoice", ... }
      ]
    },
    {
      "title": "Part 2: Listening",
      "instructions": null,
      "activities": [
        { "id": "uuid", "type": "listening", ... }
      ]
    }
  ]
}
```

### Campos de cada actividad (JSON mínimo obligatorio)

| Campo | Tipo | Presente en |
|-------|------|-------------|
| `id` | string (UUID v4) | Todas |
| `type` | string | Todas |
| `instructions` | string \| null | Todas (opcional) |
| `note` | string \| null | Todas (opcional) — **privado: solo lo lee la IA al calificar** |
| *campos específicos* | ver cada tipo | según tipo |

> **Nota:** El parser omite los campos `null` en el JSON final (`to_dict()` filtra los `None`).

#### `note` — nota privada para la IA calificadora

Texto libre que escribe **el profesor** para explicarle a la IA qué debe considerar correcto en esa
actividad. Es el criterio de corrección, no una instrucción para el alumno:

```
imagequestion {
  image: "https://res.cloudinary.com/…/car.png"
  prompt: "What do you see in the picture?"
  note: "En la foto hay un carro rojo aparcado: debe mencionar el color."
}
```

- **El alumno nunca la recibe.** El backend la borra del `json_content` *y* del `script_content`
  antes de responder en `/public/worksheets*` y en `/students/{id}/worksheets` (`_without_notes`).
  Tampoco aparece en el renderer ni en la impresión.
- Se envía a la IA calificadora como `teacher_note` junto a la respuesta del alumno; el prompt le
  prohíbe citarla en el comentario.
- Es especialmente útil en `imagequestion`: la IA **no ve la imagen**, así que la `note` es la única
  descripción de la que dispone.
- Va en **una sola línea** (el saneado del script busca la línea `note:`). Vale para cualquier tipo;
  en `content` no tiene efecto porque no se califica.
- La IA generadora **no** escribe `note`: `_WORKSHEET_SYSTEM` y `GENERATION_PROMPT` se lo prohíben
  explícitamente. Es un campo del profesor.

---

## 3. El DSL — Reglas globales

El DSL es el lenguaje de script que escribe el profesor. El parser lo convierte a JSON.

### Estructura básica

```
worksheet {
  title: "Título de la hoja"
  description: "Descripción opcional"

  [theme { ... }]   ← opcional
  [block { ... }]*  ← opcional, múltiples
  [actividad { }]*  ← una o más
}
```

### Reglas de sintaxis

| Regla | Detalle |
|-------|---------|
| Todo va dentro de `worksheet { }` | El parser busca este bloque primero |
| `title:` es obligatorio | Error si no existe |
| Strings simples: sin comillas | `title: Hola mundo` |
| Strings con comillas: dobles | `title: "Hola mundo"` |
| Strings multilínea: triple comilla doble | `title: """línea 1\nlínea 2"""` |
| Listas: prefijo `- ` | Una entrada por línea, indentadas |
| Bloques anidados: `keyword { }` | Con llaves de apertura y cierre |
| Salto de línea: `\n` literal | Se convierte a salto real en el frontend |
| **Un campo por línea** | El parser lee línea por línea. Dos campos en la misma línea → el primero se traga el resto |
| Actividades aceptadas | Los **21** tipos de `SUPPORTED_BLOCKS` (ver §4). Un tipo desconocido se descarta en silencio |
| **Idioma del contenido: inglés** | Todo lo que el alumno lee/responde (oraciones, preguntas, opciones, `audio_text`) debe estar en inglés. `title`/`description`/`instructions` sí pueden ir en español |

### ⚠️ Regla de oro: UN CAMPO POR LÍNEA

`_get_scalar` busca `^\s*clave:\s*(.+)$` con `re.MULTILINE`: captura **hasta el fin de la línea**.
Si hay dos campos en la misma línea, el primero se lleva el texto del segundo y el segundo queda `None`.

```
❌ MAL — question y answer se pierden
listening { text: "The bus leaves at eight." question: "When?" answer: "at eight" }
   → text = 'The bus leaves at eight." question: "When?" answer: "at eight'
   → question = None, answer = None

✅ BIEN
listening {
  text: "The bus leaves at eight."
  question: "When?"
  answer: "at eight"
}
```

Excepción: un bloque con **un solo** campo sí funciona en una línea (`textbox { prompt: "..." }`),
pero conviene no depender de ello.

### Validación al guardar

Desde la revisión de julio 2026 el parser **valida** cada actividad antes de devolverla
(`_activity_problem` / `_validate` en `parser.py`) y lanza `WorksheetScriptError` con el número de
actividad y el motivo. Antes, estos casos se guardaban en silencio y el alumno se encontraba una
pregunta imposible:

| Detectado | Mensaje |
|-----------|---------|
| Campos en la misma línea | `falta 'question'` / `falta 'answer'` … |
| `matching` con lados desiguales | `'left' (3) y 'right' (2) deben tener el mismo número de elementos` |
| `dragdrop` con palabra fuera del banco | `'bank' no contiene ['goes']` |
| `fillblank` con menos `answer` que `_____` | `'text' tiene 2 huecos _____ pero 'answer' trae 1` |
| `answer` que no coincide con ninguna opción | `'answer' (c) no coincide con ninguna opción` |
| `listeningmatching` sin pares | `necesita bloques 'pair { audio_text: … match: … }'` |
| Actividad vacía (`speaking {}`, `content` sin html…) | `necesita 'prompt' … / falta 'html'` |

### Cómo el parser encuentra actividades

El parser escanea el cuerpo del worksheet (o de cada `block {}`) en orden secuencial, buscando cualquier `keyword {` donde `keyword` sea un tipo de actividad conocido. El orden en el JSON es el mismo orden en que aparecen en el script.

### Formato de listas (YAML-like)

```
options:
- Opción A
- Opción B
- Opción C
```

```
questions:
- ¿Qué hora es?
- ¿Dónde está?
```

Reglas de listas:
- La clave va en la línea anterior seguida de `:`
- Cada ítem en línea nueva con `- ` (guión + espacio)
- No hace falta indentación exacta, pero se recomienda consistencia
- Valores en listas pueden ir con o sin comillas

### Formato inline array para `answer`

```
answer: ["word1", "word2", "word3"]
```

O bien en formato lista YAML:
```
answer:
- word1
- word2
- word3
```

Ambos formatos son equivalentes y producen el mismo JSON.

---

## 4. Actividades

---

### 4.1 fillblank

**Descripción:** El estudiante escribe la(s) palabra(s) que faltan en una oración. El marcador `_____` (exactamente 5 guiones bajos) se reemplaza por un campo de texto inline.

**Cuándo usar:** Práctica de vocabulario, conjugaciones verbales, estructura gramatical.

**Calificación:** Automática — comparación exacta normalizada (sin distinguir mayúsculas/minúsculas, sin espacios extras). La IA puede corregir errores tipográficos menores.

---

#### Campos DSL

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `text` | string | Sí | Oración con `_____` como marcador de espacio |
| `answer` | string \| array | Sí | Respuesta(s) correcta(s), una por cada `_____` |
| `instructions` | string | No | Instrucción extra mostrada en caja ámbar |

---

#### JSON producido

```json
{
  "id": "uuid",
  "type": "fillblank",
  "text": "She _____ to school every day.",
  "answer": "goes",
  "instructions": null
}
```

---

#### Ejemplos DSL

**Un solo blank:**
```
fillblank {
  text: "She _____ to school every day."
  answer: "goes"
}
```

**Múltiples blanks — inline array:**
```
fillblank {
  text: "They _____ play football but they _____ study on Sundays."
  answer: ["don't", "must"]
}
```

**Múltiples blanks — lista YAML:**
```
fillblank {
  text: "I _____ born in 1990 and I _____ in Madrid."
  answer:
  - was
  - live
}
```

**Con salto de línea en el texto:**
```
fillblank {
  text: "Subject + _____ + verb (affirmative).\nSubject + _____ + not + verb (negative)."
  answer: ["will", "will"]
}
```

**Con instrucción extra:**
```
fillblank {
  text: "She _____ have to leave early yesterday."
  answer: "didn't"
  instructions: "Use the negative form of 'have to' in Past Simple."
}
```

---

#### JSON producido (múltiples blanks)

```json
{
  "id": "uuid",
  "type": "fillblank",
  "text": "They _____ play football but they _____ study on Sundays.",
  "answer": ["don't", "must"]
}
```

---

#### Cómo se renderiza

El renderer parte el campo `text` por `_____`. Cada parte se muestra como texto, y entre partes se inserta un `<input>`. El ancho del input se calcula automáticamente según la longitud esperada de la respuesta.

Si hay **un solo blank** (`parts.length === 2`): el valor enviado es un `string`.  
Si hay **múltiples blanks** (`parts.length > 2`): el valor enviado es un `string[]`.

---

#### Cómo se califica

```python
# Normalización: strip + lowercase
def _norm_answer(v): return str(v or "").strip().lower()

# Evaluación posicional
correct_answers = ["don't", "must"]
student_answers = ["dont", "Must"]
# → _norm_answer("dont") == "don't"  → FALSE → "incorrect"
# → _norm_answer("Must") == "must"   → TRUE
# Para ser "correct": TODOS los blanks deben ser correctos
```

> La IA revisa después y puede marcar como `"correct"` respuestas con typos menores (ej: "doesnt" → "doesn't").

---

#### Variaciones y casos de uso

| Uso | Ejemplo de `text` | `answer` |
|-----|-------------------|----------|
| Verb form | `"She _____ happy."` | `"is"` |
| Modal + base verb | `"You _____ study more."` | `"should"` |
| Sentence structure | `"Subject + _____ + verb"` | `"will"` |
| Multiple gaps | `"I _____ born in 1990 and _____ in Madrid."` | `["was", "live"]` |
| Negative form | `"They _____ have to go."` | `"didn't"` |
| Two-word answer | `"She _____ _____ to the doctor."` | `["had", "to"]` |
| Contractions | `"He _____ come tomorrow."` | `"won't"` |

---

### 4.2 multiplechoice

**Descripción:** El estudiante elige una opción correcta entre varias. Se muestra como botones de radio.

**Cuándo usar:** Test de comprensión, selección de forma correcta, vocabulario.

**Calificación:** Automática — comparación exacta del texto de la opción seleccionada.

---

#### Campos DSL

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `question` | string | Sí | La pregunta o enunciado |
| `options` | list | Sí | Lista de opciones (mínimo 2, máximo ilimitado) |
| `answer` | string | Sí | Debe coincidir exactamente con una de las `options` |
| `instructions` | string | No | Instrucción extra |

---

#### JSON producido

```json
{
  "id": "uuid",
  "type": "multiplechoice",
  "question": "Which sentence is correct?",
  "options": ["She go to school.", "She goes to school.", "She going to school."],
  "answer": "She goes to school."
}
```

---

#### Ejemplos DSL

**Básico:**
```
multiplechoice {
  question: "Which sentence uses the correct verb form?"
  options:
  - She go to school.
  - She goes to school.
  - She going to school.
  answer: "She goes to school."
}
```

**Selección de modal correcto:**
```
multiplechoice {
  question: "I _____ (ability) swim very well."
  options:
  - must
  - can
  - should
  - have to
  answer: "can"
}
```

**Con instrucciones:**
```
multiplechoice {
  question: "Choose the correct past form of 'go'."
  options:
  - goed
  - went
  - gone
  - go
  answer: "went"
  instructions: "Remember: 'go' is an irregular verb."
}
```

**Verdadero/Falso estilo multiplechoice:**
```
multiplechoice {
  question: "Present Simple uses 'did' in questions."
  options:
  - True
  - False
  answer: "False"
}
```

---

#### Cómo se califica

```python
is_correct = str(student_answer or "").strip().lower() == str(activity.answer).strip().lower()
```

El texto de la opción seleccionada se compara directamente con `answer`. Ambos se normalizan (strip + lowercase).

> **Importante:** El valor de `answer` DEBE ser exactamente igual (en texto limpio) a uno de los ítems de `options`. Si no coincide ninguna opción, nadie podrá responder correctamente.

---

#### Variaciones y usos

| Uso | Configuración típica |
|-----|---------------------|
| Corrección gramatical | 3-4 oraciones, solo una correcta |
| Selección de modal | 4 opciones (can, must, should, have to) |
| Vocabulario | "What does X mean?" + 3 definiciones |
| Comprensión lectora | Pregunta sobre texto leído + 3 opciones |
| Conjugación | 3-4 formas verbales |

---

### 4.3 textbox

**Descripción:** Respuesta abierta de texto largo. El estudiante escribe libremente. La IA califica según relevancia, contenido y gramática.

**Cuándo usar:** Producción escrita, respuestas de opinión, descripciones, redacciones cortas.

**Calificación:** `pending` → la IA la califica automáticamente al enviar.

---

#### Campos DSL

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `prompt` | string | Sí | La consigna de escritura |
| `instructions` | string | No | Instrucción extra |

---

#### JSON producido

```json
{
  "id": "uuid",
  "type": "textbox",
  "prompt": "Write three sentences about your last weekend using Past Simple."
}
```

---

#### Ejemplos DSL

**Básico:**
```
textbox {
  prompt: "Write three sentences about your last weekend using Past Simple."
}
```

**Con instrucciones:**
```
textbox {
  prompt: "Describe your ideal school. Use there is / there are and have to."
  instructions: "Write at least 4 sentences. Use vocabulary from this unit."
}
```

**Opinión:**
```
textbox {
  prompt: "Do you think students should have to wear a school uniform? Why or why not?"
}
```

**Multiparagraph prompt:**
```
textbox {
  prompt: "Write a short email to a friend.\nTell them about:\n- What you did last weekend\n- What you are going to do next week\n- Ask them a question"
}
```

---

#### Cómo se califica (IA)

La IA recibe:
- `prompt`: la consigna
- `student_answer`: lo que escribió el estudiante
- `correct_answer`: `null` (no hay respuesta correcta definida)

La IA evalúa relevancia, gramática y contenido, y devuelve `correct` o `incorrect` (el estado `partial` se eliminó del prompt: el matiz va en el comentario).

---

#### Variaciones y usos

| Uso | Prompt típico |
|-----|---------------|
| Producción libre | "Describe your house using there is/are." |
| Email/carta | "Write an email inviting a friend to your birthday party." |
| Opinión | "Should teenagers have smartphones at school? Discuss." |
| Narración | "Write a story about something that happened last year." |
| Instrucciones | "Explain how to make your favourite dish." |

---

### 4.4 matching

**Descripción:** El estudiante une cada ítem de la columna izquierda con su par de la derecha **trazando una línea** (arrastrando desde el punto o tocando uno de cada lado); cada par queda de un color. Los ítems de la derecha se muestran en orden aleatorio (determinístico por ID).

**Cuándo usar:** Vocabulario + definiciones, modales + significados, verbos irregulares + formas pasadas.

**Calificación:** Automática — comparación posicional: `left[0]` debe emparejar con `right[0]`, `left[1]` con `right[1]`, etc. **La IA puede rescatar pares**: la clave por índice no es la única combinación válida (ver §7).

---

#### Campos DSL

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `left` | list | Sí | Columna izquierda (palabras/frases) |
| `right` | list | Sí | Columna derecha (definiciones/pares) |
| `instructions` | string | No | Instrucción extra |

---

#### JSON producido

```json
{
  "id": "uuid",
  "type": "matching",
  "left": ["can", "must", "should", "don't have to"],
  "right": ["Ability", "Strong obligation", "Advice", "Not necessary"]
}
```

---

#### Ejemplos DSL

**Modales y significados:**
```
matching {
  left:
  - can
  - must
  - should
  - don't have to
  right:
  - Ability
  - Strong obligation
  - Advice
  - Not necessary
}
```

**Verbos irregulares:**
```
matching {
  left:
  - go
  - eat
  - write
  - take
  - speak
  right:
  - went
  - ate
  - wrote
  - took
  - spoke
}
```

**Vocabulario + definición:**
```
matching {
  left:
  - uniform
  - schedule
  - homework
  - principal
  right:
  - clothes you must wear at school
  - a plan showing times of activities
  - tasks given to students to do at home
  - the head teacher of a school
  instructions: "Match each word with its definition."
}
```

**Opuestos:**
```
matching {
  left:
  - hot
  - big
  - fast
  right:
  - cold
  - small
  - slow
}
```

---

#### Regla crítica: orden posicional

La calificación es **posicional**: `left[0]` es correcto con `right[0]`, `left[1]` con `right[1]`, etc.

```python
# En _build_answer_details():
for index, left_item in enumerate(activity.left):
    correct_match = activity.right[index]   # ← posición = par correcto
    selected_match = student_answers.get(left_item)
    is_correct = selected_match == correct_match
```

El frontend mezcla la columna derecha con un shuffle determinístico basado en el `activity.id`, por lo que el estudiante ve los pares desordenados pero la calificación sigue siendo posicional.

**El número de ítems en `left` y `right` DEBE ser igual.**

---

#### Respuesta del estudiante (formato JSON)

```json
{
  "activity-uuid": {
    "can": "Ability",
    "must": "Strong obligation",
    "should": "Advice",
    "don't have to": "Not necessary"
  }
}
```

---

### 4.5 reading

**Descripción:** Texto de lectura seguido de preguntas abiertas que el estudiante responde.

**Cuándo usar:** Comprensión lectora, textos narrativos o informativos.

> **Sin reproductor de audio** (julio 2026). Lo llevaba, pero leerle el texto en voz alta al alumno convierte una evaluación de comprensión **lectora** en una de comprensión **auditiva**. Para practicar escucha están los tipos `listening*`.

**Calificación:** Todas las preguntas son `pending` → la IA las califica en conjunto.

---

#### Campos DSL

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `title` | string | Sí | Título del texto |
| `content` | string | Sí | El texto de lectura. Usar `\n` para párrafos |
| `questions` | list | Sí | Lista de preguntas sobre el texto |
| `instructions` | string | No | Instrucción extra |

---

#### JSON producido

```json
{
  "id": "uuid",
  "type": "reading",
  "title": "School Rules",
  "content": "At our school, students have to wear a uniform every day.\nThey must arrive before 8:00 AM and cannot use mobile phones in class.\nHowever, they don't have to do homework on Fridays.",
  "questions": [
    "What time do students have to arrive?",
    "What can't students do in class?",
    "What don't students have to do on Fridays?"
  ]
}
```

---

#### Ejemplos DSL

**Básico:**
```
reading {
  title: "School Rules"
  content: "At our school, students have to wear a uniform every day.\nThey must arrive before 8:00 AM and cannot use mobile phones in class.\nHowever, they don't have to do homework on Fridays."
  questions:
  - What time do students have to arrive?
  - What can't students do in class?
  - What don't students have to do on Fridays?
}
```

**Texto más largo con párrafos:**
```
reading {
  title: "Life in the City"
  content: "Maria lives in a big city and works as a nurse at the central hospital.\nEvery morning she has to wake up at 5:30 AM to catch the bus.\nShe doesn't have to wear casual clothes — she wears a white uniform.\n\nAt the hospital, nurses have to check patients every hour.\nThey must also write reports and can't leave until their shift ends.\nMaria loves her job because she helps people every day."
  questions:
  - What is Maria's job?
  - What time does she have to wake up?
  - What does she wear at work?
  - What do nurses have to do every hour?
  - Why does Maria love her job?
  instructions: "Read the text carefully before answering."
}
```

---

#### Respuesta del estudiante (formato JSON)

Las respuestas de las preguntas se almacenan con el índice como clave:

```json
{
  "activity-uuid": {
    "0": "They have to arrive before 8:00 AM.",
    "1": "They can't use mobile phones.",
    "2": "They don't have to do homework."
  }
}
```

---

#### Cómo se califica

Cada pregunta individual **no tiene `correct_answer`** (es `null`). La IA evalúa considerando:
- El texto del `content` como referencia
- La pregunta del ítem `questions[i]`
- La respuesta del estudiante `answers[String(i)]`

---

### 4.6 imagequestion

**Descripción:** Muestra una imagen y pide al estudiante que la describa o responda una pregunta sobre ella. Es una `textbox` con imagen encima.

**Cuándo usar:** Descripción de imágenes, uso de Present Continuous, vocabulario visual, expresión escrita motivada por imagen.

**Calificación:** `pending` → IA califica.

---

#### Campos DSL

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `image` | string (URL) | Sí | URL directa de la imagen |
| `prompt` | string | Sí | Pregunta o consigna sobre la imagen |
| `instructions` | string | No | Instrucción extra |

---

#### JSON producido

```json
{
  "id": "uuid",
  "type": "imagequestion",
  "image": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800",
  "prompt": "Describe what you see in this picture. Use Present Continuous and adjectives."
}
```

---

#### Ejemplos DSL

**Básico:**
```
imagequestion {
  image: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800"
  prompt: "Describe what you see in this picture."
}
```

**Con gramática específica:**
```
imagequestion {
  image: "https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=800"
  prompt: "Look at the picture. What is the person doing? Use Present Continuous and at least 3 adjectives."
  instructions: "Write at least 3 sentences."
}
```

**Comparación:**
```
imagequestion {
  image: "https://images.unsplash.com/photo-1516912481808-3406841bd33c?w=800"
  prompt: "Describe the weather and landscape in this image. What season is it? How do you know?"
}
```

---

#### URLs recomendadas

Usar URLs de Unsplash con parámetro `?w=800` para tamaño fijo:

```
https://images.unsplash.com/photo-{ID}?w=800&auto=format&q=80
```

Ver la **Biblioteca de Imágenes** en el panel del profesor para copiar URLs listas para usar.

---

#### Cómo se renderiza

La imagen se muestra en un `<img>` con `object-cover h-56 w-full rounded-2xl`. Debajo aparece un `<textarea>` para la respuesta.

---

### 4.6b imagechoice

**Descripción:** Opción múltiple con imagen. Admite una imagen de enunciado, una imagen por opción, o
las dos. Es un `multiplechoice` en todo lo demás.

**Cuándo usar:** Vocabulario visual («¿cuál es la manzana?»), comprensión de una escena con opciones
de texto, discriminación de objetos.

**Calificación:** Automática y **idéntica a `multiplechoice`** — la clave es el **texto** de la opción.

---

#### Campos DSL

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `question` | string | Sí | La pregunta |
| `options` | lista | Sí (≥2) | Las opciones **en texto**: esto es la clave de respuestas |
| `answer` | string | Sí | Debe coincidir **exacto** con una de `options` |
| `image` | string (URL) | No | Imagen del enunciado, encima de las opciones |
| `option_images` | lista (URL) | No | Una URL **por opción, paralela a `options`** por índice |
| `instructions` / `note` | string | No | Instrucción extra / nota privada para la IA |

- `option_images` **no puede ser más larga que `options`** (el parser lo rechaza). Más corta sí: esas
  opciones se pintan como texto.
- Una entrada vacía (`- ""`) deja esa opción concreta en texto.
- **La opción que tiene imagen se muestra SOLO como imagen**; su texto viaja como `alt`. Si se
  mostrara, «¿cuál es la manzana?» se respondería leyendo.

---

#### Ejemplos DSL

**Elegir entre imágenes:**
```
imagechoice {
  question: "Which one is the apple?"
  options:
  - apple
  - banana
  option_images:
  - https://res.cloudinary.com/.../apple.png
  - https://res.cloudinary.com/.../banana.png
  answer: "apple"
}
```

**Una escena + opciones de texto:**
```
imagechoice {
  image: "https://res.cloudinary.com/.../park.png"
  question: "Where are the children playing?"
  options:
  - in the park
  - at school
  - at home
  answer: "in the park"
}
```

**En papel:** el enunciado, la imagen de enunciado si la hay, y las opciones como `A) B) C)` con la
miniatura dentro de cada opción.

---

### 4.6c imagematching

**Descripción:** Emparejar cada **imagen** con su palabra. Misma mecánica que `matching` (se une
arrastrando o tocando un elemento de cada lado); solo cambia lo que se pinta a la izquierda.

**Cuándo usar:** Vocabulario visual tipo flashcards, objetos/animales/acciones con su nombre.

**Calificación:** Automática **par a par, igual que `matching`**, y con el mismo rescate por IA
(la clave por índice no siempre es la única combinación válida).

---

#### Campos DSL

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `left_images` | lista (URL) | Sí (≥2) | Una imagen por fila |
| `right` | lista | Sí | La palabra que corresponde a `left_images[i]`, mismo orden y misma cantidad |
| `left` | lista | No | Etiqueta de cada fila. **Si falta, se numeran `Image 1`, `Image 2`…** |
| `instructions` / `note` | string | No | Instrucción extra / nota privada para la IA |

`left` no se le muestra al alumno: es la clave con la que el profesor lee la corrección
(`Image 1 → dog`). Existe para que la pantalla de revisión no enseñe una URL de 90 caracteres.

---

#### Ejemplo DSL

```
imagematching {
  left_images:
  - https://res.cloudinary.com/.../dog.png
  - https://res.cloudinary.com/.../cat.png
  right:
  - dog
  - cat
}
```

**En papel:** la misma tabla de dos columnas de `matching` — a la izquierda `1.` + línea + miniatura;
a la derecha `A) B) C)` con las palabras barajadas.

---

### 4.7 listening

**Descripción:** El estudiante escucha una oración (generada por TTS) y responde una pregunta abierta sobre ella. La oración **nunca se muestra** al estudiante.

**Cuándo usar:** Comprensión auditiva simple, práctica de dictado parcial, reconocimiento de estructuras.

**Calificación:** Automática por comparación exacta del campo `answer`. La IA puede flexibilizar.

---

#### ⚠️ CAMPO CRÍTICO: `text` (NO `audio_text`)

A diferencia de todos los demás tipos listening que usan `audio_text`, este tipo usa **`text`** para la oración que lee el TTS.

---

#### Campos DSL

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `text` | string | Sí | Oración que el TTS leerá. **OCULTA** al estudiante |
| `question` | string | Sí | Pregunta que el estudiante ve y responde |
| `answer` | string | Sí | Respuesta correcta esperada |
| `instructions` | string | No | Instrucción extra |

---

#### JSON producido

```json
{
  "id": "uuid",
  "type": "listening",
  "text": "She had to stay late at the office because her boss needed the report.",
  "question": "Why did she have to stay late?",
  "answer": "Because her boss needed the report."
}
```

---

#### Ejemplos DSL

**Básico:**
```
listening {
  text: "She had to stay late at the office because her boss needed the report."
  question: "Why did she have to stay late?"
  answer: "Because her boss needed the report."
}
```

**Respuesta corta:**
```
listening {
  text: "Tom didn't have to go to school on Saturday."
  question: "Did Tom have to go to school on Saturday?"
  answer: "No, he didn't."
}
```

**Con instrucción:**
```
listening {
  text: "They had to cancel the match because it was raining heavily."
  question: "Why did they cancel the match?"
  answer: "Because it was raining heavily."
  instructions: "Listen carefully and answer in a complete sentence."
}
```

---

#### Cómo se califica

```python
is_correct = str(student_answer).strip().lower() == str(activity.answer).strip().lower()
```

Comparación directa. La IA puede corregir formulaciones alternativas correctas marcándolas como `correct`.

---

### 4.8 listeningfillblank

**Descripción:** El estudiante escucha una oración por TTS y completa los espacios en blanco de una versión parcial de esa oración. Los blancos son `_____` inline.

**Cuándo usar:** Dictado parcial, identificación de palabras clave, práctica de forma + sonido.

**Calificación:** Automática — igual que `fillblank`.

---

#### Campos DSL

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `audio_text` | string | Sí | Texto COMPLETO que el TTS leerá. **OCULTO** al estudiante |
| `text` | string | Sí | Versión con `_____` que el estudiante VE |
| `answer` | string \| array | Sí | Respuesta(s) correcta(s) |
| `instructions` | string | No | Instrucción extra |

---

#### JSON producido

```json
{
  "id": "uuid",
  "type": "listeningfillblank",
  "audio_text": "Tom didn't have to wear a uniform at his new school.",
  "text": "Tom _____ wear a uniform at his new school.",
  "answer": "didn't have to"
}
```

---

#### Ejemplos DSL

**Un blank:**
```
listeningfillblank {
  audio_text: "Tom didn't have to wear a uniform at his new school."
  text: "Tom _____ wear a uniform at his new school."
  answer: "didn't have to"
}
```

**Múltiples blanks:**
```
listeningfillblank {
  audio_text: "Where did they have to go for the school trip?"
  text: "Where _____ they _____ go for the school trip?"
  answer: ["did", "have to"]
}
```

**Forma afirmativa:**
```
listeningfillblank {
  audio_text: "She had to wake up at six o'clock every morning."
  text: "She _____ wake up at six o'clock every morning."
  answer: "had to"
}
```

**Múltiples gaps complejos:**
```
listeningfillblank {
  audio_text: "You don't have to bring your laptop but you must have your notebook."
  text: "You _____ bring your laptop but you _____ have your notebook."
  answer: ["don't have to", "must"]
}
```

---

#### Regla clave: `audio_text` vs `text`

```
audio_text: "She didn't have to buy tickets because they were free."
             ↑ Lo que el TTS lee en voz alta. El estudiante NO lo ve.

text: "She _____ buy tickets because they were _____."
       ↑ Lo que el estudiante SÍ ve. Con los blanks a llenar.
```

Los campos no necesitan ser idénticos con blancos; pueden diferir en cualquier parte.

---

### 4.9 listeningmultiplechoice

**Descripción:** El estudiante escucha una oración/situación por TTS y luego elige la respuesta correcta entre varias opciones.

**Cuándo usar:** Comprensión auditiva con opciones, inferencia de significado, comprensión de contexto.

**Calificación:** Automática — igual que `multiplechoice`.

---

#### Campos DSL

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `audio_text` | string | Sí | Texto que el TTS leerá. **OCULTO** |
| `question` | string | Sí | Pregunta que el estudiante ve |
| `options` | list | Sí | Opciones de respuesta |
| `answer` | string | Sí | Debe coincidir exactamente con una opción |
| `instructions` | string | No | Instrucción extra |

---

#### JSON producido

```json
{
  "id": "uuid",
  "type": "listeningmultiplechoice",
  "audio_text": "Yesterday I had to wake up at 5 AM because my flight was very early.",
  "question": "Why did she have to wake up so early?",
  "options": [
    "Because her flight was early.",
    "Because she had an exam.",
    "Because she starts work at 5 AM."
  ],
  "answer": "Because her flight was early."
}
```

---

#### Ejemplos DSL

**Básico:**
```
listeningmultiplechoice {
  audio_text: "Yesterday I had to wake up at 5 AM because my flight was very early."
  question: "Why did she have to wake up so early?"
  options:
  - Because her flight was early.
  - Because she had an exam.
  - Because she starts work at 5 AM.
  answer: "Because her flight was early."
}
```

**Comprensión de modal:**
```
listeningmultiplechoice {
  audio_text: "You should eat more vegetables and drink plenty of water."
  question: "What kind of obligation does 'should' express here?"
  options:
  - Strong obligation
  - Advice or recommendation
  - Ability
  - Prohibition
  answer: "Advice or recommendation"
}
```

**Con instrucción:**
```
listeningmultiplechoice {
  audio_text: "At the hospital, nurses must wash their hands before and after seeing each patient."
  question: "What is this rule about?"
  options:
  - Optional hygiene suggestion
  - A strong rule about hygiene
  - A recommendation from patients
  answer: "A strong rule about hygiene"
  instructions: "Listen and choose the best answer."
}
```

---

### 4.10 listeningmatching

**Descripción:** El estudiante escucha N audios independientes (uno por par) y para cada uno elige la categoría/etiqueta correcta de un dropdown. Todos los dropdowns comparten el mismo conjunto de opciones.

**Cuándo usar:** Identificar formas (afirmativa/negativa/pregunta), categorizar estructuras gramaticales, asociar audio con significado.

**Calificación:** Automática — cada par calificado independientemente.

---

#### Sintaxis de los pares: `pair {}` (canónico) o lista `pairs:`

El formato canónico son bloques `pair { }`. Desde julio 2026 `_parse_pairs` **también** acepta la
lista `pairs:` — que es la que emite `dslSerializer.ts` y la que la IA escribe por costumbre YAML.
Antes se ignoraba en silencio, así que crear una `listeningmatching` en el constructor visual y
guardarla destruía la actividad (quedaba sin pares).

```
✅ Canónico:
pair {
  audio_text: "She had to go."
  match: "Affirmative"
}

✅ También válido (lo que emite el constructor visual):
pairs:
- audio_text: "She had to go."
  match: "Affirmative"
```

---

#### Campos DSL

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `pair {}` (bloques) | block | Sí | Uno o más bloques, cada uno con `audio_text` y `match` |
| `pair.audio_text` | string | Sí | Texto que el TTS leerá para este par |
| `pair.match` | string | Sí | La etiqueta/categoría correcta para este audio |
| `options` | list | Sí | Lista plana de todas las etiquetas posibles (sin repetir) |
| `instructions` | string | No | Instrucción extra |

---

#### JSON producido

```json
{
  "id": "uuid",
  "type": "listeningmatching",
  "pairs": [
    { "audio_text": "She had to call the doctor.", "match": "Affirmative" },
    { "audio_text": "We didn't have to bring books.", "match": "Negative" },
    { "audio_text": "Did he have to work Saturday?", "match": "Yes/No Question" },
    { "audio_text": "Why did she have to leave?", "match": "Wh-Question" }
  ],
  "options": ["Affirmative", "Negative", "Yes/No Question", "Wh-Question"]
}
```

---

#### Ejemplos DSL

**4 formas de una estructura gramatical:**
```
listeningmatching {
  pair {
    audio_text: "She had to call the doctor last night."
    match: "Affirmative"
  }
  pair {
    audio_text: "We didn't have to bring our books."
    match: "Negative"
  }
  pair {
    audio_text: "Did he have to work on Saturday?"
    match: "Yes/No Question"
  }
  pair {
    audio_text: "Why did she have to leave so early?"
    match: "Wh-Question"
  }
  options:
  - Affirmative
  - Negative
  - Yes/No Question
  - Wh-Question
}
```

**Modales con significado:**
```
listeningmatching {
  pair {
    audio_text: "You can swim really well."
    match: "Ability"
  }
  pair {
    audio_text: "You must finish your homework now."
    match: "Strong obligation"
  }
  pair {
    audio_text: "You should get more sleep."
    match: "Advice"
  }
  pair {
    audio_text: "You don't have to come if you don't want to."
    match: "No obligation"
  }
  options:
  - Ability
  - Strong obligation
  - Advice
  - No obligation
  instructions: "Listen to each sentence and select the meaning of the modal verb."
}
```

---

#### Respuesta del estudiante (formato JSON)

```json
{
  "activity-uuid": {
    "0": "Affirmative",
    "1": "Negative",
    "2": "Yes/No Question",
    "3": "Wh-Question"
  }
}
```

Las claves son índices de posición del par (string "0", "1", etc.).

---

#### Cómo se califica

```python
for index, pair in enumerate(activity.pairs):
    correct_match = pair.get("match")        # "Affirmative"
    selected_match = student_answer.get(str(index))  # lo que eligió
    is_correct = selected_match == correct_match
```

Cada par se evalúa como un detalle separado con `activity_id = f"{uuid}:{index}"`.

---

### 4.11 listeningtruefalse

**Descripción:** El estudiante escucha un audio (puede ser una oración o un párrafo completo) y luego decide si cada enunciado es Verdadero o Falso.

**Cuándo usar:** Comprensión auditiva detallada, verificación de comprensión de un texto escuchado.

**Calificación:** Automática — comparación de booleanos.

---

#### Campos DSL

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `audio_text` | string | Sí | Texto completo que el TTS leerá (puede ser largo). **OCULTO** |
| `statements` | list | Sí | Enunciados a evaluar (formato `- texto \| true/false`) |
| `instructions` | string | No | Instrucción extra |

---

#### Formato de `statements`

```
statements:
- Enunciado 1. | true
- Enunciado 2. | false
- Enunciado 3. | true
```

Reglas:
- Cada línea comienza con `- `
- El texto y el valor se separan con ` | ` (espacio, pipe, espacio)
- El valor es `true` o `false` (minúsculas)
- Si no hay `|`, el valor por defecto es `true`

---

#### JSON producido

```json
{
  "id": "uuid",
  "type": "listeningtruefalse",
  "audio_text": "Last week Anna had a job interview. She had to wear formal clothes and arrive at 9 AM. She didn't have to bring a portfolio.",
  "statements": [
    { "text": "Anna had to wear formal clothes.", "answer": true },
    { "text": "Anna had to bring a portfolio.", "answer": false },
    { "text": "Anna had to arrive at 10 AM.", "answer": false }
  ]
}
```

---

#### Ejemplos DSL

**Básico:**
```
listeningtruefalse {
  audio_text: "Last week Anna had a job interview. She had to wear formal clothes and arrive at 9 AM. She didn't have to bring a portfolio, but she had to answer many questions about her experience."
  statements:
  - Anna had to wear formal clothes. | true
  - Anna had to bring a portfolio. | false
  - Anna had to arrive at 10 AM. | false
  - Anna answered questions about her experience. | true
}
```

**Oraciones simples:**
```
listeningtruefalse {
  audio_text: "Students at this school have to wear a uniform and must arrive before 8 AM. They don't have to do homework on Fridays."
  statements:
  - Students have to wear a uniform. | true
  - Students have to arrive after 9 AM. | false
  - Students can do homework on Fridays. | true
  instructions: "Listen to the audio and decide if each statement is true or false."
}
```

---

#### Cómo se califica

```python
for index, statement in enumerate(activity.statements):
    correct = statement.get("answer")  # True (bool)
    raw = student_answer.get(str(index))  # "true" (string)
    student_bool = raw.lower() == "true" if isinstance(raw, str) else raw
    is_correct = student_bool == correct
```

---

### 4.12 truefalse

**Descripción:** Igual que `listeningtruefalse` pero sin audio. El estudiante lee los enunciados y decide Verdadero o Falso.

**Cuándo usar:** Verificación de comprensión de gramática, cultura, conceptos del tema.

**Calificación:** Automática — igual que `listeningtruefalse`.

---

#### Campos DSL

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `statements` | list | Sí | Enunciados (formato `- texto \| true/false`) |
| `instructions` | string | No | Instrucción extra |

---

#### Formatos de `statements` aceptados

**Formato 1 — Lista (recomendado):**
```
statements:
- We use 'goes' with he/she/it. | true
- 'Eaten' is the past simple of 'eat'. | false
- Modal verbs are followed by the base form. | true
```

**Formato 2 — Bloques `statement {}`:**
```
statement {
  text: "We use 'goes' with he/she/it."
  answer: true
}
statement {
  text: "'Eaten' is the past simple of 'eat'."
  answer: false
}
```

Ambos formatos producen el mismo JSON. Se recomienda el formato lista por ser más compacto.

---

#### JSON producido

```json
{
  "id": "uuid",
  "type": "truefalse",
  "statements": [
    { "text": "We use 'goes' with he/she/it.", "answer": true },
    { "text": "'Eaten' is the past simple of 'eat'.", "answer": false },
    { "text": "Modal verbs are followed by the base form.", "answer": true }
  ]
}
```

---

#### Ejemplos DSL

**Gramática:**
```
truefalse {
  statements:
  - We use 'goes' with he/she/it. | true
  - 'Eaten' is the past simple of 'eat'. | false
  - Modal verbs are followed by the base form. | true
  - 'Can' is followed by 'to' + infinitive. | false
  - 'Must' and 'have to' can express obligation. | true
  instructions: "Decide if each statement is True or False based on the grammar rules studied."
}
```

**Vocabulario:**
```
truefalse {
  statements:
  - A 'principal' is the head teacher of a school. | true
  - 'Homework' means work you do during school hours. | false
  - A 'schedule' is a plan showing times of activities. | true
}
```

---

### 4.13 readingtruefalse

**Descripción:** El estudiante lee un texto y luego responde Verdadero o Falso a una lista de enunciados sobre el texto. **Sin reproductor de audio**, por lo mismo que `reading` (§4.5).

**Cuándo usar:** Comprensión lectora con verificación objetiva, textos con detalles específicos.

**Calificación:** Automática — igual que `truefalse`.

---

#### Campos DSL

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `title` | string | Sí | Título del texto |
| `content` | string | Sí | Texto de lectura |
| `statements` | list | Sí | Enunciados a evaluar |
| `instructions` | string | No | Instrucción extra |

---

#### JSON producido

```json
{
  "id": "uuid",
  "type": "readingtruefalse",
  "title": "Life at School",
  "content": "At Lincoln School, students have to wear a blue uniform every day...",
  "statements": [
    { "text": "Students wear a blue uniform.", "answer": true },
    { "text": "Students don't have to be punctual.", "answer": false }
  ]
}
```

---

#### Ejemplo DSL

```
readingtruefalse {
  title: "Rules at Lincoln School"
  content: "At Lincoln School, students have to wear a blue uniform every day.\nThey must arrive before 8:30 AM and cannot use their phones in class.\nStudents don't have to bring lunch because the school has a cafeteria.\nHowever, they must participate in at least one sport per week."
  statements:
  - Students wear a blue uniform. | true
  - Students must arrive after 9 AM. | false
  - Students can use phones in class. | false
  - The school has a cafeteria. | true
  - Students must do sport once a week. | true
  instructions: "Read the text carefully, then decide if each statement is True or False."
}
```

---

### 4.14 multiselect

**Descripción:** Como `multiplechoice` pero con **varias** respuestas correctas. Se renderiza con casillas y el aviso "Puedes elegir más de una opción."

**Cuándo usar:** Clasificar (¿cuáles de estos son verbos?), identificar todos los casos que cumplen una regla.

**Calificación:** Automática por **conjunto exacto** — `set(elegidas) == set(correctas)`. Todo o nada: una marca de más o de menos invalida el ítem.

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `question` | string | Sí | Enunciado |
| `options` | list | Sí | Mínimo 2 |
| `answer` | list | Sí | TODAS las correctas; cada una debe estar en `options` |

```
multiselect {
  question: "Select all the verbs in the simple present."
  options:
  - runs
  - running
  - eats
  - eaten
  answer: ["runs", "eats"]
}
```

**Límite pedagógico:** al ser todo-o-nada, 2–3 correctas de 4–5 opciones es lo razonable. Con 6+ opciones la probabilidad de acertar el conjunto completo se desploma y deja de medir conocimiento.

Respuesta del alumno: `{ "activity-uuid": ["runs", "eats"] }`

---

### 4.15 dragdrop

**Descripción:** Oración con huecos `_____` + banco de palabras arrastrables. Se puede arrastrar o **tocar** una palabra para colocarla en el siguiente hueco vacío (click-to-place). Tocar un hueco lleno lo vacía.

**Cuándo usar:** Misma práctica que `fillblank` pero sin exigir producción escrita — útil en A1/A2 y en móvil.

**Calificación:** Automática posicional, igual que `fillblank`.

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `text` | string | Sí | Oración con `_____` (mínimo uno) |
| `answer` | list | Sí | Palabra correcta por hueco, en orden. Debe haber **exactamente** una por `_____` |
| `bank` | list | Sí | Palabras arrastrables: las correctas + distractores. **Toda palabra de `answer` debe estar aquí** |

```
dragdrop {
  text: "She _____ to school and _____ English every day."
  answer: ["goes", "studies"]
  bank:
  - goes
  - go
  - studies
  - study
}
```

El banco se baraja de forma determinista por `activity.id` (`shuffledByHash`), así que el orden en el DSL no delata nada. Si `bank` no contiene una palabra de `answer`, el parser **rechaza la hoja** (antes el alumno simplemente no podía responder).

---

### 4.16 speaking

> La nota histórica "speaking NO IMPLEMENTADO / PROHIBIDA" está **obsoleta**. Está implementado en sus dos modos.

**Descripción:** Graba con el micrófono y transcribe con Groq Whisper (`POST /public/transcribe`). Si no hay micrófono o falla el permiso, aparece un campo de texto de respaldo.

**Dos modos según haya `target`:**

| Modo | Campos | Qué evalúa | Calificación |
|------|--------|-----------|-------------|
| Leer en voz alta | `target` (+ `prompt` opcional) | Pronunciación / lectura | Auto: similitud por subsecuencia común (LCS→Dice) ≥ **0.85** |
| Pregunta hablada | `prompt` (sin `target`) | Contenido y gramática de lo dicho | `pending` → IA |

```
speaking {
  prompt: "Read the sentence aloud."
  target: "She goes to school every day."
}

speaking {
  prompt: "What do you usually do on weekends?"
}
```

Con `target` el alumno ve la oración, un botón 🔊 para escucharla y, tras grabar, **cada palabra pintada en verde o rojo** (`speakingWordStatus`) para saber qué repetir.

**Límites:** nunca evalúa ortografía (la respuesta es una transcripción). Con `target`, menos de ~12 palabras. **No pasa a papel**: `WorksheetPrint` omite `speaking` y todos los `listening*`.

---

### 4.17 listeningorder

**Descripción:** Estilo Duolingo. Audio TTS oculto + fichas desordenadas que el alumno toca para armar la oración en el renglón de respuesta. Tocar una ficha ya colocada la devuelve al banco.

**Calificación:** Automática por **orden exacto** (misma longitud y misma palabra en cada posición).

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `audio_text` | string | Sí | Oración que lee el TTS. **OCULTA** |
| `answer` | list | Sí | Las fichas en el orden correcto (mínimo 2) |
| `bank` | list | No | Fichas desordenadas. Si falta, el front baraja `answer` |
| `voice` | string | No | `male` / `female` |
| `rate` | string | No | `very slow` / `slow` (por defecto) / `normal`, o un `±NN%` |

```
listeningorder {
  audio_text: "She has never been to Paris."
  voice: female
  answer:
  - She
  - has
  - never
  - been
  - to
  - Paris
  bank:
  - Paris
  - She
  - to
  - has
  - been
  - never
}
```

**Límite:** al corregir por orden exacto, la oración debe tener **un solo** orden válido. Evitar adverbios movibles (`Yesterday she went` / `She went yesterday`) y palabras repetidas.

---

### 4.18 conversation

**Descripción:** Diálogo a dos voces. Cada turno (`- m:` masculino, `- f:` femenino) se sintetiza con su voz y los MP3 se **concatenan en una sola pista** (`GET /tts/conversation`). Luego una pregunta sobre el diálogo.

**Calificación:** con `answer` → automática por comparación de texto (la IA la re-juzga si falla); sin `answer` → `pending` → IA.

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `lines` | list | Sí | Mínimo 2 turnos, formato `- f: "texto"` / `- m: "texto"` |
| `question` | string | Sí | Pregunta sobre el diálogo |
| `answer` | string | No | Con ella auto-califica; sin ella queda abierta |
| `male_voice` | string | No | Voz del hablante masculino: alias `male` o nombre literal de edge-tts (ej. `en-US-RogerNeural`) |
| `female_voice` | string | No | Voz del hablante femenino: alias `female` o nombre literal de edge-tts (ej. `en-US-AnaNeural`) |

```
conversation {
  lines:
  - f: "Hi, are you new here?"
  - m: "Yes, I started today."
  - f: "Welcome! Where are you from?"
  female_voice: en-US-AnaNeural
  question: "When did he start?"
  answer: "today"
}
```

`speaker` se normaliza: empieza por `f` → `female`, cualquier otra cosa → `male`.

**Voces por hablante:** sin `male_voice`/`female_voice` cada hablante usa la voz curada de su género
(`male` → `en-US-AndrewNeural`, `female` → `en-US-AriaNeural`). Un alias del género se traduce a la
voz curada correspondiente (se puede cruzar a propósito, p. ej. `male_voice: female`); un nombre
literal pasa tal cual y llega al SSML validado contra inyección (`_tts_voice`) y contra el listado
real del endpoint de edge-tts (`_check_voice_exists`). Para diálogos entre niños las voces son
**siempre Ana y Roger** — las únicas infantiles de la lista curada: `en-US-AnaNeural` (niña) y
`en-US-RogerNeural` (niño, al que el backend le sube el tono +35Hz para que suene a niño). Otras
voces infantiles del catálogo de Azure (`en-US-MichelleNeural`, `en-GB-MaisieNeural`,
`en-GB-LibbyNeural`) solo se pueden usar por nombre literal en el DSL y el endpoint de Edge no
sirve todas (p. ej. `en-GB-OliverNeural` falla la síntesis). El constructor visual ofrece las 8
curadas en un selector por hablante; un nombre fuera de la lista se escribe a mano en el DSL.

**Límite:** la concatenación es de frames MP3 crudos, sin silencio intermedio: los turnos suenan casi seguidos. 3–6 turnos cortos. Si hiciera falta pausa marcada, habría que intercalar un MP3 de silencio.

---

### 4.19 content

**Descripción:** Bloque informativo de **solo lectura** para repasar el tema antes de los ejercicios. Se renderiza como mini-página HTML.

**Calificación:** **ninguna**. `_build_answer_details` hace `continue`: no entra en el score, no cuenta como actividad, no lleva cabecera "Actividad N" ni badge "Interactiva".

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `title` | string | No | Encabezado de la tarjeta |
| `html` | string | Sí | HTML, normalmente multilínea con `"""…"""` |
| `sandbox` | bool | No | `true` → iframe aislado con el HTML completo |

**Dos modos de render:**

| Modo | Cómo | Para qué |
|------|------|---------|
| Por defecto | Saneado inline con **DOMPurify** (`InlineContent`) — bloquea `<script>`, `onclick`, `javascript:` | Repaso normal; hereda el tema y se imprime |
| `sandbox: true` | `<iframe sandbox="allow-scripts">` sin `allow-same-origin` (`SandboxedHtml`) | CSS/JS/fuentes propios sin filtrarse a la app |

Ambos se muestran en un recuadro de altura acotada (560 px) con scroll interno y aviso `ScrollHint`. Al **imprimir** siempre se usa la versión saneada.

```
content {
  title: "Repaso: Present Simple"
  html: """
  <h2>Present Simple</h2>
  <p>Se usa para rutinas y hechos. Tercera persona (he/she/it): verbo + <b>s</b>.</p>
  <p>Negativo: don't / doesn't + verbo base. Pregunta: Do / Does + sujeto + verbo base.</p>
  <p><b>Error típico:</b> "She go" → lo correcto es "She goes".</p>
  """
}
```

Las llaves de `<style>`, `<script>` y `@keyframes` **no** rompen el parseo: `_matching_brace` salta el contenido entre `"""`.

**Regla pedagógica (la que más se incumple):** el `content` sirve para **recordar la regla**, no para resolver la hoja. Sus oraciones de ejemplo no pueden ser las de los ejercicios y no pueden contener ninguna respuesta. Debe traer: la regla en 1–2 líneas, la forma (afirmativa / negativa / pregunta), 2–3 ejemplos y el error típico.

Es **opcional**: se añade cuando el profesor pide repaso/teoría o cuando el alumno ve el tema por primera vez.

---

## 5. Sistema de bloques — block {}

Los bloques agrupan actividades con un título de sección y una instrucción general. Son opcionales: una hoja puede tener todas las actividades al nivel raíz o todas dentro de bloques.

### Cuándo usar bloques

- Hojas con múltiples secciones temáticas ("Part 1: Grammar", "Part 2: Listening")
- Para dar instrucciones generales a un grupo de actividades
- Para organizar visualmente la hoja

### Sintaxis

```
worksheet {
  title: "..."

  block {
    title: "Part 1: Vocabulary"
    instructions: "Match the words with their meanings."
    matching { ... }
    truefalse { ... }
  }

  block {
    title: "Part 2: Listening"
    instructions: "Listen carefully and complete the activities."
    listeningfillblank { ... }
    listeningmultiplechoice { ... }
  }

  block {
    title: "Part 3: Writing"
    textbox { ... }
  }
}
```

### JSON producido con bloques

```json
{
  "title": "...",
  "description": "...",
  "activities": [],
  "blocks": [
    {
      "title": "Part 1: Vocabulary",
      "instructions": "Match the words with their meanings.",
      "activities": [
        { "id": "uuid", "type": "matching", ... },
        { "id": "uuid", "type": "truefalse", ... }
      ]
    },
    {
      "title": "Part 2: Listening",
      "instructions": "Listen carefully and complete the activities.",
      "lines": [
        { "speaker": "female", "text": "Hi! What is your name?" },
        { "speaker": "male", "text": "My name is Tom." }
      ],
      "activities": [
        { "id": "uuid", "type": "multiplechoice", ... },
        { "id": "uuid", "type": "truefalse", ... }
      ]
    }
  ]
}
```

Los campos del estímulo (`text`, `audio_text`, `lines`, `voice`) solo aparecen si el bloque los
lleva. En el front se normalizan a `text` / `audioText` / `lines` / `voice` (`api.ts`).

### Comportamiento del frontend

```tsx
// WorksheetRenderer.tsx
const blocks = worksheet.blocks?.length
  ? worksheet.blocks
  : [{ title: null, instructions: null, activities: worksheet.activities }];
```

Si no hay `blocks`, crea un bloque ficticio con todas las actividades. **La retrocompatibilidad está garantizada.**

### ⚠️ `block {}` es TODO O NADA

Si la hoja tiene **al menos un** `block {}`, el parser conserva **solo** las actividades que estén
dentro de un block y **descarta en silencio** las que queden fuera. No hay error: la actividad
simplemente desaparece de la hoja.

Hay exactamente dos formas válidas, nunca mezcladas:

1. **Sin ningún `block {}`** → todas las actividades cuelgan directamente de `worksheet { }`.
2. **Con al menos un `block {}`** → **TODAS** las actividades van dentro de algún block, incluido el
   `content` de repaso. Si algo no encaja en una sección existente, dale su propio block.

Es el error clásico de la IA: dejaba el `content` de repaso fuera de los bloques y desaparecía sin
avisar. La regla está marcada como CRITICAL en `_WORKSHEET_SYSTEM` (`ai.py`) y en `GENERATION_PROMPT`.

### Estímulo compartido: un audio o un texto, varias preguntas

Un `block {}` puede llevar **un** estímulo propio. Se pinta **una sola vez** arriba del bloque y
**todas** sus actividades —de cualquier tipo— preguntan sobre él.

| Campo del bloque | Qué es | Lo ve el alumno |
|------------------|--------|-----------------|
| `lines:` | Conversación a dos voces (`- f:` / `- m:`), fusionada en **una sola pista** | No: solo la oye |
| `male_voice:` / `female_voice:` | Voz de cada hablante de `lines` (alias de género o nombre edge-tts; sin ellos, la curada de su género) | — |
| `audio_text:` | Un audio TTS (con `voice: male` / `voice: female` opcional) | No: solo lo oye |
| `rate:` | Velocidad del audio del bloque (`very slow` / `slow` / `normal`), vale con `lines` y con `audio_text` | — |
| `text:` | Un texto de lectura | Sí |

```
block {
  title: "Part 1: Listening"
  instructions: "Listen to the conversation and answer the questions."
  lines:
  - f: "Hi! What is your name?"
  - m: "My name is Tom. I am seven."
  female_voice: en-US-AnaNeural
  male_voice: en-US-RogerNeural

  multiplechoice {
    question: "What is the boy's name?"
    options:
    - Tom
    - Sam
    answer: "Tom"
  }
  truefalse {
    statements:
    - Tom is seven years old. | true
    - The girl says her age. | false
  }
  textbox {
    prompt: "Write one sentence about Tom."
  }
}
```

**Es la única forma de hacer varias preguntas sobre un mismo audio.** Los tipos `listening*` traen
su pregunta pegada (una por actividad), así que sin esto había que repetir el audio en cada una.
Dentro de un bloque con audio se usan los tipos **normales** (`multiplechoice`, `multiselect`,
`truefalse`, `matching`, `dragdrop`, `fillblank`, `textbox`…), no los `listening*`: el audio ya lo
pone el bloque. Con `text:` pasa lo mismo para comprensión lectora, y admite tipos que `reading`
—que solo tiene preguntas abiertas— no permitía.

**Reglas:**

- Los tres campos van **antes de la primera actividad** del bloque. El parser solo lee los campos
  del bloque hasta ahí (`_block_header`); si no, le robaría el `title:` a un `reading {}` hijo o el
  `audio_text:` a un `listeningfillblank`.
- `lines:` y `audio_text:` son **excluyentes** (un audio por bloque) → error si van los dos.
- Un bloque con estímulo **necesita al menos una actividad** → error si está vacío.
- **Calificación:** sin cambios. Cada actividad se califica como siempre; a la IA se le pasa el
  estímulo del bloque como `context` para que sepa qué escuchó o leyó el alumno.
- **En papel:** un bloque con `lines:`/`audio_text:` se omite **entero** (sus preguntas serían
  sobre un audio que nadie va a oír). Un bloque con `text:` sí se imprime, con el texto arriba.

### Restricciones de bloques

- Un bloque SIN título y SIN instrucciones no muestra ningún encabezado
- Los bloques PUEDEN estar vacíos (aunque no tiene sentido)
- No hay límite de cuántos bloques puede tener una hoja
- Un bloque puede contener CUALQUIER combinación de tipos de actividad
- La numeración "Actividad N" se reinicia en cada bloque; `content` no consume número

---

## 6. Sistema de temas — theme {}

Personaliza los colores del encabezado y fondo de la hoja. Es completamente opcional.

### Sintaxis

```
worksheet {
  title: "..."

  theme {
    primary_color: "#7C3AED"
    background_color: "#F5F3FF"
    text_color: "#2E1065"
  }

  ...actividades...
}
```

### Campos

| Campo | Descripción | Aplica a |
|-------|-------------|---------|
| `primary_color` | Color del header de la hoja | Fondo del `<header>` |
| `background_color` | Color del fondo general | `style={{ backgroundColor }}` |
| `text_color` | Color del texto general | `style={{ color }}` |

### JSON producido (columna separada)

El tema se guarda en la columna `theme` (JSONB/TEXT) de la tabla `worksheets`, **no** dentro de `json_content`:

```json
{
  "primary_color": "#7C3AED",
  "background_color": "#F5F3FF",
  "text_color": "#2E1065"
}
```

### Paletas de colores sugeridas

| Paleta | primary_color | background_color | text_color |
|--------|--------------|-----------------|------------|
| Morado | `#7C3AED` | `#F5F3FF` | `#2E1065` |
| Azul | `#2563EB` | `#EFF6FF` | `#1E3A5F` |
| Verde | `#059669` | `#ECFDF5` | `#064E3B` |
| Rojo | `#DC2626` | `#FEF2F2` | `#7F1D1D` |
| Naranja | `#D97706` | `#FFFBEB` | `#78350F` |
| Rosa | `#DB2777` | `#FDF2F8` | `#831843` |
| Oscuro | `#1E293B` | `#F8FAFC` | `#0F172A` |

---

## 7. Calificación automática

### Flujo completo

```
1. Estudiante envía answers_json
   └─→ _build_answer_details(worksheet, answers_json)
         ├── fillblank           → auto correct/incorrect (posicional)
         ├── multiplechoice      → auto correct/incorrect (exacto)
         ├── matching            → auto correct/incorrect por par (posicional)
         ├── listening           → auto correct/incorrect (exacto)
         ├── listeningfillblank  → auto correct/incorrect (posicional)
         ├── listeningmultiplechoice → auto correct/incorrect (exacto)
         ├── listeningmatching   → auto correct/incorrect por par (posicional)
         ├── truefalse           → auto correct/incorrect por enunciado
         ├── readingtruefalse    → auto correct/incorrect por enunciado
         ├── listeningtruefalse  → auto correct/incorrect por enunciado
         ├── textbox             → pending
         ├── imagequestion       → pending
         └── reading             → pending (todas las preguntas)

2. ai_grade_activities(details, worksheet.title)
   └─→ IA revisa:
         - fillblank/listeningfillblank "incorrect": ¿typo/variante? → puede cambiar a "correct"
         - pending (textbox, imagequestion, reading): evalúa y marca correct/incorrect
         - Todos: agrega comment (teacher_comment)

3. _score_details(details)
   └─→ score = (correct / (correct + incorrect)) * 100
         ← pending NO cuenta en el denominador
```

### Tabla de calificación por tipo

`Unidades` = cuántos ítems de puntaje genera la actividad. Cada unidad pesa **lo mismo**: una
`truefalse` de 5 enunciados vale 5 veces más que un `multiplechoice`. Tenerlo en cuenta al armar
la hoja.

| Tipo | Calificación | Unidades | La IA puede rescatarlo |
|------|-------------|----------|------------------------|
| fillblank | Auto exacta posicional | 1 por actividad | **Sí** |
| listeningfillblank | Auto exacta posicional | 1 por actividad | **Sí** |
| listening | Auto exacta (texto libre) | 1 por actividad | **Sí** |
| conversation (con `answer`) | Auto exacta (texto libre) | 1 por actividad | **Sí** |
| multiplechoice | Auto exacta | 1 por actividad | No — se elige con clic |
| listeningmultiplechoice | Auto exacta | 1 por actividad | No |
| multiselect | Auto por conjunto exacto | 1 por actividad | No |
| dragdrop | Auto exacta posicional | 1 por actividad | No |
| matching | Auto posicional | 1 por par (left[i] ↔ right[i]) | **Sí** — por par |
| listeningmatching | Auto posicional | 1 por par | No |
| truefalse | Auto booleana | 1 por enunciado | No |
| readingtruefalse | Auto booleana | 1 por enunciado | No |
| listeningtruefalse | Auto booleana | 1 por enunciado | No |
| listeningorder | Auto por orden exacto | 1 por actividad | No |
| speaking (con `target`) | Auto por similitud LCS ≥ 0.85 | 1 por actividad | No — mide pronunciación |
| speaking (sin `target`) | `pending` → IA | 1 por actividad | — |
| textbox | `pending` → IA | 1 por actividad | — |
| imagequestion | `pending` → IA | 1 por actividad | — |
| reading | `pending` → IA | **1 por pregunta** | — |
| conversation (sin `answer`) | `pending` → IA | 1 por actividad | — |
| content | **No se califica** | 0 | — |

> **Score final:** `(correct_count / (correct_count + incorrect_count)) * 100`  
> Los `pending` no se incluyen en el denominador hasta que el profesor los revise manualmente.

### Qué puede y qué NO puede cambiar la IA

`_AI_RESCUABLE` en `ai.py` = `{fillblank, listeningfillblank, listening, conversation, matching}`.

- En los cuatro primeros el alumno **escribe** la respuesta y el auto-corrector la compara por
  igualdad exacta, así que un acierto legítimo (sinónimo, respuesta corta, dedazo) falla la
  comparación. Solo ahí puede convertir un `incorrect` en `correct`.
- **`matching` se añadió porque su clave (mismo índice) NO es la única combinación válida.** La IA
  re-juzga **cada par por su cuenta**: correcto si izquierda+derecha forman una combinación válida
  para lo que la actividad practica; incorrecto solo si la combinación falla (concordancia o
  significado). No comprueba que el conjunto siga siendo una biyección.
- En lo demás que se elige de una lista cerrada (opciones, true/false, orden, speaking con `target`)
  el resultado automático es la verdad: la IA solo escribe el comentario que explica la regla.
- En los `pending` la IA decide `correct` / `incorrect` (no existe `partial`).
- **Nunca** puede marcar como incorrecto algo que el auto-corrector dio por correcto.

### Contexto que recibe la IA

`AnswerDetail.context` le dice qué escuchó o leyó el alumno; sin él no puede juzgar una respuesta
abierta a un audio. Se rellena con el diálogo (`conversation`), la oración del audio
(`listening` → `text`; el resto → `audio_text`) y el texto de lectura (`reading`).

Dos límites que el prompt de calificación explicita:
- En `speaking`, `student_answer` es una **transcripción automática**: la ortografía y la puntuación
  vienen del transcriptor, no del alumno, y no se penalizan.
- En `imagequestion` el modelo **no ve la imagen**: juzga el idioma y la estructura pedida, nunca si
  la descripción es cierta.

### Normalización de respuestas de texto

```python
def _norm_answer(v):
    s = str(v or "").strip().lower()
    # Elimina comillas residuales si las hay
    if len(s) >= 2 and s[0] == s[-1] == '"':
        s = s[1:-1].strip()
    return s
```

Esto significa que:
- `"GOES"` == `"goes"` ✓
- `"  went  "` == `"went"` ✓
- `'"yes"'` == `"yes"` ✓
- `"doesn't"` ≠ `"doesn't"` ← depende de la codificación del apóstrofo

---

## 8. Instrucciones por actividad — instructions

Cualquier tipo de actividad acepta un campo `instructions` opcional. Se muestra como una caja ámbar con ícono ℹ️ debajo del enunciado principal.

```
fillblank {
  text: "She _____ to the gym on Saturdays."
  answer: "goes"
  instructions: "Use the Present Simple third person singular."
}
```

**Resultado visual:**
```
She _____ to the gym on Saturdays.
ℹ️ Use the Present Simple third person singular.
[campo de texto]
```

Puede usarse en cualquier tipo: `fillblank`, `multiplechoice`, `textbox`, `matching`, `reading`, `imagequestion`, `listening`, `listeningfillblank`, `listeningmultiplechoice`, `listeningmatching`, `listeningtruefalse`, `truefalse`, `readingtruefalse`.

---

## 9. Saltos de línea — \n

El parser guarda los strings tal como aparecen en el DSL. El frontend usa `RichText.tsx` para convertir `\n` literales en saltos de línea reales.

```tsx
// RichText.tsx
const processed = (text ?? '').replace(/\\n/g, '\n');
return <span className="whitespace-pre-line">{processed}</span>;
```

### Cómo escribir saltos de línea en el DSL

```
reading {
  title: "My School Day"
  content: "I wake up at 7 AM every day.\nI have to eat breakfast quickly.\nThen I take the bus to school.\n\nAt school, we have six classes per day.\nMy favourite class is English."
}
```

Producirá en pantalla:
```
I wake up at 7 AM every day.
I have to eat breakfast quickly.
Then I take the bus to school.

At school, we have six classes per day.
My favourite class is English.
```

> `\n\n` = línea en blanco (párrafo separado)

### Dónde aplica RichText

| Campo | ¿Usa RichText? |
|-------|----------------|
| `description` de la hoja | Sí |
| `content` de reading/readingtruefalse | Sí |
| `text` de fillblank | Sí (renderer manual con `.replace(/\\n/g, '\n')`) |
| `text` de listeningfillblank | Sí (renderer manual) |
| `question` de multiplechoice/listening | Sí |
| `prompt` de textbox/imagequestion | Sí |
| `block.title` e `block.instructions` | Sí |
| `instructions` de cualquier actividad | Sí |
| `audio_text` de cualquier listening | No aplica (nunca visible) |

---

## 10. Errores comunes

### Parser

| Error | Causa | Solución |
|-------|-------|----------|
| `"Falta el bloque requerido worksheet"` | No hay `worksheet { }` | Envolver todo en `worksheet { ... }` |
| `"El título de la hoja es obligatorio"` | No hay `title:` en worksheet | Agregar `title: "..."` al inicio |
| `"Se requiere al menos una actividad"` | El script no tiene actividades | Agregar al menos una actividad |
| `"Bloque X sin cerrar"` | Falta una `}` de cierre | Revisar el balance de llaves |
| `"Actividad N (tipo): …"` | La validación detectó una actividad que el alumno no podría responder | Leer el motivo concreto del mensaje (ver §3) |
| Actividad ignorada silenciosamente | Tipo de actividad mal escrito, **o** actividad fuera de un `block {}` habiendo blocks | Verificar el nombre exacto del tipo y que TODO esté dentro de algún block |
| Campos perdidos sin error | Dos campos en la misma línea | Un campo por línea (§3) |
| Enunciado T/F que sale siempre `true` | Falta el ` | true` / ` | false` | El pipe es obligatorio |

> **`listeningmatching` ya acepta los dos formatos.** El canónico sigue siendo `pair { }`, pero desde
> julio 2026 `_parse_pairs` también lee la lista `pairs:` — es la que emite el constructor visual y la
> que escribe la IA por costumbre YAML. Antes se ignoraba en silencio y la actividad quedaba vacía
> (crear una `listeningmatching` en modo visual y guardar la destruía).

### Calificación

| Problema | Causa | Solución |
|----------|-------|----------|
| `matching` siempre incorrecto | `right[i]` no coincide con `left[i]` | Los pares son posicionales: left[0]↔right[0] |
| `multiplechoice` siempre incorrecto | `answer` no es exactamente igual a la opción | Copiar el texto exacto de la opción |
| `fillblank` incorrecto con respuesta "correcta" | Apóstrofos distintos (`'` vs `'`) | Usar el mismo apóstrofo en DSL y respuesta |
| `listeningtruefalse` sin calificar | statements en formato incorrecto | Verificar formato `- Texto. \| true` |
| Score `null` | Solo hay actividades `pending` | Normal; el score aparece cuando el profesor revisa |

### Semánticos

| Error | Descripción |
|-------|-------------|
| `listening` con `audio_text:` | Este tipo usa `text:`. El parser no encontrará el audio |
| `listeningfillblank` con `text:` para el audio | El audio debe ir en `audio_text:`, el visible en `text:` |
| `options` en `listeningmatching` sin listar todas las opciones | El estudiante no podrá seleccionar alguna respuesta |
| `answer` de `multiplechoice` diferente a las opciones | Nadie podrá responder correctamente |
| Blank `_____` sin respuesta correspondiente | Si hay 3 `_____` pero `answer: "solo"`, solo califica el primero |

---

## 11. Hojas de trabajo completas — ejemplos

### Ejemplo 1 — Hoja básica sin bloques (A1-A2)

```
worksheet {
  title: "Present Simple — Third Person"
  description: "Practice the Present Simple with he/she/it."

  fillblank {
    text: "She _____ to school every day."
    answer: "goes"
  }

  fillblank {
    text: "He _____ football on Saturdays."
    answer: "plays"
  }

  multiplechoice {
    question: "Which sentence is correct?"
    options:
    - She go to the market.
    - She goes to the market.
    - She going to the market.
    answer: "She goes to the market."
  }

  matching {
    left:
    - I / You / We / They
    - He / She / It
    right:
    - base form (play, go, eat)
    - + s/es (plays, goes, eats)
  }

  textbox {
    prompt: "Write 3 sentences about what your best friend does every day. Use Present Simple."
    instructions: "Use he/she + verb + s/es."
  }
}
```

---

### Ejemplo 2 — Hoja con bloques y tema (A2)

```
worksheet {
  title: "Modal Verbs — Obligation and Advice"
  description: "Practice must, should, have to and their negatives."

  theme {
    primary_color: "#7C3AED"
    background_color: "#F5F3FF"
    text_color: "#2E1065"
  }

  block {
    title: "Part 1: Vocabulary"
    instructions: "Match each modal verb with its meaning."
    matching {
      left:
      - must
      - should
      - have to
      - don't have to
      - mustn't
      right:
      - Strong internal obligation
      - Advice or recommendation
      - External obligation (rule/law)
      - Not necessary — no obligation
      - Prohibition — it is not allowed
    }
  }

  block {
    title: "Part 2: Grammar"
    instructions: "Choose the correct modal verb for each situation."
    multiplechoice {
      question: "You _____ wear a seatbelt in a car. It's the law."
      options:
      - should
      - must
      - don't have to
      answer: "must"
    }
    multiplechoice {
      question: "You _____ bring an umbrella. The weather forecast says it won't rain."
      options:
      - mustn't
      - should
      - don't have to
      answer: "don't have to"
    }
    multiplechoice {
      question: "You _____ touch that wire — it's very dangerous!"
      options:
      - mustn't
      - don't have to
      - should
      answer: "mustn't"
    }
    fillblank {
      text: "You _____ eat more vegetables. It's good for your health."
      answer: "should"
    }
    fillblank {
      text: "Students _____ use their phones during the exam. It's forbidden."
      answer: "mustn't"
    }
  }

  block {
    title: "Part 3: True or False"
    truefalse {
      statements:
      - 'Must' is followed by the base form of the verb. | true
      - 'Have to' expresses internal, personal obligation. | false
      - 'Should' is used for advice. | true
      - 'Don't have to' means the same as 'mustn't'. | false
      - We can use 'have to' in all tenses. | true
      instructions: "Decide if each statement is True or False based on the grammar rules."
    }
  }

  block {
    title: "Part 4: Writing"
    textbox {
      prompt: "Write 5 rules for your ideal school. Use must, mustn't, should, have to and don't have to."
      instructions: "Example: Students must respect their teachers."
    }
  }
}
```

---

### Ejemplo 3 — Hoja con listening (B1)

```
worksheet {
  title: "Had to — Past Obligation"
  description: "Practice 'had to' and 'didn't have to' in all 4 forms."

  theme {
    primary_color: "#059669"
    background_color: "#ECFDF5"
    text_color: "#064E3B"
  }

  block {
    title: "Part 1: Identify the Form"
    instructions: "Listen to each sentence and classify it."
    listeningmatching {
      pair {
        audio_text: "She had to call the doctor last night."
        match: "Affirmative"
      }
      pair {
        audio_text: "We didn't have to bring our books to class."
        match: "Negative"
      }
      pair {
        audio_text: "Did he have to work on Saturday?"
        match: "Yes/No Question"
      }
      pair {
        audio_text: "Why did she have to leave the office so early?"
        match: "Wh-Question"
      }
      options:
      - Affirmative
      - Negative
      - Yes/No Question
      - Wh-Question
      instructions: "Listen to each audio and select the correct grammatical form."
    }
  }

  block {
    title: "Part 2: Fill in the Blanks"
    instructions: "Listen and complete the sentences."
    listeningfillblank {
      audio_text: "Tom didn't have to wear a uniform at his new school."
      text: "Tom _____ wear a uniform at his new school."
      answer: "didn't have to"
    }
    listeningfillblank {
      audio_text: "Where did they have to go for the school trip?"
      text: "Where _____ they _____ go for the school trip?"
      answer: ["did", "have to"]
    }
    listeningfillblank {
      audio_text: "Maria had to wake up at five in the morning to catch the bus."
      text: "Maria _____ wake up at five in the morning to catch the bus."
      answer: "had to"
    }
  }

  block {
    title: "Part 3: Comprehension"
    instructions: "Listen to the story and answer the questions."
    listeningtruefalse {
      audio_text: "Last week, Anna went to a job interview. She had to wear formal clothes and arrive at exactly 9 AM. She didn't have to bring her portfolio, but she had to answer many questions about her experience. She also had to take a short English test."
      statements:
      - Anna had to wear formal clothes for the interview. | true
      - Anna had to arrive at 10 AM. | false
      - Anna had to bring her portfolio. | false
      - Anna had to take an English test. | true
    }
  }

  block {
    title: "Part 4: Production"
    textbox {
      prompt: "Think about an important event in your life (an exam, a trip, a competition).\nWrite a short paragraph about what you had to do to prepare for it.\nUse 'had to' and 'didn't have to'."
      instructions: "Write at least 5 sentences."
    }
  }
}
```

---

### Ejemplo 4 — Hoja con lectura + imagen (A2-B1)

```
worksheet {
  title: "School Life Around the World"
  description: "Reading and listening about school rules in different countries."

  block {
    title: "Part 1: Reading"
    reading {
      title: "School in Japan"
      content: "In Japan, students have to clean their own classrooms every day after school.\nThey must wear a school uniform and cannot dye their hair.\nHowever, they don't have to bring lunch — they eat at school with their classmates.\nStudents have to participate in a club activity at least three times a week."
      questions:
      - What do Japanese students have to do after school?
      - What can't students do with their hair?
      - Why don't students need to bring lunch?
      - How often do students have to do club activities?
      instructions: "Read the text carefully before answering."
    }
  }

  block {
    title: "Part 2: True or False"
    readingtruefalse {
      title: "School in Japan — Quick Check"
      content: "In Japan, students have to clean their own classrooms every day after school.\nThey must wear a school uniform and cannot dye their hair.\nHowever, they don't have to bring lunch — they eat at school with their classmates.\nStudents have to participate in a club activity at least three times a week."
      statements:
      - Students have to clean their classrooms. | true
      - Students can wear any clothes they want. | false
      - Students have to bring lunch from home. | false
      - Club activities are optional in Japanese schools. | false
    }
  }

  block {
    title: "Part 3: Describe the Image"
    imagequestion {
      image: "https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=800"
      prompt: "Look at this classroom. Compare it to what you read about school in Japan.\nWhat do you think students have to do in this classroom?"
      instructions: "Write at least 4 sentences. Use 'have to', 'must' and 'can'."
    }
  }

  block {
    title: "Part 4: Listening"
    listeningmultiplechoice {
      audio_text: "In Finland, students don't have to take standardized tests until they are 16 years old. Teachers believe that learning should be enjoyable, not stressful."
      question: "What is special about the Finnish education system?"
      options:
      - Students have to take many tests every year.
      - Students don't have to take tests until age 16.
      - Students must study 8 hours a day.
      answer: "Students don't have to take tests until age 16."
    }
  }
}
```

---

## Resumen rápido de campos por tipo

| Tipo | `text` | `question` | `options` | `answer` | `prompt` | `left`/`right` | `content` | `questions` | `image` | `audio_text` | `pairs` | `statements` | `title` | otros |
|------|--------|------------|-----------|----------|----------|----------------|-----------|-------------|---------|-------------|---------|-------------|---------|-------|
| fillblank | ✓* | — | — | ✓ | — | — | — | — | — | — | — | — | — | |
| multiplechoice | — | ✓ | ✓ | ✓ | — | — | — | — | — | — | — | — | — | |
| multiselect | — | ✓ | ✓ | ✓‡ | — | — | — | — | — | — | — | — | — | |
| dragdrop | ✓* | — | — | ✓‡ | — | — | — | — | — | — | — | — | — | `bank` |
| textbox | — | — | — | — | ✓ | — | — | — | — | — | — | — | — | |
| matching | — | — | — | — | — | ✓ | — | — | — | — | — | — | — | |
| reading | — | — | — | — | — | — | ✓ | ✓ | — | — | — | — | ✓ | |
| readingtruefalse | — | — | — | — | — | — | ✓ | — | — | — | — | ✓ | ✓ | |
| truefalse | — | — | — | — | — | — | — | — | — | — | — | ✓ | — | |
| imagequestion | — | — | — | — | ✓ | — | — | — | ✓ | — | — | — | — | |
| speaking | — | — | — | — | ✓ | — | — | — | — | — | — | — | — | `target` |
| listening | ✓† | ✓ | — | ✓ | — | — | — | — | — | — | — | — | — | `voice`, `rate` |
| listeningfillblank | ✓* | — | — | ✓ | — | — | — | — | — | ✓ | — | — | — | `voice`, `rate` |
| listeningmultiplechoice | — | ✓ | ✓ | ✓ | — | — | — | — | — | ✓ | — | — | — | `voice`, `rate` |
| listeningmatching | — | — | ✓ | — | — | — | — | — | — | — | ✓ | — | — | `voice`, `rate` |
| listeningtruefalse | — | — | — | — | — | — | — | — | — | ✓ | — | ✓ | — | `voice`, `rate` |
| listeningorder | — | — | — | ✓‡ | — | — | — | — | — | ✓ | — | — | — | `bank`, `voice`, `rate` |
| conversation | — | ✓ | — | opc. | — | — | — | — | — | — | — | — | — | `lines` |
| content | — | — | — | — | — | — | — | — | — | — | — | — | opc. | `html`, `sandbox` |

`*` = con marcadores `_____`  
`†` = el `text` de `listening` es el audio TTS OCULTO (campo diferente al `text` de `fillblank`)  
`‡` = `answer` es siempre una **lista**  
Todos aceptan además `instructions` (opcional). `voice` (`male`/`female`) y `rate`
(`very slow`/`slow`/`normal`) solo aplican a `listening*`.

---

## 12. Dónde se documenta el DSL (mantener sincronizado)

El mismo formato se enseña en **cuatro** sitios. Si se agrega o cambia un tipo, hay que tocar los cuatro:

| Sitio | Para quién | Archivo |
|-------|-----------|---------|
| Este documento | Desarrollo / referencia completa | `docs/07_DSL.md` |
| Prompt interno de la IA | El modelo que genera desde el editor | `_WORKSHEET_SYSTEM` en `backend/app/ai.py` |
| Prompt copiable | El profesor, para pegarlo en ChatGPT/Claude/DeepSeek | `GENERATION_PROMPT` en `src/utils/generationPrompt.ts` |

> Antes eran cuatro: el cuarto era el resumen de `CLAUDE.md` §3, que se eliminó al reestructurar la
> documentación precisamente para no tener que sincronizarlo. **Este documento es la referencia; no
> se crean resúmenes paralelos del DSL.**

La lista canónica de tipos vive en `SUPPORTED_BLOCKS` (`parser.py`). El test
`test_every_documented_type_parses` (`backend/tests/test_parser.py`) escribe una hoja con los 21
tipos usando exactamente la sintaxis documentada y comprueba que parsea: si la documentación empieza
a enseñar algo que no funciona, ese test falla.

---

## 13. Grupos por habilidad (taxonomía pedagógica)

Los 21 tipos se agrupan por objetivo. Esta taxonomía existe en **dos** lugares del código que deben
mantenerse en sincronía: `ACTIVITY_GROUPS` en `WorksheetEditor.tsx` (chips del AiPanel) y la sección
"PEDAGOGICAL GROUPS" de `_WORKSHEET_SYSTEM` en `ai.py`. Úsala también al armar hojas a mano — un
`block {}` por grupo funciona bien.

| Grupo | Tipos |
|-------|-------|
| 🧱 Gramática y vocabulario (cerradas) | fillblank, dragdrop, multiplechoice, multiselect, matching, truefalse |
| 📖 Lectura | content (teoría), reading, readingtruefalse |
| 🎧 Comprensión auditiva | listening, listeningmultiplechoice, listeningtruefalse |
| 🎼 Escucha fina (dictado y orden) | listeningfillblank, listeningorder, listeningmatching |
| 🗣️ Producción oral | speaking, conversation |
| ✍️ Escritura abierta | textbox, imagequestion |
| 🖼️ Con imágenes (URLs del profesor) | imagequestion, imagechoice, imagematching |

### Voz por actividad (`voice`)

Cualquier tipo `listening*` acepta un campo opcional `voice: male` o `voice: female` (por defecto: la
preferencia global del usuario, masculina). Se normaliza en el parser (`_normalize_voice`) y baja
hasta `AudioPlayer`: `male` → `en-US-AndrewNeural`, `female` → `en-US-AriaNeural`. Un valor
desconocido se pasa tal cual como nombre de voz edge-tts, así que las ~47 voces en inglés están
disponibles escribiéndolas literalmente (`voice: en-GB-SoniaNeural`, `voice: en-AU-NatashaNeural`).
Solo aplica a listening (otros tipos lo ignoran).

Sirve para evitar el desajuste "voz masculina lee la oración pero la pregunta dice *she*".

### Velocidad por actividad (`rate`)

Cualquier tipo `listening*` —y cualquier `block {}` con `lines` o `audio_text`— acepta un campo
opcional `rate`. Vocabulario **cerrado**: `very slow` (`-35%`), `slow` (`-15%`, el default de la
plataforma), `normal` (`+0%`) o un porcentaje literal `±NN%`. También se aceptan las formas en
español (`muy lento`, `lento`, `normal`). El parser lo normaliza a `±NN%` (`_normalize_rate`) y
**cualquier otro valor es un error de script**, al revés que `voice`: un `voice` desconocido puede
ser una de las ~47 voces de edge-tts, pero un `rate: slowly` solo puede ser una errata, y tragárselo
en silencio dejaría al profesor creyendo que la hoja va lenta cuando no lo está.

No es el `playbackRate` del navegador: edge-tts **regenera** el audio a esa velocidad, con
articulación y pausas limpias, en vez de estirar una onda ya grabada.

El `rate` del DSL es la velocidad **de partida**; el alumno puede seguir bajándola con el selector
del reproductor. Es la diferencia con `voice`, que sí queda fijo: la voz es una decisión de
contenido (que el género case con la pregunta), la velocidad es una ayuda que el alumno necesita
poder darse a sí mismo.

> Añadir `voice` obligó a tocar también el modelo Pydantic `Activity` (`models.py`) y
> `normalizeActivity`/`withInstructions` (`api.ts`): sin eso el campo se descartaba al persistir o al
> leer. Cualquier campo nuevo de actividad necesita ese mismo recorrido completo.

---

## 14. Guía de calidad al generar hojas

Leer **antes** de crear una hoja. Aplican al **contenido**, más allá de que el DSL sea válido.

### Respuestas y distractores

- **Evitar respuestas evidentes:** los distractores deben ser *plausibles* y del mismo tipo/categoría
  que la correcta (mismo tiempo verbal, misma clase de palabra, mismo tema). Un distractor absurdo
  regala la respuesta.
- **Distractores mínimamente diferentes** cuando el objetivo es discriminación fina: que se distingan
  por *una* característica (presente/pasado, afirmativa/negativa/pregunta, singular/plural). Para
  `wakes up`, distractores `woke up` / `waking up`, no `runs` / `sleeps`.
- **Sin pistas dentro de la pregunta:** el enunciado no debe contener la respuesta ni delatarla por
  concordancia obvia.
- **Sin respuesta revelada en otra actividad.**
- **Una sola respuesta válida — se comprueba sustituyendo:** mete cada distractor en la oración y
  léela. Si una segunda opción también encaja (gramática *y* significado), el ítem está roto: cambia
  el distractor o añade contexto que lo descarte. En `dragdrop` un distractor debe ser incorrecto en
  **todos** los huecos del texto, no solo en el suyo; en `matching` cada elemento de la izquierda
  debe corresponder a uno solo de la derecha (categorías como "Breakfast drink" se rompen si dos
  opciones encajan); en un `multiplechoice` sobre un hueco, la respuesta debe encajar en la oración
  **tal como está escrita** ("What _____ she buy yesterday?" → `did`, no `buy` ni `bought`).
  Es el error más frecuente de la IA al generar: lo detecta el botón **Revisar hoja**
  ([06_AI](06_AI.md)), pero sale más barato no cometerlo.

### Evitar patrones predecibles

Un alumno no debe poder acertar "por el patrón" sin saber.

- **No agrupar por tipo si eso crea un patrón de respuesta.** Cuando el objetivo es discriminar
  (ej. presente vs. pasado), **mezclar** los ítems en un solo bloque en orden variado.
- **`truefalse` / `readingtruefalse` / `listeningtruefalse`:** variar el patrón de `answer` (ni todas
  `true`, ni alternancia mecánica). Mezcla irregular.
- **`multiplechoice` / `multiselect` / `dragdrop`:** la app **baraja las opciones al mostrarlas**, así
  que la posición de la correcta en el DSL no importa — pero **sí** variar cuál es la correcta entre
  ítems.
- **`fillblank`:** que la respuesta no sea siempre la misma palabra ni siga un patrón obvio.

### Nivel y coherencia

- Respetar el **nivel** pedido (A1/A2/B1…): vocabulario, longitud de oración y estructuras acordes.
  En listening de discriminación fina, **oraciones cortas** para que la palabra objetivo pese.
- Mantener un **tema/hilo** coherente en toda la hoja cuando aplique.
- **`fillblank` sin ambigüedad:** si hay varias respuestas válidas legítimas, usar `answer` como
  **lista** o replantear el ítem. El corrector IA valida equivalencias, pero no conviene depender.

### `content` como repaso

- Sirve para **recordar la regla**, no para resolver la hoja. Es opcional: se añade cuando el profesor
  pide repaso/teoría o cuando el alumno ve el tema por primera vez.
- Cuando se incluye debe traer: la regla en 1–2 líneas en lenguaje sencillo (explicación en español +
  ejemplos en inglés), la **forma** (afirmativa / negativa / pregunta), 2–3 ejemplos y el error típico.
- **Sus ejemplos NO pueden ser oraciones de los ejercicios ni contener ninguna respuesta.** Va
  primero, en su propio `block`.

### Recordatorios técnicos que también son errores de generación

- `info {}` usa strings planos (`- Name`), no `- label: "…"`.
- Cada campo del DSL en **su propia línea**.
- Los listenings usan **TTS**, nunca un campo `audio:`. El `audio_text`/`text` oculto no debe repetir
  la pregunta visible de forma que delate la respuesta.
- Comillas internas: usar tipográficas `“ ”` (las `\"` quedan literales).

---

*Última actualización: 2026-08-03 (21 tipos: `imagechoice` e `imagematching`; campo privado `note`)*
