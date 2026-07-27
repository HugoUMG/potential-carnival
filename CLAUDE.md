# Constructor de Hojas de Trabajo — Documentación Técnica

Repositorio: `potential-carnival` | Deploy: Render.com

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19 + Vite 7 + TypeScript 5.8 + Tailwind CSS 3 |
| Backend | Python + FastAPI |
| Base de datos | PostgreSQL (producción) / SQLite (desarrollo local) |
| Autenticación | JWT con roles (`admin`, `teacher`, `student`, `reader`) |
| TTS | `edge-tts` — voz `en-US-GuyNeural` |
| IA | Google Gemini (`gemini-3.1-flash-lite`) / Groq (`llama-3.3-70b-versatile`) |
| Deploy | Render.com — Static Site (frontend) + Web Service (backend) |

---

## 1. Descripción General

Plataforma web educativa: profesores crean hojas de trabajo interactivas (con IA o manualmente), las asignan a aulas, y revisan respuestas. Estudiantes completan las hojas asignadas a su aula.

### Roles

| Rol | Permisos |
|-----|---------|
| `admin` | Gestiona profesores, estudiantes y todo el contenido |
| `teacher` | Crea aulas, hojas, listas de vocabulario; asigna contenido; revisa respuestas |
| `student` | Completa hojas de su aula, ve resultados y notas |
| `reader` | Accede solo al portal de vocabulario; no puede cambiar contraseña |

### Modos de acceso adicionales

- **Modo invitado (guest):** Acceso sin cuenta a aulas públicas mediante token almacenado en localStorage. Las respuestas se identifican con `guest_token`.
- **Portal de vocabulario público:** Cualquier persona puede ver listas de vocabulario asignadas a lectores vía `/vocab` sin autenticarse.

### Flujo principal

1. El profesor se registra solo **con Google** (`/registro`), o el admin le crea la cuenta a mano
2. Profesor crea aula → le asigna estudiantes y hojas
3. Profesor crea hoja (con IA o manualmente) → publica → asigna a aula(s)
4. Estudiante entra a portal → ve solo hojas de su aula → completa → envía
5. Profesor revisa respuestas → puede calificar manualmente textbox/imagequestion → IA puede calificar automáticamente
6. Dashboard del profesor → métricas, notificaciones recientes, actividad de estudiantes

---

## 2. Base de Datos

PostgreSQL en producción (Render.com). SQLite para desarrollo local. El backend selecciona automáticamente según la variable `DATABASE_URL`.

### Tablas completas

```sql
-- Usuarios (todos los roles)
users (id, name, email, username, password_hash, role, created_at,
       created_by)  -- profesor que dio de alta al alumno; NULL = legacy (visible a todos)

-- Hojas de trabajo
worksheets (id, title, description, script_content, json_content JSONB,
            created_by → users, created_at, published, archived,
            max_attempts, theme JSONB, ai_grading, ai_tolerance)
            -- ai_tolerance: 0 estricto … 100 permisivo (barra por hoja)

-- Respuestas de estudiantes
worksheet_responses (id, worksheet_id → worksheets, student_id → users,
                     student_name, answers_json JSONB, details_json JSONB,
                     score, correct_count, pending_count, submitted_at,
                     guest_token)

-- Aulas
classrooms (id, name, created_by → users, created_at, is_public BOOLEAN)

-- Relaciones aula ↔ estudiante
classroom_students (classroom_id → classrooms, student_id → users,
                    assigned_at)  -- PK compuesta

-- Relaciones aula ↔ hoja
classroom_worksheets (classroom_id → classrooms, worksheet_id → worksheets,
                      assigned_at, due_date)  -- PK compuesta, due_date opcional

-- Sesiones de usuarios
user_sessions (id, user_id → users, logged_in_at, logged_out_at)

-- Listas de vocabulario
vocabulary_lists (id, title, description, created_by → users, created_at,
                  items JSONB)

-- Asignación vocabulario ↔ aula
vocabulary_assignments (list_id → vocabulary_lists, classroom_id → classrooms,
                        assigned_at)  -- PK compuesta

-- Asignación vocabulario ↔ lector (directo)
vocabulary_reader_assignments (reader_id → users, list_id → vocabulary_lists,
                               assigned_at)  -- PK compuesta

-- Registros de acceso de invitados
guest_access_logs (id, guest_token, name, classroom_id, classroom_name, accessed_at)

-- Registros de acceso de lectores
reader_access_logs (id, reader_id → users, reader_name, accessed_at)
```

### Índices únicos clave

```sql
-- Evita respuestas duplicadas de estudiantes registrados
CREATE UNIQUE INDEX idx_responses_unique_attempt
ON worksheet_responses (worksheet_id, student_id)
WHERE student_id IS NOT NULL;

-- Evita respuestas duplicadas de invitados
CREATE UNIQUE INDEX idx_responses_unique_guest
ON worksheet_responses (worksheet_id, guest_token)
WHERE guest_token IS NOT NULL;
```

### Regla crítica de migraciones

**La BD ya está en producción con datos reales. NUNCA usar `DROP TABLE` o `DROP COLUMN`.**

```sql
-- CORRECTO
CREATE TABLE IF NOT EXISTS nueva_tabla (...);
ALTER TABLE worksheets ADD COLUMN IF NOT EXISTS nueva_col JSONB;

-- PROHIBIDO
DROP TABLE worksheets;
ALTER TABLE users DROP COLUMN email;
```

---

## 3. Tipos de Actividades (DSL)

Las hojas se crean con un DSL propio. El backend lo parsea (`backend/app/parser.py`) y guarda el resultado en `json_content`.

Lista canónica de tipos soportados: `SUPPORTED_BLOCKS` en `backend/app/parser.py`. Son **19** (abajo). Cualquier tipo fuera de esa lista es ignorado por el parser.

| Tipo | Descripción | Calificación | Estado |
|------|------------|-------------|--------|
| `fillblank` | Completar espacios inline con `_____` (5 guiones). `answer` string o array (uno por blank). | Auto (exacta); el profesor puede corregir a mano por typos | OK |
| `multiplechoice` | Selección con **una** respuesta correcta. `options` (lista) + `answer`. | Auto | OK |
| `multiselect` | Varias respuestas correctas. `answer` es **lista** de todas las correctas. | Auto | OK |
| `dragdrop` | Arrastrar palabras del banco a huecos `_____`. `answer` (lista por hueco) + `bank` (correctas + distractores). | Auto | OK |
| `matching` | Emparejar columna izquierda↔derecha **uniendo con líneas** (arrastrar desde el punto o tocar uno de cada lado; cada par toma un color). Correcto = mismo índice. Respuesta = `{ textoIzquierdo: valorDerecho }`. | Auto | OK |
| `truefalse` | Enunciados con `- texto \| true/false`. | Auto | OK |
| `textbox` | Respuesta abierta de texto largo (`prompt`). | Pendiente → IA/profesor | OK |
| `reading` | Texto de lectura (`content`, `\n`) + `questions` (abiertas). Puede ir sin preguntas como referencia. **Sin reproductor**: leerlo en voz alta convertiría la comprensión lectora en auditiva. | Preguntas: pendiente → IA/profesor | OK |
| `readingtruefalse` | Texto de lectura + enunciados True/False sobre él. | Auto | OK |
| `imagequestion` | Imagen (`image` URL) + pregunta abierta (`prompt`). | Pendiente → IA/profesor | OK |
| `speaking` | Micrófono. **Con `target`**: el alumno lee la oración en voz alta (se compara la transcripción). **Sin `target`**: pregunta abierta hablada (la IA evalúa gramática/contenido). Transcripción vía Groq Whisper; fallback de texto si no hay micrófono. | Con target: auto (match) · Sin target: pendiente → IA | OK |
| `listening` | Reproductor TTS que lee oración oculta al estudiante (`text`) + pregunta. | Auto | OK |
| `listeningfillblank` | Audio TTS + fill in the blank inline. `audio_text` nunca visible. | Auto | OK |
| `listeningmultiplechoice` | Audio TTS + selección múltiple. | Auto | OK |
| `listeningmatching` | N audios independientes + dropdown por cada uno. Usa bloques `pair {}`; `pairs[].audio_text` oculto. | Auto | OK |
| `listeningtruefalse` | Un audio + botones True/False por enunciado. `statements[].answer` es boolean. | Auto | OK |
| `listeningorder` | **Estilo Duolingo:** audio oculto (`audio_text`) + fichas desordenadas que el alumno toca/arrastra para armar la oración en orden. `answer` = fichas en orden; `bank` opcional (si falta, el front baraja `answer`). | Auto (orden exacto) | OK |
| `conversation` | **Diálogo con dos voces:** `lines` (cada turno `- m:`/`- f:`) se sintetizan con voz masculina/femenina y se **concatenan en un solo audio** (endpoint `/tts/conversation`) + `question`. `answer` opcional (con ella auto; sin ella pendiente → IA/profesor). | Con answer: auto · sin answer: pendiente | OK |
| `content` | **Repaso informativo (HTML):** `title` opcional + `html` (multilínea `"""..."""`) que se renderiza como mini-página (encabezados, colores, estilos inline, layout). **Solo lectura**, sin input. Dos modos: por defecto se sanea inline con **DOMPurify** (bloquea `<script>`/`onclick`/`javascript:`, integrado con el tema); con `sandbox: true` se renderiza el HTML **completo en un iframe aislado** (permite CSS/JS/fuentes propios sin filtrarse a la app). Sirve para explicar el tema antes de la evaluación. | No se califica (excluido del score) | OK |

