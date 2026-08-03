# 08 — Renderer: del DSL a la actividad en pantalla

La sintaxis del DSL está en [07_DSL](07_DSL.md). Aquí: cómo ese JSON se convierte en algo que el
alumno puede resolver.

## Cadena completa

```
DSL (texto)  →  parser.py  →  worksheets.json_content (JSONB)
                                        │
                                        ▼  GET /worksheets/{id} · /public/worksheets/{id}
                              services/api.ts → normalizeActivity()
                                        │
                                        ▼
                              WorksheetRenderer.tsx        (hoja: bloques, tema, chrome)
                                        │
                                        ▼
                              activityRegistry.tsx         (un componente por tipo)
                                        │
                                        ▼
                              answers: { [activityId]: valor }
                                        │
                                        ▼  POST /responses · /public/responses
                              _build_answer_details()      (la clave se relee de la BD)
```

## `WorksheetRenderer.tsx`

Pinta la hoja completa. Responsabilidades:

**Bloques con retrocompatibilidad** — hojas antiguas sin `block {}` siguen funcionando:

```tsx
const blocks = worksheet.blocks?.length
  ? worksheet.blocks
  : [{ title: null, instructions: null, activities: worksheet.activities }];
```

**Tema por hoja** — los colores de `worksheet.theme` se aplican con estilos inline (no con clases).

**Campos de identificación** — el `info {}` de la hoja se pinta arriba y se guarda como
`answers_json._info_0`, `_info_1`… El profesor los ve en la revisión. El enlace directo `/w/:id` usa
el primero como nombre del alumno (`nameFromAnswers`).

**Modos:**

| Prop | Para qué |
|------|----------|
| normal | El alumno resuelve y envía |
| `readonly` | Vista previa del profesor / resultados |
| `gradeStatus` | Resaltado inline tras el modo práctica |

`buildGradeStatus` agrega los ids compuestos `id:índice` de `matching`, `truefalse` y familia, con
precedencia **incorrecto > abierta > correcto**.

## `activityRegistry.tsx`

Un componente por tipo. Detalles que importan:

**`fillblank` / `dragdrop` / `listeningfillblank`** — el marcador `_____` (exactamente 5 guiones
bajos) se parte y entre las partes va un `<input>` o un hueco:

```tsx
const processed = activity.text.replace(/\\n/g, '\n');
const parts = processed.split('_____');
```

Un solo hueco → el valor enviado es `string`; varios → `string[]`.

> **`blankWidth()` usa un único ancho por actividad** (el de la respuesta más larga). Antes se
> calculaba por hueco con SU respuesta esperada, y el ancho del input **delataba la longitud de la
> respuesta**.

**`matching`** — se une con **líneas**: se arrastra desde el punto o se toca uno de cada lado, y cada
par toma un color. La columna derecha se baraja con `shuffledByHash` (determinístico por
`activity.id`), pero la clave sigue siendo posicional (`left[i] ↔ right[i]`).

**`multiplechoice` / `multiselect` / `dragdrop`** — la app **baraja las opciones al mostrarlas**, así
que la posición en el DSL no delata nada.

**`listeningorder`** (`ListeningOrderRenderer`) — tap-to-place estilo Duolingo: fichas desordenadas
que se tocan para armar la oración; tocar una ficha colocada la devuelve al banco.

**`speaking`** — graba con el micrófono y transcribe con `POST /public/transcribe` (Groq Whisper).
Sin micrófono o sin permiso, aparece un campo de texto de respaldo. Con `target`, el alumno ve la
oración, un botón 🔊 para escucharla y, tras grabar, **cada palabra en verde o rojo**
(`speakingWordStatus`) para saber qué repetir.

**`content`** (`ContentRenderer`) — repaso HTML de solo lectura, **no se califica**. Dos modos:

| Modo | Cómo | Para qué |
|------|------|----------|
| Por defecto | `InlineContent` + **DOMPurify** (bloquea `<script>`, `onclick`, `javascript:`) | Se integra con el tema y se imprime |
| `sandbox: true` | `SandboxedHtml.tsx`: HTML completo en `<iframe sandbox="allow-scripts">` **sin** `allow-same-origin` | CSS/JS/fuentes propios, aislado de la app |

Ambos van en un recuadro de altura acotada (`maxHeight` 560 px): si el contenido es más alto hace
scroll interno y aparece `ScrollHint` ("↕ Desliza…"); si es más corto, el recuadro se ajusta. El
sandbox reporta su altura por `postMessage` (snippet inyectado en el `srcDoc`; el padre valida
`e.source`) y el inline detecta overflow con `ResizeObserver`. **En impresión siempre se usa la
versión saneada estática.** `content` queda fuera del chrome "Actividad N / Interactiva".

