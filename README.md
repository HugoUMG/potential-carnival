# Constructor de hojas con IA

Aplicación full-stack para que un **profesor** cree evaluaciones con `WorksheetScript`, las guarde de forma permanente en una base de datos y habilite cuáles verá cada **estudiante** desde su propio acceso.

## Qué cambió en esta versión

- Hay **dos accesos separados**: profesor y estudiante.
- El profesor puede pegar un script, guardarlo como evaluación y habilitarlo.
- El estudiante solo ve evaluaciones habilitadas y puede enviar respuestas.
- Las evaluaciones y respuestas se almacenan en **SQLite** para desarrollo local.
- El script SQL de la base de datos está en `db/schema.sql`.

## Usuarios demo

| Rol | Correo | Contraseña |
| --- | --- | --- |
| Profesor | `profesor@demo.com` | `profesor123` |
| Estudiante | `estudiante@demo.com` | `estudiante123` |

> En producción estas contraseñas deben cambiarse por hashes reales y JWT completo. Para comenzar, el login demo permite probar el flujo completo.

## Arquitectura

- **Frontend:** React, Vite, TypeScript y estilos con utilidades tipo TailwindCSS.
- **Backend:** FastAPI con modelos Pydantic y parser de WorksheetScript.
- **Base de datos local:** SQLite en `data/worksheet_builder.db`.
- **Script de base de datos:** `db/schema.sql`.
- **Inicializador:** `scripts/init_db.py`.

## Flujo principal

```text
Profesor inicia sesión → pega WorksheetScript → backend valida → SQLite guarda evaluación → profesor habilita → estudiante inicia sesión → estudiante responde → SQLite guarda registros
```

## Cómo crear hojas de trabajo / evaluaciones

### Opción 1: desde el panel del profesor

1. Entra como profesor con `profesor@demo.com` y `profesor123`.
2. Abre el menú **Crear evaluación**.
3. Pega o escribe un `WorksheetScript`.
4. Haz clic en **Guardar evaluación**.
5. Ve a **Evaluaciones guardadas**.
6. Haz clic en **Habilitar** para que aparezca en el portal del estudiante.

Ejemplo mínimo de `WorksheetScript`:

```text
worksheet {
title: "Práctica A1 de presente continuo"
description: "Hoja para practicar acciones en progreso."

fillblank {
  text: "She ____ reading now."
  answer: "is"
}

multiplechoice {
  question: "Elige la oración correcta."
  options:
  - She is reading.
  - She are reading.
  - She reading.
  answer: "She is reading."
}

textbox {
  prompt: "Escribe tres oraciones usando presente continuo."
}
}
```

### Opción 2: desde la API

Con el backend activo, crea una evaluación con:

```bash
curl -X POST http://localhost:8000/worksheets \
  -H "Content-Type: application/json" \
  -d '{
    "created_by": "teacher-demo",
    "script_content": "worksheet {\ntitle: \"Práctica A1\"\ndescription: \"Evaluación rápida\"\n\nfillblank {\n  text: \"She ____ reading.\"\n  answer: \"is\"\n}\n}"
  }'
```

Luego habilítala con:

```bash
curl -X POST http://localhost:8000/worksheets/ID_DE_LA_EVALUACION/publish
```

## Cómo se almacenan las evaluaciones

La base de datos tiene tres tablas principales:

- `users`: usuarios profesor/estudiante.
- `worksheets`: evaluaciones creadas por el profesor.
- `worksheet_responses`: respuestas enviadas por estudiantes.

Cada evaluación se guarda con:

- `script_content`: el texto original de WorksheetScript.
- `json_content`: el resultado parseado y validado en JSON.
- `published`: `0` si es borrador, `1` si está habilitada para estudiantes.
- `created_by`: ID del profesor que la creó.

El esquema completo está en `db/schema.sql`.

## Ruta para ejecutar el proyecto en tu PC con Visual Studio Code

### 1. Instala herramientas necesarias

1. Instala **Node.js LTS** desde <https://nodejs.org/>.
2. Instala **Python 3.12** o una versión compatible desde <https://www.python.org/>.
3. Instala **Visual Studio Code** desde <https://code.visualstudio.com/>.
4. Instala extensiones recomendadas: ESLint, Python, Pylance y Tailwind CSS IntelliSense.

