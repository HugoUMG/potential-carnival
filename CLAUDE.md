# Constructor de Hojas de Trabajo — Documentación Técnica

Repositorio: `potential-carnival` | Deploy: Render.com

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| Backend | Python + FastAPI |
| Base de datos | PostgreSQL (producción) / SQLite (desarrollo local) |
| Autenticación | JWT con roles (`admin`, `teacher`, `student`) |
| TTS | `edge-tts` — voz `en-US-GuyNeural` |
| Deploy | Render.com — Static Site (frontend) + Web Service (backend) |

---

## 1. Descripción General

Plataforma web educativa: profesores crean hojas de trabajo interactivas (con IA o manualmente), las asignan a aulas, y revisan respuestas. Estudiantes completan las hojas asignadas a su aula.

### Roles

| Rol | Permisos |
|-----|---------|
| `admin` | Gestiona profesores, estudiantes y todo el contenido |
| `teacher` | Crea aulas, hojas, asigna hojas a aulas, revisa respuestas |
| `student` | Completa hojas de su aula, ve resultados y notas |

### Flujo principal

1. Admin crea profesores → profesor recibe credenciales
2. Profesor crea aula → le asigna estudiantes
3. Profesor crea hoja (con IA o manualmente) → publica → asigna a aula(s)
4. Estudiante entra a portal → ve solo hojas de su aula → completa → envía
5. Profesor revisa respuestas → puede eliminar duplicadas
6. Dashboard del profesor → métricas con gráficas

---

## 2. Base de Datos

PostgreSQL en producción (Render.com). SQLite para desarrollo local. El backend selecciona automáticamente según `DATABASE_URL`.

### Tablas

```sql
users (id, name, email, username, password_hash, role, created_at)
worksheets (id, title, description, script_content, json_content, created_by, created_at, published, archived, max_attempts, theme)
worksheet_responses (id, worksheet_id, student_id, student_name, answers_json, details_json, score, correct_count, pending_count, submitted_at)
classrooms (id, name, created_by, created_at)
classroom_students (classroom_id, student_id, assigned_at)  -- PK compuesta
classroom_worksheets (classroom_id, worksheet_id, assigned_at)  -- PK compuesta
```

Índice único para prevenir respuestas duplicadas:
```sql
CREATE UNIQUE INDEX idx_responses_unique_attempt
ON worksheet_responses (worksheet_id, student_id)
WHERE student_id IS NOT NULL;
```

### Regla crítica de migraciones

**La BD ya está en producción con datos reales. NUNCA usar `DROP TABLE` o `DROP COLUMN`.**

```sql
-- CORRECTO
CREATE TABLE IF NOT EXISTS nueva_tabla (...);
ALTER TABLE worksheets ADD COLUMN IF NOT EXISTS nueva_col JSONB;

-- PROHIBIDO
DROP TABLE worksheets;
DROP TABLE users;
```

---

## 3. Tipos de Actividades (DSL)

Las hojas se crean con un DSL propio. El backend lo parsea (`backend/app/parser.py`) y guarda el resultado en `json_content`.

Lista canónica de tipos soportados: `SUPPORTED_BLOCKS` en `backend/app/parser.py`. Son **16** (abajo). Cualquier tipo fuera de esa lista es ignorado por el parser.

| Tipo | Descripción | Calificación | Estado |
|------|------------|-------------|--------|
| `fillblank` | Completar espacios inline con `_____` (5 guiones). `answer` string o array (uno por blank). | Auto (exacta); el profesor puede corregir a mano por typos | OK |
| `multiplechoice` | Selección con **una** respuesta correcta. `options` (lista) + `answer`. | Auto | OK |
| `multiselect` | Varias respuestas correctas. `answer` es **lista** de todas las correctas. | Auto | OK |
| `dragdrop` | Arrastrar palabras del banco a huecos `_____`. `answer` (lista por hueco) + `bank` (correctas + distractores). | Auto | OK |
| `matching` | Emparejar columna izquierda↔derecha via dropdowns. Correcto = mismo índice. | Auto | OK |
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

> **Nota:** la nota anterior de "`speaking` NO IMPLEMENTADO" quedó obsoleta — `speaking` **sí** está implementado (ambos modos). Los listenings usan **TTS**, no archivos de audio: nunca usar un campo `audio:`.

