# Plan de acción — la hoja le entrega al alumno su propia clave de respuestas

> Estado: **pendiente**. Redactado el 2026-07-27 durante la revisión QA de actividades.
> Ejecutable en una sesión aparte. No requiere nada de la revisión QA salvo lo ya mergeado.

## 1. El problema real es más grande que la URL del TTS

La fuga que se detectó primero fue la del reproductor:

```
GET /tts?text=Tom%20didn't%20have%20to%20wear%20a%20uniform&voice=en-US-GuyNeural
GET /tts/conversation?lines=female|Hi,%20are%20you%20new%20here?...
```

Cualquiera que abra la pestaña **Red** del navegador lee la oración que debía oír, y con ella la
respuesta del `listeningfillblank`.

Al dimensionarlo apareció una fuga **mayor y anterior**: los endpoints que entregan la hoja al
alumno devuelven `json_content` **completo**, y el modelo `Activity` (`backend/app/models.py:61`)
incluye `answer`, `statements[].answer`, `pairs[].match` y `audio_text`.

```
GET /public/worksheets/{id}        →  main.py:859
GET /public/classrooms/{id}/worksheets → main.py:846
GET /public/worksheets             →  main.py:853
GET /students/{id}/worksheets      →  main.py:511
```

Es decir: **la clave de respuestas completa viaja al navegador de todos los alumnos**, en cada
hoja, con o sin cuenta. No hace falta ni la pestaña de red: basta mirar la respuesta de la API.

Esto es lo que hay que cerrar. La URL del TTS es un caso particular del mismo error: el cliente
recibe datos que no le corresponden.

### Por qué pasar el TTS a POST NO sirve

El cuerpo de la petición se ve igual de bien en la pestaña de red. Cambiar `GET` por `POST` no
oculta nada; solo lo mueve de sitio. **No hacerlo.**

## 2. Principio del arreglo

> El cliente nunca debe poseer un dato que no necesita para pintar la actividad.
> Lo que hace falta para reproducir un audio es una **referencia**, no el texto.

La calificación **ya ocurre en el servidor** (`_build_answer_details` lee
`worksheet.json_content` de la BD, no lo que manda el alumno), así que quitar las claves del
payload no afecta a la corrección. Esto es lo que hace el plan viable.

## 3. Qué necesita de verdad cada renderer

Auditado contra `src/components/activityRegistry.tsx`:

| Campo | ¿Lo necesita el cliente? | Nota |
|---|---|---|
| `answer` de multiplechoice / multiselect / listeningmultiplechoice | **No** | Se elige por texto de la opción |
| `answer` de listening / conversation / textbox | **No** | Respuesta escrita libre |
| `answer` de fillblank / listeningfillblank | **No** | Solo lo usaba `blankWidth` para el ancho; sin él cae al ancho por defecto (96 px) y el número de huecos sale de `text.split('_____')` |
| `statements[].answer` | **No** | Solo se pinta `statements[].text` |
| `pairs[].match` de listeningmatching | **No** | El desplegable usa `options` |
| `answer` de dragdrop | **No** | Las fichas salen de `bank` |
| `audio_text` / `text` de listening* | **No** *(tras la fase 2)* | Hoy se necesita porque el front construye la URL del TTS |
| `lines` de conversation | **No** *(tras la fase 2)* | Igual: hoy arma el guion para `/tts/conversation` |
| `target` de speaking | **Sí** | Es la oración que el alumno debe leer en voz alta: se muestra a propósito |
| `right` de matching | **Sí, pero es la clave** | Se muestra barajado en pantalla, pero el **orden original del JSON es la clave** (`left[i] ↔ right[i]`) |
| `answer` de listeningorder | **Sí, si no hay `bank`** | El front baraja `answer` cuando falta `bank` |
| `bank`, `options`, `left`, `text` visible, `content`, `html`, `image`, `prompt`, `question` | **Sí** | Se pintan |

Tres casos no se resuelven solo quitando campos: **matching**, **listeningorder** y el **audio**.

## 4. Fases

Cada fase aporta valor por sí sola y se puede parar entre una y otra.

### Fase 1 — Sanear el payload (el 80 % del valor, riesgo bajo)

**Qué:** una función que devuelve la hoja sin las claves que el cliente no necesita, aplicada solo
en los endpoints de alumno/invitado.

**Dónde:**
- `backend/app/main.py`: `_for_student(worksheet)` — copia `json_content` quitando por tipo:
  `answer` (salvo `listeningorder`), `statements[].answer`, `pairs[].match`.
  Aplicarla en los cuatro endpoints listados en §1.
- **No** tocar `GET /worksheets/{id}` ni `GET /worksheets`: el profesor necesita la clave para la
  vista previa, el modo práctica, la impresión y el editor.