> **Nota:** la nota anterior de "`speaking` NO IMPLEMENTADO" quedó obsoleta — `speaking` **sí** está implementado (ambos modos). Los listenings usan **TTS**, no archivos de audio: nunca usar un campo `audio:`.

### Grupos por habilidad (taxonomía pedagógica)

Los 19 tipos se agrupan por objetivo. Esta taxonomía existe en DOS lugares que deben mantenerse en sincronía: `ACTIVITY_GROUPS` en `WorksheetEditor.tsx` (chips del AiPanel) y la sección "PEDAGOGICAL GROUPS" de `_WORKSHEET_SYSTEM` en `ai.py`. Úsala también al armar hojas a mano (un `block {}` por grupo funciona bien):

| Grupo | Tipos |
|-------|-------|
| 🧱 Gramática y vocabulario (cerradas) | fillblank, dragdrop, multiplechoice, multiselect, matching, truefalse |
| 📖 Lectura | content (teoría), reading, readingtruefalse |
| 🎧 Comprensión auditiva | listening, listeningmultiplechoice, listeningtruefalse |
| 🎼 Escucha fina (dictado y orden) | listeningfillblank, listeningorder, listeningmatching |
| 🗣️ Producción oral | speaking, conversation |
| ✍️ Escritura abierta | textbox, imagequestion |

> **Voz por actividad (listening):** cualquier tipo `listening*` acepta un campo opcional `voice: male` o `voice: female` (default: preferencia global del usuario, masculina). Se normaliza en el parser (`_normalize_voice`) y baja hasta `AudioPlayer` (que ya aceptaba `voice`); `male`→`en-US-GuyNeural`, `female`→`en-US-JennyNeural`. Un valor desconocido se pasa tal cual como nombre de voz edge-tts. Solo aplica a listening (otros tipos lo ignoran). Sirve para evitar el desajuste "voz masculina lee la oración pero la pregunta dice *she*".

### Formato del Script DSL

> **⚠️ Lo de abajo es un CATÁLOGO de sintaxis por tipo, NO una hoja válida tal cual.** En una hoja real,
> si usas `block {}`, **todas** las actividades deben ir **dentro** de algún block: el parser ignora en
> silencio las actividades escritas fuera de un block cuando existe al menos uno (ver Reglas del DSL).

```
worksheet {
  title: "Título de la hoja"
  description: "Descripción\ncon saltos de línea"
  theme {
    primary_color: "#7C3AED"
    background_color: "#F5F3FF"
    text_color: "#2E1065"
  }

  block {
    title: "Part 1: Fill in the Blank"
    instructions: "Complete each sentence."

    fillblank {
      text: "She _____ happy yesterday."
      answer: "was"
      instructions: "Instrucción extra opcional."
    }
    fillblank {
      text: "Subject + _____ + verb.\n(Short form: _____)"
      answer: ["will", "won't"]
    }
  }

  multiplechoice {
    question: "Which is correct?"
    options:
    - Option A
    - Option B
    answer: "Option A"
  }

  multiselect {
    question: "Which words are adjectives?"
    options:
    - happy
    - quickly
    - tall
    answer:
    - happy
    - tall
  }

  dragdrop {
    text: "You kick the _____ in _____."
    answer:
    - ball
    - soccer
    bank:
    - ball
    - net
    - soccer
    - court
  }

  speaking {
    target: "I wake up at seven o'clock every day."
  }
  speaking {
    prompt: "What do you usually do on weekends?"
  }

  matching {
    left:
    - can
    - should
    right:
    - Ability
    - Advice
  }

  truefalse {
    statements:
    - The sun rises in the east. | true
    - Water freezes at 50°C. | false
  }

  reading {
    title: "School Rules"
    content: "Text here.\nMore text."
    questions:
    - Question 1?
    - Question 2?
  }

  readingtruefalse {
    title: "The Water Cycle"
    content: "Water evaporates from oceans..."
    statements:
    - Water evaporates from oceans. | true
    - Rain is created by wind alone. | false
  }

  listening {
    text: "Oración oculta al estudiante."
    question: "What did you hear?"
    answer: "key answer"
  }

  listeningfillblank {
    audio_text: "She was going to the store."
    text: "She _____ going to the _____."
    answer: ["was", "store"]
  }

  listeningmultiplechoice {
    audio_text: "The capital of France is Paris."
    question: "What is the capital of France?"
    options:
    - London
    - Paris
    - Berlin
    answer: "Paris"
  }

  listeningmatching {
    pair {
      audio_text: "I can swim."
      match: "Ability"
    }
    pair {
      audio_text: "You should rest."
      match: "Advice"
    }
    options:
    - Ability
    - Advice
    - Permission
  }

  listeningtruefalse {
    audio_text: "Dogs are mammals and birds can fly."
    statements:
    - Dogs are mammals. | true
    - Birds cannot fly. | false
  }

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

  conversation {
    lines:
    - f: "Hi, are you new here?"
    - m: "Yes, I started today."
    - f: "Welcome! Where are you from?"
    question: "Where did he start today?"
    answer: "at school"
  }

  content {
    title: "Repaso: Present Simple"
    html: """
    <h1 style="color:#0EA5E9">Present Simple</h1>
    <p>Usamos el presente simple para rutinas y hechos.</p>
    <p>3ª persona (he/she/it): verbo + <b>s</b>.</p>
    """
  }

  textbox {
    prompt: "Write your answer here."
  }

  imagequestion {
    image: "https://..."
    prompt: "What do you see in the image?"
  }

  info {
    fields:
    - Name
    - Date
    - Class
  }
}
```

### Reglas del DSL

