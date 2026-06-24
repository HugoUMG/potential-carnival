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
| IA | Google Gemini (`gemini-1.5-flash`) / Groq (`llama-3.3-70b-versatile`) |
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

| Tipo | Descripción | Estado |
|------|------------|--------|
| `fillblank` | Completar espacios inline con `_____`. `answer` puede ser string o array. | OK |
| `multiplechoice` | Selección múltiple con una respuesta correcta. | OK |
| `matching` | Emparejar columna izquierda con derecha via dropdowns. | OK |
| `textbox` | Respuesta abierta de texto largo. Calificado por IA o manualmente. | OK |
| `reading` | Texto de lectura con preguntas y botón TTS. | OK |
| `listening` | Reproductor TTS que lee oración oculta al estudiante. | OK |
| `imagequestion` | Imagen con pregunta abierta. Calificado por IA o manualmente. | OK |
| `truefalse` | Enunciados de texto con botones True/False por ítem. | OK |
| `readingtruefalse` | Pasaje de lectura seguido de enunciados True/False. | OK |
| `listeningfillblank` | Audio TTS + fill in the blank inline. `audio_text` nunca visible al estudiante. | OK |
| `listeningmultiplechoice` | Audio TTS + selección múltiple. | OK |
| `listeningmatching` | N audios independientes + dropdown por cada uno. `pairs[].audio_text` oculto. | OK |
| `listeningtruefalse` | Un audio + botones True/False por enunciado. `statements[].answer` es boolean. | OK |
| `speaking` | **Legado — no crear nuevas.** El parser lo acepta (igual que `textbox`) y el frontend lo renderiza como `textbox`. Existe solo para no romper datos antiguos en producción. | SOLO LECTURA |

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

  truefalse {
    statements:
    - text: "The sun rises in the east."
      answer: true
    - text: "Water freezes at 50°C."
      answer: false
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
    - text: "Water evaporates from oceans."
      answer: true
    - text: "Rain is created by wind alone."
      answer: false
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
    pairs:
    - audio_text: "I can swim."
      answer: "Ability"
    - audio_text: "You should rest."
      answer: "Advice"
    options:
    - Ability
    - Advice
    - Permission
  }

  listeningtruefalse {
    audio_text: "Dogs are mammals and birds can fly."
    statements:
    - text: "Dogs are mammals."
      answer: true
    - text: "Birds cannot fly."
      answer: false
  }

  textbox {
    prompt: "Write your answer here."
  }

  imagequestion {
    image_url: "https://..."
    question: "What do you see in the image?"
  }

  info {
    fields:
    - label: "Name"
    - label: "Date"
    - label: "Class"
  }
}
```

### Reglas del DSL

- `block {}` agrupa actividades con título e instrucciones de sección. Retrocompatible: hojas sin `block` siguen funcionando con `activities` plano.
- `theme {}` define colores personalizados por hoja. Se guarda en la columna `theme` como JSONB.
- `info {}` define campos de identificación no calificados (nombre, fecha, clase). No se suman al puntaje.
- `_____` (5 guiones bajos exactos) es el marcador de espacio en `fillblank`.
- `\n` literal en strings se convierte a salto de línea real en el frontend.
- `speaking` es legado — el parser lo acepta pero lo trata como `textbox`. No crear actividades nuevas de este tipo; el builder visual y la IA lo excluyen explícitamente.
- `answer` en `fillblank` puede ser un string o un array JSON `["opcion1", "opcion2"]` para múltiples blanks.

---

## 4. Estructura del Proyecto

```
potential-carnival/
├── backend/
│   ├── app/
│   │   ├── main.py          — Endpoints FastAPI, dependencias de auth
│   │   ├── repository.py    — Queries a la BD (patrón Repository, ~1100 líneas)
│   │   ├── database.py      — Conexión, inicialización y migración de BD
│   │   ├── models.py        — Modelos Pydantic (request/response)
│   │   ├── domain.py        — Dataclasses internos (ActivityData, BlockData, WorksheetData)
│   │   ├── parser.py        — Parser del DSL → WorksheetData
│   │   ├── security.py      — JWT y hashing PBKDF2-SHA256
│   │   ├── ai.py            — Integración IA (generación de hojas + calificación)
│   │   └── settings.py      — Helpers de configuración (variables de entorno)
│   ├── tests/
│   │   ├── test_parser.py   — Tests del parser DSL
│   │   └── test_security.py — Tests de auth y passwords
│   └── requirements.txt
├── src/
│   ├── components/
│   │   ├── WorksheetRenderer.tsx      — Renderiza hojas al estudiante (con bloques, tema)
│   │   ├── activityRegistry.tsx       — Registros y renderers de cada tipo de actividad
│   │   ├── WorksheetEditor.tsx        — Editor (Script / Visual / IA)
│   │   ├── VisualWorksheetBuilder.tsx — Builder drag-and-drop visual
│   │   ├── RichText.tsx               — Convierte \n literal a saltos de línea reales
│   │   ├── AudioPlayer.tsx            — Reproductor de audio TTS
│   │   ├── TeacherDashboard.tsx       — Dashboard de métricas del profesor
│   │   ├── VocabularyViewer.tsx       — Vista de listas de vocabulario
│   │   └── ProtectedRoute.tsx         — Guard de rutas por rol
│   ├── pages/
│   │   ├── LoginPage.tsx              — Página de login
│   │   ├── GuestPage.tsx              — Portal invitado (sin cuenta, por token)
│   │   ├── ReaderPortal.tsx           — Portal solo-vocabulario para lectores
│   │   ├── VocabPublicPage.tsx        — Vocabulario público (sin autenticación)
│   │   └── ImageLibraryPage.tsx       — Biblioteca de imágenes
│   ├── services/
│   │   └── api.ts                     — Cliente HTTP centralizado (todas las llamadas a la API)
│   ├── utils/
│   │   ├── dslSerializer.ts           — Conversión DSL ↔ JSON para el builder visual
│   │   └── voicePreference.ts         — Preferencia de voz TTS del usuario
│   ├── data/
│   │   ├── sampleWorksheet.ts         — Hoja de muestra para demo
│   │   └── image-library.json         — Catálogo de imágenes disponibles
│   ├── types.ts                       — Tipos TypeScript globales
│   ├── App.tsx                        — Componente raíz (portal teacher/student/admin)
│   └── main.tsx                       — Entry point React, rutas React Router
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

