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
5. [Sistema de bloques — block {}](#5-sistema-de-bloques--block-)
6. [Sistema de temas — theme {}](#6-sistema-de-temas--theme-)
7. [Calificación automática](#7-calificación-automática)
8. [Instrucciones por actividad — instructions](#8-instrucciones-por-actividad--instructions)
9. [Saltos de línea — \n](#9-saltos-de-línea--n)
10. [Errores comunes](#10-errores-comunes)
11. [Hojas de trabajo completas — ejemplos](#11-hojas-de-trabajo-completas--ejemplos)

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
| *campos específicos* | ver cada tipo | según tipo |

> **Nota:** El parser omite los campos `null` en el JSON final (`to_dict()` filtra los `None`).

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
| Actividades aceptadas | fillblank, multiplechoice, textbox, matching, reading, imagequestion, listening, listeningfillblank, listeningmultiplechoice, listeningmatching, listeningtruefalse, truefalse, readingtruefalse |
| Actividad PROHIBIDA | `speaking` — no implementada |

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

La IA evalúa relevancia, gramática y contenido, y devuelve `correct`, `incorrect` o `partial`.

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

**Descripción:** El estudiante conecta cada ítem de la columna izquierda con su par en la columna derecha usando un dropdown. Los ítems de la derecha se muestran en orden aleatorio (determinístico por ID).

**Cuándo usar:** Vocabulario + definiciones, modales + significados, verbos irregulares + formas pasadas.

**Calificación:** Automática — comparación posicional: `left[0]` debe emparejar con `right[0]`, `left[1]` con `right[1]`, etc.

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

**Descripción:** Texto de lectura con botón TTS para escuchar el contenido, seguido de preguntas abiertas que el estudiante responde.

**Cuándo usar:** Comprensión lectora, práctica de lectura + audición simultánea, textos narrativos o informativos.

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

#### ⚠️ SINTAXIS CRÍTICA: `pair {}` bloques (no lista YAML)

Los pares **DEBEN** usar bloques `pair { }`. NO se puede usar una lista YAML.

```
✅ CORRECTO:
pair {
  audio_text: "She had to go."
  match: "Affirmative"
}

❌ INCORRECTO (parser lo ignora):
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

**Descripción:** El estudiante lee un texto (con botón TTS opcional) y luego responde Verdadero o Falso a una lista de enunciados sobre el texto.

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
      "activities": [
        { "id": "uuid", "type": "listeningfillblank", ... }
      ]
    }
  ]
}
```

### Comportamiento del frontend

```tsx
// WorksheetRenderer.tsx
const blocks = worksheet.blocks?.length
  ? worksheet.blocks
  : [{ title: null, instructions: null, activities: worksheet.activities }];
```

Si no hay `blocks`, crea un bloque ficticio con todas las actividades. **La retrocompatibilidad está garantizada.**

### Restricciones de bloques

- Un bloque SIN título y SIN instrucciones no muestra ningún encabezado
- Los bloques PUEDEN estar vacíos (aunque no tiene sentido)
- No hay límite de cuántos bloques puede tener una hoja
- Un bloque puede contener CUALQUIER combinación de tipos de actividad

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

| Tipo | Calificación | Unidades | Puede ser pending |
|------|-------------|----------|-------------------|
| fillblank | Auto exacta normalizada | 1 por actividad | No (la IA puede corregir) |
| multiplechoice | Auto exacta | 1 por actividad | No |
| textbox | IA | 1 por actividad | Sí |
| matching | Auto exacta posicional | 1 por par (left[i] ↔ right[i]) | No |
| reading | IA | 1 por pregunta | Sí |
| imagequestion | IA | 1 por actividad | Sí |
| listening | Auto exacta | 1 por actividad | No (IA puede corregir) |
| listeningfillblank | Auto exacta posicional | 1 por actividad | No (IA puede corregir) |
| listeningmultiplechoice | Auto exacta | 1 por actividad | No |
| listeningmatching | Auto exacta posicional | 1 por par | No |
| listeningtruefalse | Auto booleana | 1 por enunciado | No |
| truefalse | Auto booleana | 1 por enunciado | No |
| readingtruefalse | Auto booleana | 1 por enunciado | No |

> **Score final:** `(correct_count / (correct_count + incorrect_count)) * 100`  
> Los `pending` no se incluyen en el denominador hasta que el profesor los revise manualmente.

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
| Actividad ignorada silenciosamente | Tipo de actividad mal escrito | Verificar el nombre exacto del tipo |
| `pair {}` no parsea | `pairs:` usada en lugar de `pair {}` | Usar bloques `pair { }` explícitos |

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

| Tipo | `text` | `question` | `options` | `answer` | `prompt` | `left`/`right` | `content` | `questions` | `image` | `audio_text` | `pairs` | `statements` | `title` |
|------|--------|------------|-----------|----------|----------|----------------|-----------|-------------|---------|-------------|---------|-------------|---------|
| fillblank | ✓* | — | — | ✓ | — | — | — | — | — | — | — | — | — |
| multiplechoice | — | ✓ | ✓ | ✓ | — | — | — | — | — | — | — | — | — |
| textbox | — | — | — | — | ✓ | — | — | — | — | — | — | — | — |
| matching | — | — | — | — | — | ✓ | — | — | — | — | — | — | — |
| reading | — | — | — | — | — | — | ✓ | ✓ | — | — | — | — | ✓ |
| imagequestion | — | — | — | — | ✓ | — | — | — | ✓ | — | — | — | — |
| listening | ✓† | ✓ | — | ✓ | — | — | — | — | — | — | — | — | — |
| listeningfillblank | ✓* | — | — | ✓ | — | — | — | — | — | ✓ | — | — | — |
| listeningmultiplechoice | — | ✓ | ✓ | ✓ | — | — | — | — | — | ✓ | — | — | — |
| listeningmatching | — | — | ✓ | — | — | — | — | — | — | — | ✓ | — | — |
| listeningtruefalse | — | — | — | — | — | — | — | — | — | ✓ | — | ✓ | — |
| truefalse | — | — | — | — | — | — | — | — | — | — | — | ✓ | — |
| readingtruefalse | — | — | — | — | — | — | ✓ | — | — | — | — | ✓ | ✓ |

`*` = con marcadores `_____`  
`†` = el `text` de `listening` es el audio TTS OCULTO (campo diferente al `text` de `fillblank`)

---

*Fin del documento — Última actualización: 2026-06-15*