- **UN CAMPO POR LÍNEA (la trampa que más rompe hojas):** `_get_scalar` busca `^\s*clave:\s*(.+)$` con `re.MULTILINE`, así que captura **hasta el fin de la línea**. Dos campos en la misma línea → el primero se traga el texto del segundo y el segundo queda `None`, sin error. `listening { text: "…" question: "…" answer: "…" }` en una línea deja la actividad sin pregunta ni respuesta. Un bloque de **un solo** campo sí funciona en línea (`textbox { prompt: "…" }`), pero no conviene depender de ello. La validación del parser (abajo) ya lo detecta al guardar.
- **El parser VALIDA antes de devolver** (`_activity_problem` / `_validate` en `parser.py`): lanza `WorksheetScriptError` con el número de actividad y el motivo cuando quedaría imposible de responder — campos en la misma línea, `matching` con lados desiguales, `dragdrop` con una palabra fuera del `bank`, menos `answer` que `_____`, `answer` que no coincide con ninguna opción, `listeningmatching` sin pares, actividad vacía. Antes todo esto se guardaba en silencio y el alumno se encontraba la pregunta rota. Al añadir un tipo hay que añadirle su regla ahí.
- `block {}` agrupa actividades con título e instrucciones de sección. Retrocompatible: hojas sin `block` siguen funcionando con `activities` plano.
- **`block {}` es excluyente (trampa clásica):** si la hoja tiene **al menos un** `block {}`, el parser toma **solo** las actividades que estén dentro de blocks e **ignora en silencio** las que queden fuera. Con blocks, TODA actividad va dentro de algún block. **La IA caía en esto**: ponía el `content` de repaso fuera de los bloques y desaparecía sin error. `_WORKSHEET_SYSTEM` ahora lleva la regla marcada como CRITICAL, con las dos formas válidas y una relectura final del output.
- **Enunciados True/False (`truefalse`, `readingtruefalse`, `listeningtruefalse`):** una línea por enunciado con **pipe**: `- Texto del enunciado. | true`. **NO** usar `- text: "…"` + `answer:` en líneas aparte (el parser corta en la primera línea que no empieza con `-` → queda UN solo enunciado con el texto literal `text: "…"` y `answer` en `true`). Formato alterno válido: bloques `statement { text: "…" answer: true }`.
- **`listeningmatching`: el formato canónico son bloques `pair {}`** — `pair { audio_text: "…" match: "…" }`, el campo es **`match`**, no `answer`. Desde julio 2026 `_parse_pairs` **también acepta la lista `pairs:`**, que es la que emite `dslSerializer.ts` y la que escribe la IA por costumbre YAML; antes se ignoraba en silencio, así que crear una `listeningmatching` en el constructor visual y guardarla **destruía la actividad** (quedaba sin pares → renderer vacío → calificada como pendiente). Las `options:` son lista en ambos formatos, y todo `match` debe aparecer en ellas.
- **`imagequestion` usa `image:` y `prompt:`** (no `image_url:` ni `question:`).
- `theme {}` define colores personalizados por hoja. Se guarda en la columna `theme` como JSONB.
- Cada actividad admite un campo opcional `instructions:` (guía por actividad).
- `_____` (5 guiones bajos) es el marcador de espacio en `fillblank` / `dragdrop`.
- `\n` literal en strings se convierte a salto de línea real en el frontend.
- **Comillas dentro de un string:** usar tipográficas `“ ”`. Las `\"` quedan literales (el parser solo quita las comillas exteriores) y se verían con backslash.
- `speaking` **sí** existe (ver tabla). La nota histórica de "no usar" está obsoleta.
- **Campos de `info {}`:** son **strings planos**, uno por línea (`- Name`, `- Date`), **NO** `- label: "Name"`. El parser toma el texto tal cual tras el guion, así que `- label: "Name"` se mostraría literal como el nombre del campo.
- **Al generar hojas para el usuario:** entregar solo el DSL en el chat (ver memoria `worksheet-delivery`). Validar con `parse_worksheet_script` de `backend/app/parser.py` de forma transitoria si hace falta.

**Campos de identificación (`_info_*`)**: una hoja puede pedir datos al alumno (nombre, sección, etc.); se guardan en `answers_json._info_0`, `_info_1`… y el profesor los ve en la revisión.

### Guía de calidad al generar hojas (LEER antes de crear una hoja)

Cuando el usuario pida generar una hoja de trabajo, seguir estas reglas para que la evaluación sea sólida y no trivial. Aplican al **contenido** (más allá de que el DSL sea válido).

**Respuestas y distractores**
- **Evitar respuestas evidentes:** los distractores deben ser *plausibles* y del mismo tipo/categoría que la respuesta correcta (mismo tiempo verbal, misma clase de palabra, mismo tema). Un distractor absurdo o de otra categoría regala la respuesta.
- **Distractores mínimamente diferentes** cuando el objetivo es discriminación fina (p. ej. tiempos verbales): que se distingan por *una* característica (presente/pasado, afirmativa/negativa/pregunta, singular/plural), no por ser palabras totalmente distintas. Ej.: para `wakes up`, distractores `woke up` / `waking up`, no `runs` / `sleeps`.
- **Sin pistas dentro de la pregunta:** la pregunta o el enunciado no debe contener la respuesta ni delatarla por concordancia obvia.
- **Sin respuesta revelada en otra actividad:** una actividad no debe dar la respuesta de otra.

**Evitar patrones predecibles** (un alumno no debe poder acertar "por el patrón" sin saber)
- **No agrupar por tipo si eso crea un patrón de respuesta:** si un bloque entero comparte la misma mecánica y la clave sigue un orden, el alumno responde en piloto automático. Cuando el objetivo es discriminar (ej. presente vs. pasado), **mezclar** los ítems en un solo bloque en orden variado, no “todas las de presente juntas / todas las de pasado juntas”.
- **`truefalse` / `readingtruefalse` / `listeningtruefalse`:** variar el patrón de `answer` (no todas `true`, no alternancia mecánica true/false/true/false). Mezcla irregular.
- **`multiplechoice` / `multiselect` / `dragdrop`:** la app **baraja las opciones al mostrarlas**, así que la *posición* de la correcta en el DSL no importa — pero **sí** variar cuál es la correcta entre ítems (no repetir siempre el mismo valor/idea).
- **`fillblank`:** que la respuesta no sea siempre la misma palabra ni siga un patrón obvio a lo largo de la hoja.

**Nivel y coherencia**
- Respetar el **nivel** pedido (A1/A2/B1…): vocabulario, longitud de oración y estructuras acordes. En listening de discriminación fina, **oraciones cortas** para que la palabra objetivo pese en el audio.
- Mantener un **tema/hilo** coherente en toda la hoja cuando aplique.
- **`fillblank` sin ambigüedad:** el hueco debe tener una respuesta esperada clara. Si hay varias válidas legítimas, usar `answer` como **lista** o replantear el ítem (el corrector IA valida equivalencias, pero no conviene depender de eso).

**`content` como repaso (§8 de la revisión de julio 2026)**
- El `content` sirve para **recordar la regla**, no para resolver la hoja. Es opcional: se añade cuando el profesor pide repaso/teoría o cuando el alumno ve el tema por primera vez.
- Cuando se incluye debe traer: la regla en 1–2 líneas en lenguaje sencillo (explicación en español + ejemplos en inglés), la **forma** (estructura afirmativa / negativa / pregunta), 2–3 oraciones de ejemplo y el error típico a evitar.
- **Sus ejemplos NO pueden ser oraciones de los ejercicios ni contener ninguna respuesta.** Va primero, en su propio `block`.

**Recordatorios técnicos que también son errores de generación**
- `info {}` usa strings planos (`- Name`), no `- label: "…"` (ver Reglas del DSL).
- Cada campo del DSL en **su propia línea** (el parser es por líneas): no poner `text:` y `answer:` en la misma línea.
- Listenings usan **TTS**, nunca un campo `audio:`. El `audio_text`/`text` oculto nunca debe repetir la pregunta visible de forma que delate la respuesta.
- Comillas internas: usar tipográficas `“ ”` (las `\"` quedan literales).

---

## 4. Estructura del Proyecto

```
potential-carnival/
├── backend/
│   ├── app/
│   │   ├── main.py        — Endpoints FastAPI y lógica de auth
│   │   ├── repository.py  — Queries a la BD (patrón Repository)
│   │   ├── database.py    — Conexión y migración de BD
│   │   ├── models.py      — Modelos Pydantic
│   │   ├── domain.py      — Dataclasses internos (ActivityData, BlockData, WorksheetData)
│   │   ├── parser.py      — Parser del DSL → WorksheetData (SUPPORTED_BLOCKS)
│   │   ├── ai.py          — Groq: generación de hojas, calificación IA, resumen, Whisper (transcribe)
│   │   └── security.py    — JWT y hashing PBKDF2-SHA256
│   └── requirements.txt
├── src/
│   ├── App.tsx                    — Portal profesor/admin/estudiante (revisión de respuestas incluida)
│   ├── pages/
│   │   ├── GuestPage.tsx          — Portal de invitado (sin login) + NameEntry
│   │   ├── LoginPage.tsx          — Login (student/teacher/admin/reader)
│   │   ├── ReaderPortal.tsx       — Portal de vocabulario (rol reader)
│   │   └── VocabPublicPage.tsx    — Vocabulario público (/vocab)
│   ├── components/
│   │   ├── WorksheetRenderer.tsx  — Renderiza hojas al estudiante
│   │   ├── activityRegistry.tsx   — Componentes de cada tipo de actividad
│   │   ├── WorksheetEditor.tsx    — Editor de hojas para el profesor
│   │   ├── submitAnimations.tsx   — Animaciones de resultado de envío (cohete/pastel/paracaidista) + SFX ZzFX
│   │   ├── LoadingScreen.tsx      — Spinner / pantalla de carga compartida
│   │   ├── WorksheetPrint.tsx     — Vista imprimible (papel) + impresión nativa → PDF; omite listening/speaking
│   │   └── RichText.tsx           — Renderiza texto con saltos de línea
│   └── ...
├── db/
│   ├── schema.postgres.sql            — Schema completo de PostgreSQL
│   └── schema.sql                     — Schema SQLite (desarrollo)
├── scripts/
│   └── init_db.py                     — Inicializa y migra la BD manualmente
├── docs/                              — Documentación adicional
├── public/                            — Assets estáticos
├── package.json                       — Dependencias frontend
├── render.yaml                        — Configuración de deploy en Render.com
├── tsconfig.json
└── tsconfig.app.json
```