**Qué NO se rompe:**
- Calificación: server-side, lee de BD.
- Modo práctica del profesor: usa endpoint autenticado.
- `WorksheetPrint`: lo usa el profesor.
- `blankWidth` en `activityRegistry.tsx`: sin `answer` cae a 96 px, sin excepción.
- `normalizeActivity` (`src/services/api.ts`): ya usa `?? ''` / `?? []` en todos los `answer`.

**Cómo verificar:** pedir una hoja como invitado y comprobar que la respuesta JSON no contiene
ninguna clave; resolverla y comprobar que el puntaje sigue saliendo bien.

### Fase 2 — Audio por referencia (cierra `audio_text` y `lines`)

**Qué:** el front pide el audio por id de actividad; el backend busca el texto en BD.

```
GET /public/tts/{worksheet_id}/{activity_id}     → sustituye a /tts?text=
```
Resuelve solo, dentro del backend, si la actividad es `listening` (`text`), otro `listening*`
(`audio_text`) o `conversation` (`lines`, con las dos voces). 404 si la hoja no está publicada o
el id no existe. Debe ser `/public/*` **sin JWT**: lo usan el modo invitado y el enlace directo
`/w/:id`.

**Dónde:**
- `backend/app/main.py`: endpoint nuevo, reutilizando la síntesis de `/tts` y `/tts/conversation`.
- `src/components/AudioPlayer.tsx`: `buildTtsUrl` acepta `{worksheetId, activityId}` además de
  `text`.
- `src/components/activityRegistry.tsx`: los 7 renderers con audio pasan la referencia.
  **Decisión de diseño:** el `AudioPlayer` no conoce la hoja. Lo menos invasivo es un
  `WorksheetContext` que ponga `WorksheetRenderer` con el `worksheetId`, en vez de bajar la prop
  por siete componentes.
- Solo después de esto se pueden quitar `audio_text` y `lines` del saneado de la fase 1.

**Qué se mantiene:** `GET /tts?text=` sigue existiendo para el **vocabulario** (`TtsButton`, texto
visible, nada que ocultar) y para la **vista previa del constructor visual**, que reproduce audio
de actividades que todavía no están en BD. Ese caso es del profesor: no hay nada que ocultarle.

**Límite honesto:** esto impide *leer* la respuesta, no *descargar* el MP3 — que es exactamente lo
que el alumno ya podía hacer escuchando.

### Fase 3 — Los dos casos con orden significativo

- **`matching`:** el orden de `right` en el JSON es la clave. El servidor debe barajarlo antes de
  enviarlo y guardar la correspondencia, o cambiar el modelo de respuesta a ids en vez de texto.
  Es el cambio más invasivo: toca `_build_answer_details` (hoy compara `activity.right[index]`) y
  `MatchingRenderer`. **Valorar si compensa**: el alumno ve las dos columnas de todos modos, así
  que la ventaja de leer el JSON es "saber el emparejamiento", no trivial pero tampoco todo.
- **`listeningorder`:** hoy el front baraja `answer` si falta `bank`. Solución barata: hacer `bank`
  **obligatorio** en `_activity_problem` (`parser.py`) y quitar `answer` del payload. El
  constructor visual y ambos prompts ya lo generan casi siempre.

## 5. Orden recomendado y esfuerzo

| Fase | Esfuerzo | Cierra |
|---|---|---|
| 1 | 1 función + 4 llamadas | Todas las claves escritas y de opción múltiple, T/F y listeningmatching |
| 2 | 1 endpoint + `AudioPlayer` + context + 7 renderers | El texto oculto de todos los listening y conversation |
| 3 | `bank` obligatorio (barato) · matching (caro) | Los dos casos con orden significativo |

Empezar por la **fase 1**: es donde está casi todo el daño y no toca el frontend.

## 6. Cosas que no hay que romper

- **Modo invitado** y **enlace directo `/w/:id`** funcionan sin JWT → todo lo nuevo va en `/public/*`.
- La **vista de resultados** del alumno sí puede mostrar la respuesta correcta: viene de
  `worksheet_responses.details`, no de `json_content`. No la toca este plan.
- El **profesor** conserva el payload completo en todos sus endpoints.
- `db/schema.sql` y `db/schema.postgres.sql` no cambian: esto es solo capa de API.

## 7. Comprobación al terminar

1. Como invitado, `GET /public/worksheets/{id}` no devuelve ningún `answer`, `match` ni
   `statements[].answer`.
2. Resolver esa misma hoja y comprobar que el puntaje y los comentarios de la IA son idénticos a
   los de antes del cambio.
3. Como profesor, `GET /worksheets/{id}` sí devuelve todo, y el **modo práctica** sigue
   calificando.
4. Tras la fase 2: la pestaña de red no contiene el texto de ningún audio.
