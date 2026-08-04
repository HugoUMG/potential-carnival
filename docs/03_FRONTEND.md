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
| `WorksheetRenderer.tsx` | Pinta una hoja al alumno (bloques, tema, `gradeStatus`) → [08](08_RENDERER.md). Exporta además `WorksheetThumb`, la miniatura estática de las tarjetas del profesor |
| `activityRegistry.tsx` | Un componente por tipo de actividad → [08](08_RENDERER.md) |
| `WorksheetEditor.tsx` | Editor del profesor en tres modos (script / visual / IA) |
| `VisualWorksheetBuilder.tsx` | Constructor drag-and-drop; soporta los 21 tipos. El selector de imagen es `ImageField` (URL + Subir + Biblioteca + arrastrar y soltar) y lo comparten `imagequestion`, `imagechoice` (una por opción) e `imagematching` (una por fila): "Subir" llama a `subirImagen()`, "Biblioteca" abre `ImagePickerModal` |
| `ImagePicker.tsx` | `MyImagesGrid` (biblioteca personal: subir/copiar/borrar, y selector si recibe `onSelect`), `FreeImagePicker` (buscador simple de la gratuita para el modal) e `ImagePickerModal` (las dos en pestañas Gratuita/Mía) |
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
| `dslSerializer.ts` | Estado del constructor visual → DSL (`serializeToScript`) y → actividad del renderer (`toWorksheetActivity`) |
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
`editingWorksheetId` (editar en el sitio), `isolatedEdit` (editor aislado), `savedWorksheet` (aviso
"Guardada"), `practiceWorksheet` / `practiceAnswers` / `practiceResult` (modo práctica),
`activeWorksheet`, `submitResult`.

## «Evaluaciones guardadas»: tarjetas + editor aislado (ADR-22)

La sección es una **rejilla de tarjetas**, no una lista de filas. Cada tarjeta lleva:

- **Mini vista previa estática** (`WorksheetThumb`, exportado desde `WorksheetRenderer.tsx`).
- Estado (Habilitada / Borrador), nº de actividades, respuestas, intentos y aulas.
- Las dos acciones de uso diario a la vista (Habilitar/Deshabilitar, Asignar a aula) y el resto en el
  menú **⋮** (`<details class="row-menu row-menu-up">`, sin estado de React): ver respuestas, copiar
  enlace, duplicar, vista previa, modo práctica, imprimir, archivar y borrar. `row-menu-up` despliega
  hacia arriba porque el menú vive al fondo de la tarjeta.

**La miniatura no carga nada.** `WorksheetThumb` filtra los tipos que montarían un `AudioPlayer`
(`listening*`, `conversation`), el que pide micrófono (`speaking`) y el `content` con `sandbox`
(un iframe con scripts propios): con nueve tarjetas en pantalla eso serían decenas de peticiones al
TTS por una imagen de 160 px. Lo que queda se pinta con el renderer del alumno en `readonly`, dentro
de un `pointer-events-none` y encogido con `scale`. No hay un segundo renderer que se desincronice.

**Clic en la miniatura → editor aislado** (`startEditWorksheet(worksheet, /* isolated */ true)`).
Es una **sub-vista de `crear`, no una ruta nueva**: `isolatedEdit` oculta `TeacherDashboard`, quita la
columna del menú de la rejilla y añade una barra «Volver a Evaluaciones». Reutiliza tal cual el estado
de edición que ya vivía en `App.tsx` (`editingWorksheetId`, `activeWorksheet`, `scriptDraft`…), así
que **no se crea una copia**: se edita la misma hoja y guardar sigue pasando por `updateWorksheet`.
Cualquier navegación por el menú apaga `isolatedEdit`.

Una hoja **con respuestas** no se puede editar: al abrirla, `startEditWorksheet` vuelve al listado con
el aviso de siempre (duplícala) en vez de entrar al editor aislado.

## Guardar una hoja: siempre la MISMA hoja

`saveScript` elige entre `createWorksheet` y `updateWorksheet` según `editingWorksheetId`. La regla:

**Al crear, el editor queda atado a la hoja recién creada (`setEditingWorksheetId(worksheet.id)`).**
No hacerlo fue un bug real: cada guardado posterior volvía a entrar por `createWorksheet` y nacía una
copia. Por el mismo motivo, actualizar **no** vuelve a poner `editingWorksheetId` a `null`.

Solo se empieza una hoja nueva desde el menú "Crear evaluación" o el botón "Nueva evaluación", que
limpian el `editingWorksheetId` a propósito.

**Generar con IA no devuelve un borrador: `POST /worksheets/ai-generate` YA guarda la hoja.** Por eso
`adoptAiWorksheet` la adopta como la hoja en edición. Sin eso, el primer "guardar" después de generar
creaba una segunda y la generada quedaba huérfana en la lista → [05](05_API.md).

Guardar tampoco saca del editor ni abre la vista previa: aparece `SavedPanel` ("Guardada") con cuatro
atajos — vista previa, constructor visual, script e IA. El `useEffect` de `WorksheetEditor` que vigila
`worksheet.scriptContent` recarga el constructor visual cuando la hoja cambió por fuera; sin él,
"ver y editar en gráfico" abría la versión anterior y el siguiente guardado la revertía.

## Constructor visual: se diseña sobre lo que verá el alumno

Cada actividad plegada se pinta con el **renderer de verdad** (`activityRegistry`, en `readonly` y
dentro de un `pointer-events-none`), no con una imitación. Al hacer clic se abre el formulario de
edición, y solo hay **una tarjeta abierta a la vez** en toda la hoja.

El puente es `toWorksheetActivity` (`dslSerializer.ts`), espejo exacto de `serializeActivity`: los dos
traducen los campos planos del constructor a la forma real del tipo. Si tocas uno y no el otro, la
tarjeta del profesor **miente** sobre lo que verá el alumno en vez de fallar. El `switch` exhaustivo
sobre la unión hace que `tsc` avise si falta un tipo entero, pero no si falta un campo.

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
- **Biblioteca de imágenes (`ImageLibraryPage`):** sub-pestañas **Gratuita** (el JSON estático de
  siempre) y **Mía** (`MyImagesGrid`, persistida en `teacher_images` vía `/uploads/images`). Subir en
  "Mía" reutiliza `subirImagen()` + `registrarImagen()`; cada tile tiene copiar URL y borrar con
  confirmación. El mismo `MyImagesGrid` se reusa dentro de `ImagePickerModal` (botón "Biblioteca" del
  editor de `imagequestion`), donde además hace de selector: clic en la imagen la elige y cierra el
  modal en vez de solo copiar.

## Convenciones

- TypeScript estricto; los tipos compartidos viven en `src/types.ts`.
- Tailwind por clases en el JSX; CSS propio solo en `src/styles/app.css`.
- Iconos: `lucide-react`.
- Los textos de la interfaz van en **español**; el contenido evaluable de las hojas, en **inglés**.
- Lint: `npm run lint` (ESLint 9, `--max-warnings 0`).