---

## 5. Endpoints Completos

### Autenticación y Sesión

```
POST   /auth/login                           — Login (username, password, role)
POST   /auth/google                          — Login Y registro con ID token de Google (crea profesor si no existe)
# NO existe alta pública con usuario/contraseña: se eliminó a propósito (ver §11)
POST   /auth/logout                          — Cerrar sesión
GET    /auth/me                              — Perfil del usuario actual
```

### Gestión de Usuarios

```
POST   /students                             — Crear estudiante (teacher/admin)
GET    /students                             — Listar estudiantes
DELETE /students/{id}                        — Eliminar estudiante

POST   /teachers                             — Crear profesor (admin)
GET    /teachers                             — Listar profesores (admin)
DELETE /teachers/{id}                        — Eliminar profesor (admin)

POST   /readers                              — Crear lector (teacher/admin)
GET    /readers                              — Listar lectores
DELETE /readers/{id}                         — Eliminar lector

PUT    /users/{id}                           — Editar nombre/email de usuario
PUT    /users/{id}/password                  — Cambiar contraseña (readers no pueden)
```

### Hojas de Trabajo

```
POST   /worksheets                           — Crear hoja desde script DSL
PUT    /worksheets/{id}                       — Editar hoja en el sitio (409 si ya tiene respuestas)
POST   /worksheets/ai-generate               — Generar hoja con IA desde prompt
GET    /worksheets                           — Listar hojas (filtradas por dueño)
GET    /worksheets/{id}                      — Detalle de hoja
POST   /worksheets/{id}/publish              — Publicar hoja
POST   /worksheets/{id}/unpublish            — Despublicar hoja
POST   /worksheets/{id}/archive              — Archivar hoja
POST   /worksheets/{id}/unarchive            — Restaurar hoja archivada
DELETE /worksheets/{id}                      — Eliminar hoja
POST   /worksheets/{id}/duplicate            — Duplicar hoja (nueva copia)
GET    /worksheets/response-counts           — Conteo de respuestas por hoja (bulk)
```

### Aulas (Classrooms)

```
POST   /classrooms                           — Crear aula
GET    /classrooms                           — Listar aulas del profesor
GET    /classrooms/{id}                      — Detalle de aula (con estudiantes y hojas)
DELETE /classrooms/{id}                      — Eliminar aula
PATCH  /classrooms/{id}/visibility           — Cambiar visibilidad (pública/privada)

POST   /classrooms/{id}/students             — Asignar estudiante a aula
DELETE /classrooms/{id}/students/{sid}       — Desasignar estudiante

POST   /classrooms/{id}/worksheets           — Asignar hoja a aula
DELETE /classrooms/{id}/worksheets/{wid}     — Desasignar hoja

GET    /worksheets/{id}/classrooms           — Aulas que usan una hoja
```

### Respuestas y Calificación

```
POST   /responses                            — Enviar respuestas (estudiante autenticado)
POST   /worksheets/{id}/practice             — Modo práctica del profesor: califica sin guardar (dry-run, solo auto)
GET    /worksheets/{id}/responses            — Ver todas las respuestas de una hoja
GET    /students/{id}/responses              — Ver respuestas de un estudiante
DELETE /responses/{id}                       — Eliminar respuesta (teacher/admin)
POST   /responses/{id}/review                — Agregar comentario de revisión manual
```

### Vocabulario

```
POST   /vocabulary                           — Crear lista de vocabulario
GET    /vocabulary                           — Listar listas del profesor
GET    /vocabulary/{id}                      — Detalle de lista
DELETE /vocabulary/{id}                      — Eliminar lista

POST   /vocabulary/{id}/assign               — Asignar lista a aula
DELETE /vocabulary/{id}/assign/{classroom_id} — Desasignar de aula
GET    /vocabulary/{id}/classrooms           — Aulas con esta lista asignada

POST   /vocabulary/{id}/readers              — Asignar lista a lector directo
DELETE /vocabulary/{id}/readers/{reader_id}  — Desasignar de lector
GET    /vocabulary/{id}/readers              — Lectores con esta lista

GET    /students/{id}/vocabulary             — Listas de vocabulario del estudiante (via aula)
GET    /readers/{id}/vocabulary              — Listas de vocabulario del lector (directo)
```

### Portales de Estudiante y Lector

```
GET    /students/{id}/worksheets             — Hojas del estudiante (filtradas por aula)
GET    /students/{id}/classrooms             — Aulas del estudiante
GET    /students/{id}/sessions               — Historial de sesiones del usuario

GET    /teacher/notifications                — Respuestas recientes (últimas 48 horas)
GET    /students/activity                    — Estado online/offline de estudiantes

GET    /dashboard/teacher                    — Métricas del profesor
GET    /tts?text=...&voice=en-US-GuyNeural  — Generar audio TTS
GET    /tts/conversation?lines=...          — Audio de diálogo (voces m/f alternadas, MP3 concatenado)
# Público / invitado (sin JWT)
GET    /public/classrooms                    — Aulas públicas (selector de invitado)
GET    /public/classrooms/{id}/worksheets    — Hojas del aula (invitado)
GET    /public/worksheets/{id}               — Cargar hoja PUBLICADA por id (enlace directo, sin login/aula)
POST   /public/guest-sessions                — Registrar acceso de invitado
POST   /public/responses                     — Enviar respuestas como invitado
GET    /public/responses?guest_token=...     — Respuestas del invitado (calificadas)
GET    /public/readers-vocabulary            — Vocabulario público (/vocab)
POST   /public/transcribe                    — Audio (speaking) → texto (Groq Whisper)
```

**Importante:**
- `GET /students/{id}/worksheets` NO tiene fallback a todas las hojas publicadas. Si el estudiante no tiene aula asignada, no ve ninguna hoja.
- Los endpoints `/public/*` no llevan JWT; identifican al invitado por `guest_token` determinístico (aula + nombre).
- La calificación IA (`ai_grade_activities(details, título, tolerancia)`) corre **en el POST de respuestas** cuando la hoja tiene `ai_grading` activo. La `ai_tolerance` de la hoja elige el bloque de reglas del system prompt (`_grade_system` en `ai.py`).

---

## 6. Integración con IA (`backend/app/ai.py`)

### Proveedores soportados

| Proveedor | Modelo | Prioridad |
|-----------|--------|-----------|
| Google Gemini | `gemini-3.1-flash-lite` | Primero (si `GEMINI_API_KEY` existe) |
| Groq | `llama-3.3-70b-versatile` | Fallback (si `GROQ_API_KEY` existe) |

### Funciones

