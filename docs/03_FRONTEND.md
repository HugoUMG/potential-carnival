# 03 — Frontend (React 19 + Vite + TypeScript)

El render de actividades tiene su propio documento: [08_RENDERER](08_RENDERER.md).

## Rutas (`src/main.tsx`)

| Ruta | Componente | Acceso |
|------|-----------|--------|
| `/`, `/acerca`, `/actividades`, `/aprende` | `SiteLayout` + páginas del sitio | público |
| `/login` | `LoginPage` | público |
| `/registro` | `RegisterPage` | público — **solo crea profesores, solo con Google** |
| `/teacher/:section?` | `App` (modo teacher) | teacher, admin |
| `/admin/:section?` | `App` (modo admin) | admin |
| `/student/:section?` | `App` (modo student) | student |
| `/reader` | `ReaderPortal` | reader |
| `/vocab` | `VocabPublicPage` | público |
| `/v/:vocabId` | `VocabDirectPage` | público (enlace directo a una lista) |
| `/w/:worksheetId` | `DirectWorksheetPage` | público (enlace directo a una hoja) |
| `/guest` | `GuestPage` | público — **sin entradas en la UI**, solo por URL |
| `/__shots` | `DevShots` | solo en `import.meta.env.DEV` |

`ProtectedRoute` envuelve los portales autenticados. Cualquier otra ruta redirige a `/`.

## Las secciones son rutas, no estado

```tsx
const TEACHER_SECTIONS: TeacherMenu[] = ['dashboard', 'crear', 'evaluaciones', 'archivadas',
  'aulas', 'estudiantes', 'profesores', 'revision', 'invitados', 'actividad', 'vocabulario', 'imagenes'];
const STUDENT_TABS: StudentTab[] = ['activas', 'calificadas', 'vocabulario', 'perfil'];

const adminMenu = TEACHER_SECTIONS.includes(section as TeacherMenu) ? section : 'crear';
```

La pestaña activa se **deriva de `useParams`**. Así se comparte por URL, se marca en favoritos y el
botón "atrás" del navegador funciona.

**Para añadir una sección de profesor:** agregarla a `TEACHER_SECTIONS` en `App.tsx` **y** al `GROUPS`
de `TeacherDashboard.tsx`. El menú lateral está agrupado: Resumen · Contenido · Mis grupos ·
Seguimiento (antes eran diez botones seguidos).

## Componentes

| Componente | Qué hace |
|-----------|----------|
| `App.tsx` | Los tres portales autenticados, incluida la revisión de respuestas del profesor |
| `WorksheetRenderer.tsx` | Pinta una hoja al alumno (bloques, tema, `gradeStatus`) → [08](08_RENDERER.md) |
| `activityRegistry.tsx` | Un componente por tipo de actividad → [08](08_RENDERER.md) |
| `WorksheetEditor.tsx` | Editor del profesor en tres modos (script / visual / IA) |
| `VisualWorksheetBuilder.tsx` | Constructor drag-and-drop; soporta los 19 tipos. En `imagequestion`, "Subir" llama a `subirImagen()` y rellena el campo con la URL |
| `WorksheetPrint.tsx` | Vista de papel + `window.print()` → PDF |
| `VocabularyViewer.tsx` / `VocabularyPrint.tsx` | Listas de vocabulario |
| `AudioPlayer.tsx` | Reproductor TTS (`/tts`, y `/tts/conversation` con la prop `conversation`) |
| `SandboxedHtml.tsx` | `content` con `sandbox: true` en un `<iframe sandbox="allow-scripts">` |
| `RichText.tsx` | Convierte el `\n` literal guardado en BD a salto real |
| `submitAnimations.tsx` | Animación de resultado al azar + SFX ZzFX |
| `SubmitConfirmModal.tsx` | Confirmación propia de envío (no `window.confirm`) |
| `LoadingScreen.tsx` | `LoadingScreen` / `Spinner` compartidos |
| `TeacherDashboard.tsx` | Menú lateral agrupado (`GROUPS`) + métricas |
| `GoogleSignInButton.tsx` | Google Identity Services → `POST /auth/google` |
| `ThemeToggle.tsx` | Interruptor claro/oscuro |
| `ProtectedRoute.tsx` | Guarda de rutas por rol |
| `RexMascot.tsx` | Mascota del rebrand |

## Utilidades (`src/utils/`)

| Archivo | Qué hace |
|---------|----------|
| `theme.ts` | `initTheme()` / `toggleTheme()`; el tema vive en `data-theme` del `<html>` |
| `sfx.ts` | Blips de clic sintetizados con ZzFX (sin archivos de audio) |
| `dslSerializer.ts` | Estado del constructor visual → DSL |
| `generationPrompt.ts` | `GENERATION_PROMPT`: el prompt que el profesor copia para otra IA |
| `voicePreference.ts` | Preferencia global de voz TTS |