## Audio

`AudioPlayer.tsx` construye la URL del TTS y reproduce el `audio/mpeg` en streaming:

- Actividades `listening*` → `GET /tts?text=…&voice=…`
- `conversation` → prop `conversation` → `GET /tts/conversation?lines=…` (voces m/f alternadas,
  MP3 concatenado)
- `voice` (`male`/`female`) baja desde la actividad; el default es la preferencia global del usuario
  (`voicePreference.ts`).

**`reading` y `readingtruefalse` NO llevan reproductor**: leerle el texto en voz alta al alumno
convierte una evaluación de comprensión **lectora** en una **auditiva**. Para escucha están los
`listening*`.

## Texto

`RichText.tsx` convierte el `\n` literal guardado en la base en salto de línea real:

```tsx
const processed = (text ?? '').replace(/\\n/g, '\n');
return <span className={`whitespace-pre-line ${className}`}>{processed}</span>;
```

Instrucciones de mecánica en **español** ("Escribe la palabra que falta", "Elige…"); el inglés se
reserva para el contenido que se evalúa.

## Imágenes (`imagequestion`)

La imagen **nunca se recorta**: en un `imagequestion` el alumno responde sobre lo que ve, así que
un encuadre forzado puede dejar fuera justo el detalle que hay que describir.

```tsx
<img className="mx-auto mb-4 block max-h-[26rem] w-auto max-w-full rounded-2xl" … />
```

`w-auto` + `max-w-full` + `max-h-[26rem]` conserva la proporción y solo limita el tamaño; **no uses
`object-cover` ni una altura fija** (`h-56`), que es lo que había antes y recortaba. En impresión,
`.wp-img` hace lo mismo con `max-height: 190px`.

Las imágenes subidas llegan con `f_auto,q_auto,c_limit,w_1200` en la URL → [05](05_API.md).
`c_limit` solo reduce: una foto pequeña se queda a su tamaño en vez de estirarse.

## Feedback al alumno

- **Sonidos de clic** (`utils/sfx.ts`, ZzFX sintetizado, sin archivos): al elegir opción, multiselect,
  drag&drop, matching, true/false y variantes de listening. El primer clic habilita el audio.
- **Animación de envío** (`submitAnimations.tsx`): al enviar se elige **una al azar** (cohete /
  pastelero / paracaidista), con SFX ZzFX. Umbral de éxito **≥ 70** (`PASS_THRESHOLD`). Para añadir
  otra, se registra en `SUBMIT_ANIMATIONS`.
- **Confirmación de envío**: `SubmitConfirmModal`, propio, no `window.confirm`.

## Impresión (`WorksheetPrint.tsx`)

Botón "Imprimir PDF" en el portal del profesor (lista de evaluaciones y barra de revisión). Vista de
papel compacta con `createPortal(document.body)` + impresión nativa (`window.print()` → Guardar como
PDF); en `@media print` se oculta `#root`.

**Omite `listening*` y `speaking`** (no pasan a papel) y deja líneas y casillas para escribir.

## Añadir un tipo de actividad nuevo

El recorrido completo, en orden. Saltarse un paso hace que el campo o el tipo se pierda **en
silencio**:

1. `parser.py` — añadirlo a `SUPPORTED_BLOCKS`, parsearlo y **darle su regla en `_activity_problem`**.
2. `domain.py` / `models.py` — los campos nuevos, o Pydantic los descarta al serializar.
3. `main.py` — su rama en `_build_answer_details` (o `continue` si no se califica).
4. `ai.py` — si el corrector exacto puede fallar con un acierto legítimo, evaluarlo para
   `_AI_RESCUABLE`; y documentarlo en `_WORKSHEET_SYSTEM`.
5. `src/types.ts` y `services/api.ts` (`normalizeActivity`, `withInstructions`).
6. `activityRegistry.tsx` — el componente.
7. `VisualWorksheetBuilder.tsx` + `dslSerializer.ts` — editor visual y round-trip.
8. `WorksheetPrint.tsx` — cómo se ve en papel, o si se omite.
9. [07_DSL](07_DSL.md) + `GENERATION_PROMPT` (`src/utils/generationPrompt.ts`).
10. `backend/tests/test_parser.py` — `test_every_documented_type_parses` cubre que la sintaxis
    documentada parsea.