- **`generate_worksheet_script(prompt)`** — Convierte un prompt en lenguaje natural a un script DSL válido. Usa el system prompt `_WORKSHEET_SYSTEM`, que instruye al modelo sobre **los 19 tipos** y sobre los **grupos pedagógicos** (misma taxonomía que `ACTIVITY_GROUPS` del AiPanel). Ojo: dentro del string Python, las triple comillas del ejemplo de `content` van escapadas (`\"\"\"`). Desde la revisión de julio 2026 lleva además: la **regla de oro de un campo por línea**, una sección **"lo que la plataforma NO puede hacer"** (sin archivos de audio, sin imágenes que la IA pueda aportar, sin dibujo/entrada numérica/tablas/temporizador, todas las actividades valen lo mismo), una línea **`Limits:` por tipo** (para que no invente actividades imposibles o poco intuitivas), **reglas de calidad** (distractores plausibles del mismo tipo, no revelar la respuesta, variar la correcta, mezclar true/false, no agrupar creando patrón), la guía de **`content`** y un **checklist final** de 9 puntos.

> **Los cuatro sitios que enseñan el DSL deben mantenerse sincronizados:** `WORKSHEET_DSL.md` (referencia completa), `CLAUDE.md` §3 (este resumen), `_WORKSHEET_SYSTEM` en `ai.py` (prompt interno) y `GENERATION_PROMPT` en `src/utils/generationPrompt.ts` (el prompt que el profesor copia para pegarlo en otra IA). La lista canónica es `SUPPORTED_BLOCKS` en `parser.py`. El test `test_every_documented_type_parses` escribe una hoja con los 19 tipos usando la sintaxis documentada y falla si la documentación empieza a enseñar algo que no funciona.
- **`ai_grade_activities(details, worksheet_title, tolerance)`** — Califica respuestas pendientes (textbox, imagequestion, reading, speaking abierto) y re-juzga las que el corrector exacto marcó incorrectas. Solo puede cambiar status de actividades `pending` o `incorrect`. Los comentarios del profesor se agregan en español.

### Lógica de calificación IA

1. Respuestas auto-calificadas como correctas → **no se le envían** (ahorra tokens y evita comentarios inútiles)
2. `_AI_RESCUABLE = {fillblank, listeningfillblank, listening, conversation}` → son los únicos donde puede convertir `incorrect` en `correct`. Son los tipos en que el alumno **escribe** la respuesta y el auto-corrector la compara por igualdad exacta, así que un acierto legítimo (sinónimo, respuesta corta, dedazo) falla. `listening` y `conversation` estaban fuera hasta julio 2026 y quedaban incorrectas para siempre aunque el contenido fuera correcto — con una clave tipo `answer: "Because her boss needed the report."` era prácticamente imposible acertar.
3. Lo que se elige con **clic** (multiplechoice, truefalse, matching, multiselect, dragdrop, listeningorder, speaking con `target`) no se rescata: el exacto ya es la verdad. La IA solo escribe el comentario que explica la regla.
4. `pending` → la IA decide `correct` / `incorrect` (`partial` se guarda como `incorrect`)
5. La IA **nunca** puede marcar como incorrect algo que el auto-grader marcó correct
6. **Contexto:** `AnswerDetail.context` le dice qué escuchó/leyó el alumno (diálogo, `text`/`audio_text` del audio, texto de lectura). Sin él no puede juzgar una respuesta abierta a un audio. El prompt además explicita dos límites: en `speaking` la respuesta es una **transcripción** (no se penaliza ortografía ni puntuación) y en `imagequestion` el modelo **no ve la imagen** (juzga el idioma y la estructura pedida, no si la descripción es cierta).

---

## 7. Seguridad (`backend/app/security.py`)

- **JWT:** HS256, expiración configurable (por defecto 480 minutos = 8 horas)
- **Passwords:** PBKDF2-SHA256, 390,000 iteraciones, con salt aleatorio
- **Rehash:** Soporte para migrar hashes legacy a iteraciones actuales
- **CORS:** Controlado por `FRONTEND_ORIGINS` (separado por comas)
- **Roles en endpoints:** Verificados con dependencias FastAPI en cada ruta

---

## 8. Componentes Frontend Clave

### `RichText.tsx`
Convierte `\n` literal (almacenado en BD) a salto de línea real.
```tsx
const processed = (text ?? '').replace(/\\n/g, '\n');
return <span className={`whitespace-pre-line ${className}`}>{processed}</span>;
```

### `activityRegistry.tsx` — FillBlank
El marcador `_____` (5 guiones bajos) se reemplaza por un `<input>` inline.
```tsx
const processed = activity.text.replace(/\\n/g, '\n');
const parts = processed.split('_____');
// Renderiza: texto + <input> + texto + <input> ...
```

### `WorksheetRenderer.tsx` — Bloques y temas
Soporta formato con bloques Y formato anterior sin bloques (retrocompatible).
```tsx
const blocks = worksheet.blocks?.length
  ? worksheet.blocks
  : [{ title: null, instructions: null, activities: worksheet.activities }];
```
Los colores del tema se aplican via estilos inline desde `worksheet.theme`.

### `WorksheetEditor.tsx` — Tres modos de edición
1. **Script Mode** — Edición directa del DSL con validación antes de guardar
2. **Visual Mode** — Builder drag-and-drop (VisualWorksheetBuilder)
3. **IA Mode** — Prompt en lenguaje natural → genera DSL via API. El `AiPanel` (en `WorksheetEditor.tsx`) es un **constructor de prompt**: **presets** de un clic (Warm-up, Weekly Quiz, Monthly Test…) + **chips** (nivel, tema, objetivo, enfoque, edad, duración, dificultad, actividades) que **componen el prompt en vivo** (`composePrompt`) en el textarea, editable a mano. Solo frontend: alimenta el mismo `generateWorksheetWithAI` → `/worksheets/ai-generate`. Los chips de "Actividades" cubren **los 19 tipos** y hay chips de **grupos por habilidad** (`ACTIVITY_GROUPS`: Gramática y vocabulario / Lectura / Comprensión auditiva / Escucha fina / Producción oral / Escritura abierta — un clic activa el set completo; misma taxonomía que conoce el prompt del backend). Son sugerencia a la IA, no garantía dura.

### `main.tsx` — Rutas

| Ruta | Componente | Roles |
|------|-----------|-------|
| `/login` | LoginPage | público |
| `/registro` | RegisterPage | público (solo crea profesores) |
| `/`, `/acerca`, `/actividades`, `/aprende` | SiteLayout + páginas del sitio | público |
| `/student/:section?` | App (modo student) | student |
| `/teacher/:section?` | App (modo teacher) | teacher, admin |
| `/admin/:section?` | App (modo admin) | admin |
| `/reader` | ReaderPortal | reader |
| `/guest` | GuestPage | público — **entradas ocultas en la UI** (solo por URL) |
| `/vocab` | VocabPublicPage | público |
| `/w/:worksheetId` | DirectWorksheetPage | público (enlace directo) |

### `services/api.ts`
Cliente HTTP centralizado. Todas las llamadas a la API deben pasar por aquí. Maneja el token JWT automáticamente (desde localStorage).

---

## 9. Variables de Entorno

### Backend (Render)
| Variable | Valor |
|----------|-------|
| `DATABASE_URL` | PostgreSQL. **La BD se migró de Render a Aiven** — Aiven añade unos segundos de latencia en la primera consulta (por eso los spinners de carga). |

> **Nota de infraestructura:** el backend en Render **NO se apaga** — un monitor de **UptimeRobot** lo mantiene despierto (no hay cold start de 15 min). La lentitud percibida viene de la **carga/latencia de la BD**, no de que el servicio se duerma. Al optimizar rendimiento, enfocarse en reducir carga de BD (pool de conexiones, menos round-trips/N+1, caché de lecturas), no en el arranque del servicio.
| `JWT_SECRET_KEY` | Clave secreta JWT |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | 480 |
| `FRONTEND_ORIGINS` | `https://constructor-hojas-web.onrender.com` |
| `SEED_DEMO_USERS` | `false` en producción |
| `GROQ_API_KEY` | Groq: generación de hojas, **calificación IA** de respuestas abiertas y **transcripción Whisper** (speaking). |
| `GEMINI_API_KEY` | Gemini: generación de hojas y calificación (se intenta antes que Groq salvo en calificación, que usa `prefer_fast`). |
| `GEMINI_MODEL` | Opcional. Modelo de Gemini; por defecto `gemini-3.1-flash-lite`. La URL se arma con él (una sola fuente de verdad). |
| `GOOGLE_CLIENT_ID` | Client ID de OAuth (Web) de Google. **Obligatoria** para `/auth/google`: sin ella el endpoint responde 503 (no se puede validar el claim `aud`). |