### Formato del Script DSL

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
  matching {
    left:
    - can
    - should
    right:
    - Ability
    - Advice
  }
  reading {
    title: "School Rules"
    content: "Text here.\nMore text."
    questions:
    - Question 1?
    - Question 2?
  }
  listening {
    text: "Oración oculta al estudiante."
    question: "What did you hear?"
    answer: "key answer"
  }
  textbox {
    prompt: "Write your answer here."
  }
}
```

**Reglas del DSL:**
- `block {}` agrupa actividades con título e instrucciones de sección. Retrocompatible: hojas sin `block` siguen funcionando con `activities` plano.
- `theme {}` define colores personalizados por hoja. Se guarda en la columna `theme` como JSONB.
- Cada actividad admite un campo opcional `instructions:` (guía por actividad).
- `_____` (5 guiones bajos) es el marcador de espacio en `fillblank` / `dragdrop`.
- `\n` literal en strings se convierte a salto de línea real en el frontend.
- **Comillas dentro de un string:** usar tipográficas `“ ”`. Las `\"` quedan literales (el parser solo quita las comillas exteriores) y se verían con backslash.
- `speaking` **sí** existe (ver tabla). La nota histórica de "no usar" está obsoleta.
- **Al generar hojas para el usuario:** entregar solo el DSL en el chat (ver memoria `worksheet-delivery`). Validar con `parse_worksheet_script` de `backend/app/parser.py` de forma transitoria si hace falta.

**Campos de identificación (`_info_*`)**: una hoja puede pedir datos al alumno (nombre, sección, etc.); se guardan en `answers_json._info_0`, `_info_1`… y el profesor los ve en la revisión.

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
│   │   └── RichText.tsx           — Renderiza texto con saltos de línea
│   └── ...
├── db/
│   └── schema.postgres.sql  — Schema completo de la BD
├── scripts/
│   └── init_db.py           — Inicializa y migra la BD
└── render.yaml              — Configuración de deploy en Render
```

---

## 5. Endpoints Principales

```
POST   /auth/login                           — Login (username, password, role)

POST   /students                             — Crear estudiante (teacher/admin)
GET    /students                             — Listar estudiantes
PUT    /users/{id}                           — Editar usuario
PUT    /users/{id}/password                  — Cambiar contraseña
DELETE /students/{id}                        — Eliminar estudiante

POST   /classrooms                           — Crear aula
GET    /classrooms                           — Listar aulas del profesor
GET    /classrooms/{id}                      — Detalle de aula
POST   /classrooms/{id}/students            — Asignar estudiante
DELETE /classrooms/{id}/students/{sid}      — Desasignar estudiante
POST   /classrooms/{id}/worksheets          — Asignar hoja a aula
DELETE /classrooms/{id}/worksheets/{wid}    — Desasignar hoja
GET    /worksheets/{id}/classrooms          — Aulas de una hoja

POST   /worksheets                           — Crear hoja
GET    /worksheets                           — Listar hojas (teacher/admin)
GET    /worksheets/{id}                      — Detalle de hoja
POST   /worksheets/{id}/publish             — Publicar
POST   /worksheets/{id}/unpublish           — Despublicar
POST   /worksheets/{id}/archive             — Archivar
DELETE /worksheets/{id}                      — Eliminar

GET    /students/{id}/worksheets            — Hojas del estudiante (filtradas por aula)
POST   /worksheets/{id}/responses           — Enviar respuestas
GET    /worksheets/{id}/responses           — Ver respuestas (teacher/admin)
DELETE /responses/{id}                       — Eliminar respuesta (teacher/admin)

GET    /dashboard/teacher                    — Métricas del profesor
GET    /tts?text=...&voice=en-US-GuyNeural  — Generar audio TTS
# Público / invitado (sin JWT)
GET    /public/classrooms                    — Aulas públicas (selector de invitado)
GET    /public/classrooms/{id}/worksheets    — Hojas del aula (invitado)
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

## 6. Componentes Frontend Clave

### `RichText.tsx`
Convierte `\n` literal (como está almacenado en la BD) a salto de línea real.
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