## Cliente HTTP

Todo pasa por `src/services/api.ts`: adjunta el JWT desde `localStorage`, normaliza y expone una
función por endpoint. **Ningún componente hace `fetch` por su cuenta.**

`normalizeActivity` / `withInstructions` rellenan los campos opcionales de una actividad. **Un campo
nuevo de actividad hay que añadirlo aquí**, además de en `models.py` y en el parser — si no, se
descarta en silencio al leer o al persistir (pasó con `voice`).

## Estado

Sin Redux, sin Zustand, sin Context global: `useState`/`useEffect` en `App.tsx` y props hacia abajo.
El único estado compartido fuera de React son `localStorage` (JWT, tema, `dw_count_{id}` del enlace
directo, `guest_token`) y el atributo `data-theme`.

Estados con nombre que conviene conocer en `App.tsx`:
`editingWorksheetId` (editar en el sitio), `practiceWorksheet` / `practiceAnswers` / `practiceResult`
(modo práctica), `activeWorksheet`, `submitResult`.

## Modo oscuro: **no se toca el JSX**

El tema es CSS puro. Para que una pantalla se vea bien en oscuro se añade una regla al bloque
`@media screen { :root[data-theme='dark'] … }` al final de `app.css`, **repintando la clase de
Tailwind que la pantalla ya usa** (`.bg-white`, `.text-slate-500`, `.bg-rex-light`…).

- Nada de props `theme` ni de `useTheme()` en componentes de pantalla (solo los usan el interruptor y
  las capturas de `/aprende`).
- `initTheme()` corre en `main.tsx` **antes del primer render**, así que no hay parpadeo. Claro es el
  predeterminado.
- Va dentro de `@media screen`: al imprimir, el papel siempre es blanco.
- Las variantes con opacidad (`bg-rex-light/70`) necesitan su propio selector
  `[class*='bg-rex-light\/']` porque Tailwind genera una clase por porcentaje.

## Detalles de UI que ya mordieron

- **Panel de notificaciones:** la barra superior lleva `relative z-50`. El panel es `absolute` dentro
  de ella y sin z-index propio las secciones de abajo (que crean contexto de apilamiento con blur o
  sombra) lo tapaban. Usa `.notif-panel`, de fondo **opaco**: con el cristal se leía el menú detrás.
- **Spinners:** toda pantalla que dependa de la primera consulta muestra `LoadingScreen`/`Spinner`
  por la latencia de Aiven.
- **Capturas de `/aprende`:** hay dos juegos, `nombre.webp` y `nombre-dark.webp`; `Shot` en
  `LearnPage.tsx` elige según el tema. `node scripts/shots.mjs` genera los dos en una pasada.

## Funciones destacadas del portal

- **Editar en el sitio:** "Editar" abre la MISMA hoja en el editor y "Guardar cambios" la actualiza
  (`PUT /worksheets/{id}`, no crea copia). Bloqueado con 409 y botón deshabilitado si ya tiene
  respuestas.
- **Modo práctica:** abre la hoja interactiva para que el profesor la resuelva y verifique su clave.
  "Revisar respuestas" llama a `POST /worksheets/{id}/practice`, que califica **sin guardar nada**
  (dry-run, solo automático, sin IA) y devuelve resumen + resaltado inline (`gradeStatus`).
- **Vista previa al crear/editar:** al guardar se abre la vista del alumno (`WorksheetRenderer`
  readonly) con botón "Editar".
- **Enlace directo (`/w/:id`):** el profesor toca "Copiar enlace" (solo en hojas publicadas). El
  alumno entra sin login, sin menú y sin que le pidan el nombre — lo captura el `info {}` de la propia
  hoja (`nameFromAnswers` toma el primer `_info_*`; si no hay, "Sin nombre"). Cada envío usa un
  `guest_token` **nuevo**. Respeta `max_attempts` **por dispositivo** con el contador
  `dw_count_{id}` en `localStorage`.
- **Portal del alumno:** pestañas Activas / Calificadas / Vocabulario / Perfil. El perfil ya muestra
  información personal, sus aulas, el historial de notas y el cambio de contraseña propio.

## Convenciones

- TypeScript estricto; los tipos compartidos viven en `src/types.ts`.
- Tailwind por clases en el JSX; CSS propio solo en `src/styles/app.css`.
- Iconos: `lucide-react`.
- Los textos de la interfaz van en **español**; el contenido evaluable de las hojas, en **inglés**.
- Lint: `npm run lint` (ESLint 9, `--max-warnings 0`).