### Frontend (Render)
| Variable | Valor |
|----------|-------|
| `VITE_API_URL` | `https://constructor-hojas-api.onrender.com` |
| `VITE_GOOGLE_CLIENT_ID` | El **mismo** Client ID que el backend. Sin ella el botón de Google no se muestra. |

---

## 10. Reglas para Claude Code

### Base de datos
- **NUNCA** usar `DROP TABLE` o `DROP COLUMN`.
- Siempre usar `CREATE TABLE IF NOT EXISTS` y `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- El campo `due_date` en `classroom_worksheets` es nullable — no asumir que siempre existe.
- El campo `is_public` en `classrooms` es booleano — en SQLite se almacena como INTEGER (0/1).

### Backend
- Todos los endpoints nuevos deben respetar la autenticación JWT existente (usar las dependencias FastAPI de auth).
- Contraseñas siempre hasheadas con PBKDF2-SHA256 (`security.hash_password()`).
- TTS usa `edge-tts` con voz `en-US-GuyNeural` y retorna `audio/mpeg`.
- `speaking` **sí** está implementado (ver §3). No borrarlo ni tratarlo como inexistente.
- El parser DSL está en `backend/app/parser.py`. Al modificarlo, mantener retrocompatibilidad (hojas sin `block {}` deben seguir funcionando).
- La BD está en **Aiven** (no Render). Toda pantalla que dependa de la primera consulta debe mostrar spinner (`LoadingScreen`/`Spinner`).
- Al pedir el usuario una hoja de trabajo: entregar solo el DSL en el chat, sin crear archivo aparte (memoria `worksheet-delivery`).
- `db/schema.sql` (SQLite) y `db/schema.postgres.sql` deben mantenerse en paralelo: una tabla que solo esté en uno revienta en el otro entorno.

### Frontend
- **Modo oscuro: no tocar el JSX.** Para que una pantalla se vea bien en oscuro se añade una regla al bloque `:root[data-theme='dark']` de `app.css` repintando la clase de Tailwind que ya usa. Nada de props `theme` ni de `useTheme()` en componentes de pantalla (solo lo usan el interruptor y las capturas de `/aprende`).
- **Las secciones del portal son rutas**, no estado: para añadir una, se agrega a `TEACHER_SECTIONS` en `App.tsx` y al `GROUPS` de `TeacherDashboard.tsx`.

---

## 11. Estado del Sistema

### Funciona correctamente
- Login JWT con roles (student, teacher, admin, reader)
- CRUD profesores, estudiantes, hojas de trabajo
- Creación de hojas con IA vía script DSL / editor
- Publicar / despublicar / archivar hojas
- **Los 19 tipos de actividad** de §3 (incluye multiselect, dragdrop, truefalse, readingtruefalse, speaking, listeningorder, conversation y content)
- Instrucciones por actividad + campos de identificación `_info_*`
- RichText con `\n`, theme por hoja, bloques
- Sistema de aulas: crear, asignar estudiantes y hojas; estudiantes solo ven hojas de su aula
- `max_attempts`; prevención de doble envío (bloqueo 5 s + HTTP 409 + índice único BD)
- Dashboard con gráficas; vista previa de hoja
- TTS `en-US-GuyNeural`

### Funciones recientes (rama `feat/student-ux`)
- **Acceso de invitado** (`/guest`): el alumno entra con nombre + aula pública, sin cuenta. Es el flujo priorizado (ver memoria `usage-direction`). También portal `reader` y `/vocab` públicos.
- **Enlace directo por hoja** (`/w/:worksheetId`, `DirectWorksheetPage`): la forma más simple de compartir una hoja. El profesor toca "Copiar enlace" (solo en hojas publicadas) y comparte la URL; el alumno entra **sin login, sin menú de invitado y sin pedir nombre** (el nombre lo captura el campo `info {}` de la propia hoja → `nameFromAnswers` toma el primer `_info_*`; si no hay, "Sin nombre"), resuelve y envía. Reusa `POST /public/responses` (cada envío usa un `guest_token` **nuevo** → respuesta independiente; el backend no bloquea con token fresco) y `GET /public/worksheets/{id}` (carga la hoja publicada por id, UUID no adivinable = URL-capability). Las respuestas llegan a la vista de respuestas del profesor como cualquier envío de invitado. **Respeta `max_attempts` por dispositivo** (contador `dw_count_{id}` en localStorage, estilo liveworksheets): ilimitada (`maxAttempts` null) → "Volver a hacerla" las veces que quiera; limitada (ej. 1) → N intentos por dispositivo, luego pantalla de límite. El límite es per-dispositivo (localStorage), coherente con el modelo suave de invitado ya existente (no hay identidad server-side).
- **Calificación por IA** (`ai.py`, Groq): toggle `ai_grading` por hoja. Las respuestas abiertas quedan `pending`; si el toggle está activo, la IA califica gramática/contenido con comentario en español (badge "✦ IA"). Además: generación de hojas por IA y resumen de desempeño.
- **Barra de tolerancia de la IA** (`ai_tolerance`, 0–100 por hoja): en el editor, bajo el toggle de IA. `_grade_system(tolerance)` en `ai.py` arma el system prompt eligiendo uno de **tres bloques de reglas concretas** (≤33 Estricta, ≤66 Equilibrada, >66 Permisiva) en vez de pasarle un número suelto al modelo — obedece mucho mejor una lista de casos ("perdona la puntuación final y un dedazo; marca error si cambia el tiempo verbal"). La tolerancia **nunca** perdona el contenido que la actividad evalúa. El prompt además explica campo por campo qué recibe el modelo, en qué orden decidir (¿responde a la pregunta? → ¿contenido correcto? → forma) y trae una sección ANTI-REDUNDANCY (no repetir la respuesta completa, no explicar dos veces lo mismo, prohibido "revisa de nuevo" sin regla). Cubierto por `backend/tests/test_grade_prompt.py`.
- **Speaking** con micrófono: transcripción vía Groq Whisper (fallback de texto).
- **Animaciones de resultado de envío** (`submitAnimations.tsx`): al enviar se elige una **al azar** (cohete / pastelero / paracaidista). Umbral de éxito **≥ 70** (`PASS_THRESHOLD`). Efectos de sonido con **ZzFX** (sintetizado, sin archivos). Para añadir más: registrar en `SUBMIT_ANIMATIONS`.
- **Spinners de carga** (`LoadingScreen`/`Spinner`) en portales, login, hojas y respuestas — por la latencia de Aiven.
- **Revisión de respuestas (profesor):** al entrar **ninguna** respuesta viene seleccionada; se elige un alumno para ver su detalle. `fillblank`/`listeningfillblank` muestran siempre controles de corrección manual.
- **Modo práctica (profesor):** botón "Modo práctica" (en la lista de evaluaciones y en la vista previa) abre la hoja **interactiva** (`WorksheetRenderer` no-readonly) para que el profesor la resuelva y verifique su clave de respuestas. "Revisar respuestas" llama a `POST /worksheets/{id}/practice` (`practiceGrade`), que reusa `_build_answer_details` + `_score_details` y devuelve puntaje/detalle **sin guardar nada** (dry-run, solo auto-calificación; sin IA). Estado `practiceWorksheet`/`practiceAnswers`/`practiceResult` en `App.tsx`. Tras revisar: resumen (puntaje + correctas/incorrectas/abiertas) **y resaltado inline** de cada actividad (prop `gradeStatus` en `WorksheetRenderer`; `buildGradeStatus` agrega los ids compuestos `id:índice` de matching/truefalse con precedencia incorrecto > abierta > correcto).
- Portal del estudiante con pestañas "Activas" / "Calificadas"; drag&drop con click-to-place.
- **Editar hoja en el sitio** (`PUT /worksheets/{id}`, `updateWorksheet`): "Editar" abre la MISMA hoja en el editor (script o visual) y "Guardar cambios" la actualiza (no crea copia). Bloqueado (409 + botón deshabilitado) si ya tiene respuestas. Estado `editingWorksheetId` en `App.tsx`.
- **Constructor visual completo**: soporta los **19 tipos** (agregados multiselect, dragdrop, readingtruefalse, speaking, listeningorder, conversation, content) y round-trip del `theme` **y de `info {}`** (sección "📋 Campos de identificación" a nivel de hoja, con `StringListEditor`; `VisualState.infoFields` + serializa `info { fields: … }` + `worksheetToVisualState` captura `infoFields`). Ver `dslSerializer.ts` (serialización) y `VisualWorksheetBuilder.tsx` (import `activityToVisual` + editores). Nota: `info {}` es a nivel de **hoja** (como el tema), no una actividad, por eso vive en su propia sección y no en el selector de tipos.
- **`content` (repaso HTML, no calificable):** bloque informativo de solo lectura. DSL `content { title html: """<html>""" }`. **Dos modos de render:** (a) por defecto, saneado inline con **DOMPurify** (`ContentRenderer`→`InlineContent`; `.rich-content` en app.css restaura tipografía que Tailwind resetea; se integra con el tema y se imprime); (b) `sandbox: true` → `SandboxedHtml.tsx` renderiza el HTML **completo** en un `<iframe sandbox="allow-scripts">` (SIN `allow-same-origin`): permite CSS/JS/fuentes propios, aislado de la app (no toca DOM/cookies/localStorage del portal). Ambos modos se muestran en un **recuadro de altura acotada** (`maxHeight` 560px): si el contenido es más alto, hace scroll interno y aparece el aviso `ScrollHint` ("↕ Desliza…"); si es más corto, el recuadro se ajusta al contenido. El sandbox reporta su altura vía `postMessage` (snippet inyectado en el srcDoc; el padre valida `e.source`); el inline detecta overflow con `ResizeObserver`. En impresión siempre se usa la versión saneada estática. Excluido de la calificación (`_build_answer_details` hace `continue`) y del chrome "Actividad N/Interactiva". Editor visual con toggle "Página completa" + vista previa en vivo.
- **Parser robusto a llaves en HTML** (`_matching_brace` en parser.py): el buscador de bloques ignora las llaves dentro de `"""..."""`, así que un `content` con `<style>{}`/`<script>{}`/`@keyframes{}` ya **no** rompe el parseo. Usado por `_extract_block`, `_find_all_keyword_blocks`, `_parse_info_fields`, `_parse_theme` y `_find_activity_blocks`. (Con esto se levantó la limitación anterior de "llaves balanceadas".)
- **`conversation` (diálogo con dos voces fusionadas):** cada turno (`- m:`/`- f:`) se sintetiza con voz masculina/femenina y se concatena en un solo MP3 (`GET /tts/conversation`, `AudioPlayer` prop `conversation`). Renderer `ConversationRenderer` (audio + pregunta). Calificación como `listening` (auto si hay `answer`, si no pendiente). ponytail: concatenación cruda de frames MP3; si hace falta pausa marcada entre turnos, intercalar un MP3 de silencio.
- **`listeningorder` (escuchar + ordenar, estilo Duolingo):** audio oculto + fichas desordenadas que se tocan/arrastran para armar la oración. Renderer `ListeningOrderRenderer` (tap-to-place); calificación por orden exacto en `_build_answer_details` (main.py). El campo `voice` (§3) requirió añadirlo también al modelo Pydantic `Activity` (models.py) y a `normalizeActivity`/`withInstructions` (api.ts) — sin eso el campo se descartaba al persistir/leer.
- **Vista previa al crear/editar**: al guardar (script o visual) se abre la vista previa del estudiante (`WorksheetRenderer` readonly) con botón "Editar".
- **Sonidos de clic** (`utils/sfx.ts`, ZzFX): al elegir opción, multiselect, drag&drop, matching, true/false y variantes de listening suena un blip corto. El primer clic habilita el audio.
- **Imprimir hoja en papel / PDF** (`WorksheetPrint.tsx`): botón "Imprimir PDF" en el portal del profesor (lista de evaluaciones y barra de revisión). Vista de papel compacta vía `createPortal(document.body)` + impresión nativa (`window.print()` → Guardar como PDF); en `@media print` se oculta `#root`. Omite actividades `listening*`/`speaking` (no pasan a papel) y deja líneas/casillas para escribir.

