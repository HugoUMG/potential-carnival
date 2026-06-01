# Constructor de hojas con IA

Prototipo full-stack para crear, generar, publicar y completar hojas de trabajo interactivas de inglés. El docente escribe o genera `WorksheetScript` con IA; el backend lo convierte en JSON validado; el frontend renderiza las actividades con un registro extensible de componentes React.

## Arquitectura

- **Frontend:** React, Vite, TypeScript y estilos con utilidades tipo TailwindCSS.
- **Backend:** FastAPI con modelos Pydantic y parser de WorksheetScript.
- **Persistencia objetivo:** PostgreSQL; este prototipo usa un repositorio en memoria para desarrollo rápido.
- **Autenticación objetivo:** JWT con roles preparados para docentes y estudiantes.

## Flujo de WorksheetScript

```text
Instrucción del docente → IA → WorksheetScript → parser → JSON → registro de actividades React → hoja interactiva
```

La IA debe devolver WorksheetScript. No debe devolver HTML.

## Actividades incluidas

- Completar espacios.
- Opción múltiple.
- Caja de texto.
- Relacionar columnas.
- Expresión oral con respuesta escrita temporal.
- Lectura con preguntas.
- Pregunta con imagen.

## Ruta para ejecutar el proyecto en tu PC con Visual Studio Code

> Estas instrucciones asumen que usarás **Visual Studio Code**. Si dices “Visual Studio”, normalmente para este proyecto conviene usar **Visual Studio Code**, porque es más cómodo para React, Vite y FastAPI.

### 1. Instala herramientas necesarias

1. Instala **Node.js LTS** desde <https://nodejs.org/>.
2. Instala **Python 3.12** o una versión compatible desde <https://www.python.org/>.
3. Instala **Visual Studio Code** desde <https://code.visualstudio.com/>.
4. En Visual Studio Code instala estas extensiones recomendadas:
   - ESLint.
   - Python.
   - Pylance.
   - Tailwind CSS IntelliSense.

### 2. Abre la carpeta correcta

1. Descarga o clona el repositorio.
2. Abre Visual Studio Code.
3. En el menú selecciona **Archivo → Abrir carpeta**.
4. Elige la carpeta raíz del proyecto: `potential-carnival`.
5. Verifica que en el explorador de VS Code veas estas carpetas y archivos:
   - `src/`
   - `backend/`
   - `package.json`
   - `README.md`

### 3. Ejecuta el frontend

Abre una terminal integrada en VS Code con **Terminal → Nueva terminal** y ejecuta:

```bash
npm install
npm run dev
```

Luego abre en el navegador la URL que muestre Vite, normalmente:

```text
http://localhost:5173
```

### 4. Ejecuta el backend

Abre una segunda terminal integrada en VS Code y ejecuta:

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

Instala dependencias del backend:

```bash
pip install -r backend/requirements.txt
```

Levanta la API:

```bash
uvicorn backend.app.main:app --reload
```

La API quedará disponible en:

```text
http://localhost:8000
```

La documentación automática de FastAPI estará en:

```text
http://localhost:8000/docs
```

### 5. Comandos útiles de verificación

```bash
npm run build
python -m pytest backend/tests
```

## Estructura principal del proyecto

```text
potential-carnival/
├─ src/                         # Frontend React
│  ├─ components/                # Editor, dashboard, renderer y registro de actividades
│  ├─ data/                      # Hoja de ejemplo en español
│  ├─ styles/                    # Estilos globales
│  ├─ App.tsx                    # Vista docente/estudiante
│  └─ types.ts                   # Tipos TypeScript
├─ backend/
│  ├─ app/                       # API FastAPI, parser, modelos y repositorio
│  └─ tests/                     # Pruebas del parser
├─ package.json                  # Scripts y dependencias del frontend
└─ README.md                     # Guía de uso
```

## Notas importantes

- Las palabras clave de `WorksheetScript` se mantienen en inglés (`worksheet`, `fillblank`, `multiplechoice`, etc.) porque forman parte del lenguaje interno definido por el proyecto.
- Todo el contenido visible para docentes y estudiantes está en español.
- En una fase posterior se puede conectar PostgreSQL real, autenticación JWT completa y una API de IA externa.
