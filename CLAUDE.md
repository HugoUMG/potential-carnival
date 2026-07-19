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

1. Admin crea profesores → profesor recibe credenciales
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
users (id, name, email, username, password_hash, role, created_at)

-- Hojas de trabajo
worksheets (id, title, description, script_content, json_content JSONB,
            created_by → users, created_at, published, archived,
            max_attempts, theme JSONB)

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
| `reading` | Texto de lectura (`content`, `\n`) + `questions` (abiertas) + botón TTS. Puede ir sin preguntas como referencia. | Preguntas: pendiente → IA/profesor | OK |
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

- `block {}` agrupa actividades con título e instrucciones de sección. Retrocompatible: hojas sin `block` siguen funcionando con `activities` plano.
- **`block {}` es excluyente (trampa clásica):** si la hoja tiene **al menos un** `block {}`, el parser toma **solo** las actividades que estén dentro de blocks e **ignora en silencio** las que queden fuera. Con blocks, TODA actividad va dentro de algún block.
- **Enunciados True/False (`truefalse`, `readingtruefalse`, `listeningtruefalse`):** una línea por enunciado con **pipe**: `- Texto del enunciado. | true`. **NO** usar `- text: "…"` + `answer:` en líneas aparte (el parser corta en la primera línea que no empieza con `-` → queda UN solo enunciado con el texto literal `text: "…"` y `answer` en `true`). Formato alterno válido: bloques `statement { text: "…" answer: true }`.
- **`listeningmatching` usa bloques `pair {}`**, no una lista `pairs:`. Cada par: `pair { audio_text: "…" match: "…" }` — el campo es **`match`**, no `answer`. Las `options:` sí son lista.
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
- La calificación IA (`ai_grade_activities`) corre **en el POST de respuestas** cuando la hoja tiene `ai_grading` activo.

---

## 6. Integración con IA (`backend/app/ai.py`)

### Proveedores soportados

| Proveedor | Modelo | Prioridad |
|-----------|--------|-----------|
| Google Gemini | `gemini-3.1-flash-lite` | Primero (si `GEMINI_API_KEY` existe) |
| Groq | `llama-3.3-70b-versatile` | Fallback (si `GROQ_API_KEY` existe) |

### Funciones

- **`generate_worksheet_script(prompt)`** — Convierte un prompt en lenguaje natural a un script DSL válido. Usa el system prompt `_WORKSHEET_SYSTEM` que instruye al modelo sobre todos los tipos de actividades disponibles.
- **`ai_grade_activities(details, worksheet_title)`** — Califica respuestas pendientes (textbox, imagequestion) y verifica equivalencias semánticas en fillblank. Solo puede cambiar status de actividades `pending` o `incorrect`. Los comentarios del profesor se agregan en español.

### Lógica de calificación IA

1. Respuestas auto-calificadas como correctas → IA confirma (no toca)
2. Fillblank marcado incorrecto → IA verifica equivalencia semántica
3. Textbox/imagequestion marcados pending → IA califica completamente
4. La IA solo puede modificar status `pending` e `incorrect`; nunca puede marcar como incorrect algo que el auto-grader marcó correct

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
3. **IA Mode** — Prompt en lenguaje natural → genera DSL via API. El `AiPanel` (en `WorksheetEditor.tsx`) es un **constructor de prompt**: **presets** de un clic (Warm-up, Weekly Quiz, Monthly Test…) + **chips** (nivel, tema, objetivo, enfoque, edad, duración, dificultad, actividades) que **componen el prompt en vivo** (`composePrompt`) en el textarea, editable a mano. Solo frontend: alimenta el mismo `generateWorksheetWithAI` → `/worksheets/ai-generate`. Los chips de "Actividades" son sugerencia a la IA, no garantía dura.

### `main.tsx` — Rutas

| Ruta | Componente | Roles |
|------|-----------|-------|
| `/login` | LoginPage | público |
| `/` | RootRedirect | redirige según rol |
| `/student` | App (modo student) | student |
| `/teacher` | App (modo teacher) | teacher, admin |
| `/admin` | App (modo admin) | admin |
| `/reader` | ReaderPortal | reader |
| `/guest` | GuestPage | público (token) |
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
| `GEMINI_API_KEY` | Alternativa/soporte IA (según config). |

### Frontend (Render)
| Variable | Valor |
|----------|-------|
| `VITE_API_URL` | `https://constructor-hojas-api.onrender.com` |

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

### Rendimiento (backend / carga de BD)
- **Pool de conexiones Postgres** (`database.py`, `psycopg_pool`): `get_connection()` entrega conexiones de un pool caliente en vez de abrir una nueva por consulta (antes: ~74 call sites abrían conexión nueva → handshake TCP/TLS/auth por query = mucha carga en Aiven). `min_size=1` (1 conexión caliente), `max_size` configurable con `DB_POOL_MAX` (default 5, prudente por el límite de Aiven). Los `with get_connection() as conn:` no cambian. SQLite (dev) sin pool.
- **`teacher_dashboard` optimizado**: antes leía **toda** la tabla `worksheet_responses` y filtraba en Python + hacía **N+1** (una query de conteo por aula). Ahora las respuestas se filtran en SQL a las hojas del profesor (`list_responses(worksheet_ids=...)`) y el conteo de estudiantes por aula es una sola query (`count_students_per_classroom`).
- **`/public/readers-vocabulary` sin N+1**: antes una query por reader; ahora `list_all_readers_vocabulary()` trae todo en un JOIN y agrupa en memoria.
- Pendiente (siguiente plan): caché de lecturas públicas (vocab/hojas invitado), co-ubicar región Render↔Aiven, revisar más N+1.

### Pendientes (menores)
- Bug 3: `\n` puede faltar en algún campo específico no cubierto por `RichText`
- Faltante 4: Estudiante no puede ver a qué aula pertenece en su portal
- Faltante 5: Perfil del estudiante — historial de notas y cambio de contraseña propio