### 2. Abre la carpeta correcta

1. Descarga o clona el repositorio.
2. Abre Visual Studio Code.
3. Selecciona **Archivo → Abrir carpeta**.
4. Elige la carpeta raíz del proyecto: `potential-carnival`.

### 3. Crea la base de datos

En una terminal integrada ejecuta:

```bash
python scripts/init_db.py
```

Esto crea `data/worksheet_builder.db` y carga los usuarios demo.

### 4. Ejecuta el backend

```bash
python -m venv .venv
```

Activa el entorno virtual:

```bash
# Windows PowerShell
.\.venv\Scripts\Activate.ps1

# macOS o Linux
source .venv/bin/activate
```

Instala dependencias y levanta la API:

```bash
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload
```

La API queda en:

```text
http://localhost:8000
```

La documentación automática queda en:

```text
http://localhost:8000/docs
```

### 5. Ejecuta el frontend

En una segunda terminal:

```bash
npm install
npm run dev
```

Abre:

```text
http://localhost:5173
```

## Actividades incluidas

- Completar espacios.
- Opción múltiple.
- Caja de texto.
- Relacionar columnas.
- Expresión oral con respuesta escrita temporal.
- Lectura con preguntas.
- Pregunta con imagen.

## Estructura principal del proyecto

```text
potential-carnival/
├─ db/schema.sql                 # Tablas y usuarios demo
├─ scripts/init_db.py             # Inicializador de SQLite
├─ data/                          # Base SQLite local generada
├─ src/                           # Frontend React
│  ├─ components/                  # Login, editor, dashboard y renderer
│  ├─ services/api.ts              # Cliente HTTP hacia FastAPI
│  └─ types.ts                     # Tipos TypeScript
├─ backend/
│  ├─ app/                         # API FastAPI, parser, modelos, SQLite
│  └─ tests/                       # Pruebas del parser
└─ package.json
```

## Notas importantes

- Las palabras clave de `WorksheetScript` se mantienen en inglés (`worksheet`, `fillblank`, `multiplechoice`, etc.) porque forman parte del lenguaje interno.
- El contenido visible para profesor y estudiante está en español.
- SQLite es suficiente para comenzar en local. Para producción, la misma estructura puede migrarse a PostgreSQL.
- La generación con IA sigue siendo un stub inicial; el flujo de base de datos y habilitación ya queda preparado.

## Comandos de verificación

```bash
python -m pytest backend/tests
python -m compileall backend/app backend/tests
npm run build
```

## Flujo agregado: estudiantes, intentos y revisión docente

### Crear usuarios de estudiantes

Desde el panel del profesor abre **Crear estudiante**. El estudiante se guarda con:

- `name`: nombre visible del estudiante.
- `username`: usuario de acceso.
- `password_hash`: contraseña demo para desarrollo.
- `role`: `student`.

No se requiere correo electrónico para estudiantes.

### Límite de intentos por evaluación

Al crear una evaluación el profesor puede elegir:

- `Ilimitada`.
- `1 intento`.
- `2 intentos`.
- `3 intentos`.
- `4 intentos`.
- `5 intentos`.

El valor se guarda en `worksheets.max_attempts`. Si el estudiante supera el límite, el backend rechaza el envío.

### Respuestas permanentes y revisión

Cada envío del estudiante queda guardado en `worksheet_responses`, incluso si después la evaluación se deshabilita. El registro incluye:

- nombre del estudiante;
- fecha de envío;
- puntuación;
- número de aciertos;
- número de respuestas pendientes;
- respuestas originales en `answers_json`;
- detalle por actividad en `details_json`.

Las actividades con respuesta automática (`fillblank` y `multiplechoice`) se marcan como:

- verde: correcta;
- rojo: incorrecta.

Las actividades escritas o abiertas (`textbox`, `speaking`, `reading`, `imagequestion`, etc.) quedan en amarillo como pendientes. En **Revisión**, el profesor puede marcar cada pendiente con check o equis y puede añadir un comentario opcional para el estudiante.