POST   /reader/log-session                   — Registrar acceso al portal de lector
GET    /teacher/reader-logs                  — Ver historial de accesos de lectores
```

### Acceso Público (Sin Autenticación)

```
GET    /public/classrooms                    — Listar solo aulas públicas
GET    /public/classrooms/{id}/worksheets    — Hojas de un aula pública
GET    /public/worksheets                    — Todas las hojas publicadas y no archivadas

POST   /public/responses                     — Enviar respuestas como invitado (con guest_token)
GET    /public/responses?guest_token=...     — Consultar respuestas de un invitado

POST   /public/guest-sessions                — Registrar acceso invitado
GET    /teacher/guest-logs                   — Ver historial de accesos de invitados

GET    /public/readers-vocabulary            — Vocabulario de todos los lectores (sin auth)
```

### TTS y Dashboard

```
GET    /tts?text=...&voice=en-US-GuyNeural   — Generar audio TTS (retorna audio/mpeg)
GET    /dashboard/teacher                    — Métricas agregadas del profesor
```

**Importante:** `GET /students/{id}/worksheets` NO tiene fallback a todas las hojas publicadas. Si el estudiante no tiene aula asignada, no ve ninguna hoja.

---

## 6. Integración con IA (`backend/app/ai.py`)

### Proveedores soportados

| Proveedor | Modelo | Prioridad |
|-----------|--------|-----------|
| Google Gemini | `gemini-1.5-flash` | Primero (si `GEMINI_API_KEY` existe) |
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
3. **IA Mode** — Prompt en lenguaje natural → genera DSL via API

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

### `services/api.ts`
Cliente HTTP centralizado. Todas las llamadas a la API deben pasar por aquí. Maneja el token JWT automáticamente (desde localStorage).

---

## 9. Variables de Entorno

### Backend (Render)
| Variable | Valor / Descripción |
|----------|-------------------|
| `DATABASE_URL` | Internal Database URL de Render (PostgreSQL) |
| `JWT_SECRET_KEY` | Clave secreta JWT (requerida en producción) |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | `480` (8 horas) |
| `FRONTEND_ORIGINS` | `https://constructor-hojas-web.onrender.com` |
| `SEED_DEMO_USERS` | `false` en producción |
| `GEMINI_API_KEY` | API key de Google Gemini (generación de hojas con IA) |
| `GROQ_API_KEY` | API key de Groq (fallback de IA) |
| `WORKSHEET_DATABASE_PATH` | Ruta del archivo SQLite (solo desarrollo; por defecto `data/worksheet_builder.db`) |

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
- La actividad `speaking` es legado: el parser la parsea como `textbox`, el frontend la renderiza como `textbox`, pero **no crear actividades nuevas de este tipo**. La IA tiene instrucción explícita de nunca generarla.
- El parser DSL está en `backend/app/parser.py`. Al modificarlo, mantener retrocompatibilidad: hojas sin `block {}` deben seguir funcionando.
- Los campos `audio_text` de actividades de listening **nunca deben enviarse al estudiante** en el JSON de respuesta.
- La calificación IA se hace en `ai.py`. Solo puede cambiar status de actividades `pending` e `incorrect`, nunca de `correct`.