### `WorksheetRenderer.tsx` — Bloques
Soporta formato con bloques Y formato anterior sin bloques:
```tsx
const blocks = worksheet.blocks?.length
  ? worksheet.blocks
  : [{ title: null, instructions: null, activities: worksheet.activities }];
```

---

## 7. Variables de Entorno

### Backend (Render)
| Variable | Valor |
|----------|-------|
| `DATABASE_URL` | PostgreSQL. **La BD se migró de Render a Aiven** — Aiven añade unos segundos de latencia en la primera consulta (por eso los spinners de carga). |
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

## 8. Reglas para Claude Code

- **Nunca** usar `DROP TABLE` o `DROP COLUMN`.
- Siempre usar `CREATE TABLE IF NOT EXISTS` y `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- Verificar tests después de cada cambio: `python -m pytest backend/tests`
- Verificar que el frontend compile: `npm run build && npm run lint`
- Todos los endpoints nuevos deben respetar la autenticación JWT existente.
- Contraseñas siempre hasheadas con PBKDF2-SHA256.
- TTS usa `edge-tts` con voz `en-US-GuyNeural` y retorna `audio/mpeg`.
- `speaking` **sí** está implementado (ver §3). No borrarlo ni tratarlo como inexistente.
- El parser DSL está en `backend/app/parser.py`. Al modificarlo, mantener retrocompatibilidad (hojas sin `block {}` deben seguir funcionando).
- La BD está en **Aiven** (no Render). Toda pantalla que dependa de la primera consulta debe mostrar spinner (`LoadingScreen`/`Spinner`).
- Al pedir el usuario una hoja de trabajo: entregar solo el DSL en el chat, sin crear archivo aparte (memoria `worksheet-delivery`).

---

## 9. Estado del Sistema

### Funciona correctamente
- Login JWT con roles (student, teacher, admin, reader)
- CRUD profesores, estudiantes, hojas de trabajo
- Creación de hojas con IA vía script DSL / editor
- Publicar / despublicar / archivar hojas
- **Los 16 tipos de actividad** de §3 (incluye multiselect, dragdrop, truefalse, readingtruefalse y speaking)
- Instrucciones por actividad + campos de identificación `_info_*`
- RichText con `\n`, theme por hoja, bloques
- Sistema de aulas: crear, asignar estudiantes y hojas; estudiantes solo ven hojas de su aula
- `max_attempts`; prevención de doble envío (bloqueo 5 s + HTTP 409 + índice único BD)
- Dashboard con gráficas; vista previa de hoja
- TTS `en-US-GuyNeural`

### Funciones recientes (rama `feat/student-ux`)
- **Acceso de invitado** (`/guest`): el alumno entra con nombre + aula pública, sin cuenta. Es el flujo priorizado (ver memoria `usage-direction`). También portal `reader` y `/vocab` públicos.
- **Calificación por IA** (`ai.py`, Groq): toggle `ai_grading` por hoja. Las respuestas abiertas quedan `pending`; si el toggle está activo, la IA califica gramática/contenido con comentario en español (badge "✦ IA"). Además: generación de hojas por IA y resumen de desempeño.
- **Speaking** con micrófono: transcripción vía Groq Whisper (fallback de texto).
- **Animaciones de resultado de envío** (`submitAnimations.tsx`): al enviar se elige una **al azar** (cohete / pastelero / paracaidista). Umbral de éxito **≥ 70** (`PASS_THRESHOLD`). Efectos de sonido con **ZzFX** (sintetizado, sin archivos). Para añadir más: registrar en `SUBMIT_ANIMATIONS`.
- **Spinners de carga** (`LoadingScreen`/`Spinner`) en portales, login, hojas y respuestas — por la latencia de Aiven.
- **Revisión de respuestas (profesor):** al entrar **ninguna** respuesta viene seleccionada; se elige un alumno para ver su detalle. `fillblank`/`listeningfillblank` muestran siempre controles de corrección manual.
- Portal del estudiante con pestañas "Activas" / "Calificadas"; drag&drop con click-to-place.

### Pendientes (menores)
- Bug 3: `\n` puede faltar en algún campo específico no cubierto por `RichText`
- Faltante 4: Estudiante no puede ver a qué aula pertenece en su portal
- Faltante 5: Perfil del estudiante — historial de notas y cambio de contraseña propio