### Cuentas, tema y navegación (julio 2026)
- **Tema claro/oscuro global** (`src/utils/theme.ts` + bloque `@media screen { :root[data-theme='dark'] … }` al final de `app.css`): el tema vive **solo** en el atributo `data-theme` de `<html>` (`initTheme()` lo aplica en `main.tsx` antes del primer render, sin parpadeo). **Claro es el predeterminado**. El modo oscuro es CSS puro: repinta las MISMAS clases de Tailwind que ya usan las pantallas (`.bg-white`, `.text-slate-500`, `.bg-rex-light`…), así que **ningún componente sabe que existe un tema** — igual que el SKIN de cristal. Cubre login, registro, portales de profesor/admin/estudiante, vocabulario y hojas. Va dentro de `@media screen`: al imprimir el papel siempre es blanco. Interruptor: `ThemeToggle.tsx` (app) y `.site-theme-toggle` (sitio público), ambos sobre `toggleTheme()`. Para pintar una clase nueva que quede fea en oscuro, se añade una línea a ese bloque; las variantes con opacidad (`bg-rex-light/70`) necesitan su propio selector `[class*='bg-rex-light\/']` porque Tailwind genera una clase por porcentaje.
- **Registro de profesor: SOLO con Google** (`RegisterPage.tsx` en `/registro`). No hay formulario de usuario/contraseña y **no existe endpoint público de alta con contraseña**: se eliminó `POST /auth/register` en vez de solo esconder el botón, porque dejar la ruta abierta no habría cambiado nada. El motivo es de producción: no hay forma de comprobar que un correo escrito a mano sea de quien se registra, y Google entrega el correo ya verificado (`email_verified`). Vías cerradas que siguen existiendo: el admin crea profesores (`POST /teachers`) y el profesor crea a sus alumnos.
- **Login y registro con Google** (`POST /auth/google`, `GoogleSignInButton.tsx`) — la **única** alta pública: Google Identity Services devuelve un **ID token** que el backend valida contra `https://oauth2.googleapis.com/tokeninfo` (con `httpx`, sin librería nueva) comprobando `aud`, `iss` y `email_verified`. Si el correo no existe se crea un profesor con contraseña aleatoria (solo entra por Google). **No se usa el flujo de código de autorización, así que el `client_secret` no vive en ningún sitio de la app.** Necesita `VITE_GOOGLE_CLIENT_ID` (frontend) y `GOOGLE_CLIENT_ID` (backend, el mismo valor); sin la del backend el endpoint responde **503** a propósito (falla en cerrado: sin `aud` que comparar, un ID token de cualquier otra app de Google abriría cuentas aquí). Sin la del frontend, el botón simplemente no se pinta. En Google Cloud Console hay que listar el origen del frontend en "Orígenes autorizados de JavaScript".
- **El backend ya lee `.env`** (`settings.py::_load_dotenv`, llamado desde `backend/app/__init__.py`): antes solo Vite leía el archivo, así que en local `GEMINI_API_KEY`/`GROQ_API_KEY`/`GOOGLE_CLIENT_ID` quedaban vacías aunque estuvieran escritas. Se carga en `__init__` porque hay constantes que se leen del entorno **al importar** (el modelo de Gemini). Las variables ya presentes en el entorno **ganan**, así que en Render no cambia nada. Parser propio de 6 líneas, sin `python-dotenv`.
- **Alumnos por profesor** (`users.created_by`): `GET /students` filtra por dueño y `require_student_manager` bloquea editar/borrar/cambiar contraseña de alumnos ajenos (403). Las aulas ya estaban aisladas por `created_by`. **Aislamiento total: no hay excepción para `created_by IS NULL`.** Un alumno sin dueño no lo ve ni lo administra ningún profesor — solo el admin (falla en cerrado).
  Existió esa excepción (los alumnos anteriores a la columna eran visibles para todos, para no esconderle a nadie los suyos al desplegar), pero con el registro abierto por Google se volvía un agujero: cualquier desconocido que se registrara los veía y podía borrarlos. **Se cerró moviendo el backfill a la propia migración de arranque** (`ALTER TABLE ... created_by` en `db/schema.postgres.sql` y su gemelo en `_initialize_sqlite_database`): el `UPDATE` que asigna los alumnos heredados al **profesor más antiguo** corre en el mismo arranque que crea la columna, así que no hay ventana entre desplegar y acordarse de correr un script. Sin ningún profesor en la base no cambia nada y se quedan en `NULL`.
  `scripts/backfill_student_owner.py` sigue existiendo como red de seguridad para reasignar a mano (dry-run por defecto; `--owner @usuario --apply` para escribir). Cubierto por `backend/tests/test_student_isolation.py`.
