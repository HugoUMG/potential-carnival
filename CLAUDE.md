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

| Tipo | Descripción | Estado |
|------|------------|--------|
| `fillblank` | Completar espacios inline con `_____`. Answer puede ser string o array. | OK |
| `multiplechoice` | Selección múltiple con una respuesta correcta. | OK |
| `matching` | Emparejar columna izquierda con derecha via dropdowns. | OK |
| `textbox` | Respuesta abierta de texto largo. | OK |
| `reading` | Texto de lectura con preguntas y botón TTS. | OK |
| `listening` | Reproductor TTS que lee oración oculta al estudiante. | OK |
| `imagequestion` | Imagen con pregunta abierta. | OK |
| `speaking` | **NO IMPLEMENTADO — no usar.** | NO USAR |
| `listeningfillblank` | Audio TTS + fill in the blank inline. `audio_text` nunca visible al estudiante. | OK |
| `listeningmultiplechoice` | Audio TTS + selección múltiple. | OK |
| `listeningmatching` | N audios independientes + dropdown por cada uno. `pairs[].audio_text` oculto. | OK |
| `listeningtruefalse` | Un audio + botones True/False por enunciado. `statements[].answer` es boolean. | OK |

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
- `_____` (5 guiones bajos) es el marcador de espacio en `fillblank`.
- `\n` literal en strings se convierte a salto de línea real en el frontend.
- `speaking` no existe — no usar.

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
│   │   ├── parser.py      — Parser del DSL → WorksheetData
│   │   └── security.py    — JWT y hashing PBKDF2-SHA256
│   └── requirements.txt
├── src/
│   ├── components/
│   │   ├── WorksheetRenderer.tsx  — Renderiza hojas al estudiante
│   │   ├── activityRegistry.tsx   — Componentes de cada tipo de actividad
│   │   ├── WorksheetEditor.tsx    — Editor de hojas para el profesor
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
```

**Importante:** `GET /students/{id}/worksheets` NO tiene fallback a todas las hojas publicadas. Si el estudiante no tiene aula asignada, no ve ninguna hoja.

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
| `DATABASE_URL` | Internal Database URL de Render (PostgreSQL) |
| `JWT_SECRET_KEY` | Clave secreta JWT |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | 480 |
| `FRONTEND_ORIGINS` | `https://constructor-hojas-web.onrender.com` |
| `SEED_DEMO_USERS` | `false` en producción |

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
- La actividad `speaking` no existe y no debe implementarse.
- El parser DSL está en `backend/app/parser.py`. Al modificarlo, mantener retrocompatibilidad (hojas sin `block {}` deben seguir funcionando).

---

## 9. Estado del Sistema

### Funciona correctamente
- Login JWT con roles
- CRUD profesores, estudiantes, hojas de trabajo
- Creación de hojas con IA vía script DSL
- Publicar / despublicar / archivar hojas
- Todas las actividades: fillblank inline (múltiples blanks), multiplechoice, matching, textbox, reading, listening, imagequestion
- Instrucciones por actividad
- RichText con `\n`
- Sistema de aulas: crear, asignar estudiantes y hojas
- Filtro correcto: estudiantes solo ven hojas de su aula
- `max_attempts`
- Prevención de doble envío (bloqueo 5 seg + HTTP 409 + índice único BD)
- Eliminación de respuestas por profesor/admin
- Dashboard con gráficas
- Vista previa de hoja (solo lectura)
- Edición de estudiantes y cambio de contraseña
- TTS `en-US-GuyNeural`
- Asignación de hojas a aulas con modal de checkboxes
- **Parser procesa `theme {}` → guarda en columna `theme` como JSONB** ✓ (corregido)
- **Parser procesa `block {}` → guarda bloques en `json_content.blocks`** ✓ (corregido)
- **4 tipos híbridos de listening** (listeningfillblank, listeningmultiplechoice, listeningmatching, listeningtruefalse) — calificación automática, `audio_text` nunca visible al estudiante ✓
- **Panel profesor: fillblank y listeningfillblank siempre muestran controles de revisión** (correcto/incorrecto + comentario) ✓

### Pendientes (menores)
- Bug 3: `\n` puede faltar en algún campo específico no cubierto por `RichText`
- Faltante 4: Estudiante no puede ver a qué aula pertenece en su portal
- Faltante 5: Perfil del estudiante — historial de notas y cambio de contraseña propio
- Faltante 6: Pestañas "Activas" y "Calificadas" en portal del estudiante