### Frontend
- Usar `RichText` para cualquier texto que provenga de la BD y pueda contener `\n`.
- Los nuevos tipos de actividad deben registrarse en `activityRegistry.tsx`.
- El estado de la aplicación se maneja en `App.tsx` para teacher/student/admin; portales especiales tienen sus propias páginas en `src/pages/`.
- Nuevas llamadas a la API deben agregarse a `services/api.ts`.

### Testing y verificación
- Verificar tests después de cada cambio al backend: `python -m pytest backend/tests`
- Verificar que el frontend compile y pase lint: `npm run build && npm run lint`
- Correr ambos antes de hacer commit de cambios significativos.

---

## 11. Estado del Sistema

### Funciona correctamente

- Login JWT con 4 roles (admin, teacher, student, reader)
- CRUD completo de profesores, estudiantes, lectores y hojas de trabajo
- Creación de hojas con IA via Gemini / Groq
- Creación de hojas con builder visual (drag-and-drop)
- Publicar / despublicar / archivar / restaurar hojas
- Duplicar hojas con nueva autoría
- Todos los tipos de actividad: fillblank, multiplechoice, matching, textbox, reading, listening, imagequestion, truefalse, readingtruefalse, listeningfillblank, listeningmultiplechoice, listeningmatching, listeningtruefalse
- Campos `info {}` para identificación no calificada (nombre, fecha, clase)
- `block {}` agrupa actividades con título e instrucciones de sección
- `theme {}` aplica colores personalizados por hoja
- `max_attempts` limita intentos (null = sin límite extra, el índice único previene duplicados)
- Prevención de doble envío: bloqueo 5 seg en UI + HTTP 409 + índice único en BD
- Sistema de aulas: crear, asignar estudiantes y hojas, visibilidad pública/privada, fecha límite (`due_date`)
- Filtro correcto: estudiantes solo ven hojas de su aula
- Eliminación de respuestas por profesor/admin
- Calificación automática de actividades cerradas (multiplechoice, matching, truefalse, fillblank)
- Calificación IA de textbox, imagequestion y verificación semántica de fillblank
- Revisión manual del profesor (comentarios por actividad)
- Dashboard del profesor con métricas agregadas y gráficas
- Notificaciones recientes (respuestas de últimas 48 horas)
- Estado de actividad de estudiantes (online/offline por sesión)
- Vista previa de hoja (solo lectura)
- Edición de usuarios y cambio de contraseña
- TTS `en-US-GuyNeural` con preferencia de voz configurable
- Asignación de hojas a aulas con modal de checkboxes
- Listas de vocabulario: crear, asignar a aulas y lectores individuales
- Portal de lector (solo vocabulario, sin acceso a hojas)
- Portal de vocabulario público (sin autenticación)
- Modo invitado: acceso a aulas públicas con `guest_token`, respuestas guardadas con token
- Registro de accesos: logs de invitados y lectores visibles para el profesor
- Historial de sesiones por usuario (`user_sessions`)
- `audio_text` en actividades de listening nunca visible al estudiante

### Pendientes conocidos

- Bug: `\n` puede faltar en algún campo específico no cubierto por `RichText`
- Faltante: Estudiante no puede ver a qué aula pertenece en su portal
- Faltante: Perfil del estudiante — historial de notas y cambio de contraseña propio
- Faltante: Pestañas "Activas" y "Calificadas" en portal del estudiante