- **Portal enrutado** (`/teacher/:section?`, `/admin/:section?`, `/student/:section?`): la pestaña activa **es** el parámetro de la ruta (`adminMenu`/`studentTab` se derivan de `useParams`, no de `useState`). Se comparte por URL, se marca y el botón "atrás" del navegador funciona.
- **Menú lateral por grupos** (`TeacherDashboard.tsx`, constante `GROUPS`): Resumen · Contenido · Mis grupos · Seguimiento, en vez de diez botones seguidos.
- **Notificaciones**: la barra superior lleva `relative z-50` — el panel de la campanita es `absolute` dentro de ella y sin z-index propio las secciones de abajo (que crean contexto de apilamiento con blur/sombra) lo tapaban. El panel usa `.notif-panel` (fondo **opaco**: con el cristal se leía el menú a través). Botón **"Ver historial completo"** → modal con los últimos **7 días** (`getTeacherActivityFeed(since)`); `FeedRow` es el formato compartido entre campanita e historial.
- **Modo invitado oculto**: se quitaron las entradas de `/guest` del sitio público, el inicio y el login (el flujo vivo es el enlace directo `/w/:id`). La ruta sigue existiendo: para reactivarlo basta con volver a poner un enlace a `/guest` en el login.
- **Pestaña "Lectores" eliminada** del portal del profesor (junto con su estado y handlers). Los endpoints `/readers*` y la asignación de listas a lectores dentro de Vocabulario siguen funcionando para los lectores ya existentes.
- **Capturas de /aprende por tema**: hay dos juegos, `nombre.webp` (claro) y `nombre-dark.webp` (oscuro); `Shot` en `LearnPage.tsx` elige según el tema activo. `node scripts/shots.mjs` genera **los dos** en una pasada (fija `site-theme` en localStorage y recarga antes de capturar).
- **Schema SQLite completado**: `db/schema.sql` no tenía las tablas de vocabulario (solo estaban en el de PostgreSQL), así que `/vocabulary` reventaba con `no such table` en desarrollo local. Producción no estaba afectada.

### Rendimiento (backend / carga de BD)
- **Pool de conexiones Postgres** (`database.py`, `psycopg_pool`): `get_connection()` entrega conexiones de un pool caliente en vez de abrir una nueva por consulta (antes: ~74 call sites abrían conexión nueva → handshake TCP/TLS/auth por query = mucha carga en Aiven). `min_size=1` (1 conexión caliente), `max_size` configurable con `DB_POOL_MAX` (default 5, prudente por el límite de Aiven). Los `with get_connection() as conn:` no cambian. SQLite (dev) sin pool.
- **`teacher_dashboard` optimizado**: antes leía **toda** la tabla `worksheet_responses` y filtraba en Python + hacía **N+1** (una query de conteo por aula). Ahora las respuestas se filtran en SQL a las hojas del profesor (`list_responses(worksheet_ids=...)`) y el conteo de estudiantes por aula es una sola query (`count_students_per_classroom`).
- **`/public/readers-vocabulary` sin N+1**: antes una query por reader; ahora `list_all_readers_vocabulary()` trae todo en un JOIN y agrupa en memoria.
- Pendiente (siguiente plan): caché de lecturas públicas (vocab/hojas invitado), co-ubicar región Render↔Aiven, revisar más N+1.

### Revisión QA de actividades (julio 2026)

Auditoría de los 19 tipos: generación por IA, parser, calificación e instrucciones al alumno. Lo corregido:

- **Round-trip roto de `listeningmatching`**: el constructor visual serializaba `pairs:` (lista) y el parser solo leía `pair {}` → crear una en modo visual y guardar dejaba la actividad sin pares. `_parse_pairs` ahora acepta ambos formatos.
- **Validación del parser**: los fallos silenciosos (campos en la misma línea, `matching` desigual, `dragdrop` sin la palabra en el banco, `answer` que no está en `options`, menos `answer` que huecos, actividad vacía) ahora son un error al guardar con el número de actividad y el motivo.
- **`listening` y `conversation` no se podían rescatar**: se califican por comparación exacta de **texto libre** y no estaban en la lista de tipos que la IA puede corregir, así que una respuesta correcta con otras palabras quedaba mal para siempre. Añadidos a `_AI_RESCUABLE`.
- **A la IA le faltaba el contexto del audio** al calificar `listening`/`conversation`: solo veía la pregunta y la clave. Ahora recibe la oración escuchada.
- **`GENERATION_PROMPT` (el prompt copiable) estaba desactualizado y se contradecía**: documentaba 11 de 19 tipos, incluía un ejemplo de `speaking` y tres líneas después decía `NO uses el tipo "speaking" (no existe)`, y enseñaba `listening {}` / `imagequestion {}` **en una sola línea**, que es justo la sintaxis que corrompe la actividad. Reescrito completo.
- **`WORKSHEET_DSL.md`** documentaba 13 tipos y declaraba `speaking` prohibido. Añadidos los 6 que faltaban (`multiselect`, `dragdrop`, `speaking`, `listeningorder`, `conversation`, `content`) con sus límites.

Segunda tanda (autorizada tras revisar el plan):

- **`esc()` de `dslSerializer.ts` escapaba el backslash antes que la comilla**, y el parser solo quita las comillas **exteriores**. Eran dos bugs en una línea: los saltos de línea salían con un backslash suelto a la vista del alumno (`reading`/`readingtruefalse`/`content`/descripción) y las comillas internas como `Say \"hello\"`. Ahora `esc` solo convierte `"` en `”` tipográfica — el DSL no tiene otros escapes que proteger. Comprobado con `npx tsx scripts/check-dsl-serializer.ts`.
- **Enunciado True/False sin `|` se guardaba como `true`**: la clave quedaba mal en silencio y marcaba incorrectos a alumnos que respondieron bien. `_get_statements` ahora deja `answer: None` (en los dos formatos, lista y `statement {}`) y `_activity_problem` lo rechaza al guardar nombrando el enunciado.
- **El ancho del input de `fillblank` delataba la longitud de la respuesta**: se calculaba por hueco con SU respuesta esperada. Ahora `blankWidth()` usa un único ancho por actividad (el de la respuesta más larga), así que ningún hueco se distingue de otro.
- **`partial` eliminado del prompt de calificación**: el modelo lo devolvía y `ai_grade_activities` lo guardaba como `incorrect`. Ahora el prompt pide solo `correct`/`incorrect` y el matiz va en el comentario. Implementar nota parcial de verdad es otra tarea (toca `AnswerDetail.status`, `_score_details`, badges de revisión e impresión).
- **Instrucciones de mecánica en español**: `"Escribe la palabra que falta"`, `"Escribe tu respuesta"`, `"Elige…"`. El inglés se reserva para el contenido que se evalúa.
- **Quitado el reproductor de `reading` y `readingtruefalse`**: leer el texto en voz alta convertía una evaluación de comprensión **lectora** en una de comprensión auditiva. Para practicar escucha están los tipos `listening*`.

Pendiente mayor, con plan escrito: **[docs/PLAN-fuga-de-respuestas.md](docs/PLAN-fuga-de-respuestas.md)** — los endpoints que entregan la hoja al alumno devuelven `json_content` **completo**, así que la clave de respuestas entera viaja al navegador de todos los alumnos. La fuga por la URL del TTS es un caso particular de lo mismo.

### Pendientes (menores)
- Bug 3: `\n` puede faltar en algún campo específico no cubierto por `RichText`
- Faltante 4: Estudiante no puede ver a qué aula pertenece en su portal
- Faltante 5: Perfil del estudiante — historial de notas y cambio de contraseña propio
