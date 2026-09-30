# 05 — API

83 rutas, todas en `backend/app/main.py`. FastAPI publica su documentación interactiva en
`/docs` (OpenAPI) cuando el backend está levantado.

## Convenciones

- **Base:** `VITE_API_URL` en el frontend (`https://constructor-hojas-api.onrender.com` en producción).
- **Autenticación:** `Authorization: Bearer <jwt>`, salvo las rutas `/public/*` y `/health`.
- **Cuerpos y respuestas:** JSON, con `response_model` Pydantic declarado en cada endpoint
  (`models.py` es el contrato).
- **Errores:** `{"detail": "mensaje en español"}` con el código HTTP.
- **Versionado:** no hay `/v1`. Frontend y backend se despliegan juntos desde el mismo repo, así que
  el contrato se cambia en los dos sitios a la vez. Si algún día hay clientes externos, ese es el
  momento de versionar — no antes.

### Códigos usados

| Código | Cuándo |
|--------|--------|
| 400 | DSL inválido (`WorksheetScriptError`, con nº de actividad y motivo), datos mal formados |
| 401 | Sin token, token caducado o credenciales incorrectas |
| 403 | Rol insuficiente, o recurso de otro profesor |
| 404 | No existe, o no es visible para quien pregunta |
| 409 | Doble envío de respuestas |
| 503 | Falta una API key obligatoria (`GOOGLE_CLIENT_ID`, proveedor de IA) |

---

## Salud

```
GET|HEAD /health                              — Sonda (la usa UptimeRobot para mantener el servicio despierto)
```

## Autenticación y sesión

```
POST   /auth/login                            — username + password + role
POST   /auth/google                           — Login Y registro con ID token de Google
POST   /auth/logout                           — Cierra la sesión (cierra user_sessions)
GET    /auth/me                               — Perfil del usuario actual
```

**No existe alta pública con usuario y contraseña.** Se eliminó `POST /auth/register` a propósito —
ver [09_SECURITY](09_SECURITY.md) y [15_DECISIONS, ADR-05](15_DECISIONS.md).

## Usuarios

```
POST   /students                              — Crear alumno (teacher/admin); queda con created_by = quien lo crea
GET    /students                              — Listar SOLO los alumnos propios
DELETE /students/{id}                         — Eliminar alumno propio

POST   /teachers                              — Crear profesor (admin)
GET    /teachers                              — Listar profesores (admin)
DELETE /teachers/{id}                         — Eliminar profesor (admin)

POST   /readers                               — Crear lector
GET    /readers                               — Listar lectores
DELETE /readers/{id}                          — Eliminar lector

PUT    /users/{id}                            — Editar nombre/email
PUT    /users/{id}/password                   — Cambiar contraseña (los readers no pueden)
```

## Hojas de trabajo

```
POST   /worksheets                            — Crear desde script DSL
PUT    /worksheets/{id}                       — Editar en el sitio (no crea copia)
POST   /worksheets/ai-generate                — Generar hoja con IA desde un prompt (LA GUARDA: devuelve la hoja creada, no un borrador)
POST   /worksheets/ai-edit                    — Reescribir el script con una instrucción en lenguaje natural (NO guarda)
POST   /worksheets/ai-review                  — La IA resuelve la hoja como alumno y devuelve {report (Markdown), provider} (NO guarda ni modifica)
POST   /worksheets/audio-check                — Ida y vuelta TTS→Whisper de cada actividad audible: {items: [{type, text, heard, ok}]} (NO guarda)
GET    /worksheets                            — Listar (filtros: created_by, published, archived)
GET    /worksheets/{id}                       — Detalle (payload COMPLETO, con claves: es del profesor)
GET    /worksheets/response-counts            — Conteo de respuestas por hoja (bulk)
GET    /worksheets/classroom-assignments      — Aulas por hoja (bulk)
GET    /worksheets/{id}/classrooms            — Aulas que usan una hoja
POST   /worksheets/{id}/publish
POST   /worksheets/{id}/unpublish
POST   /worksheets/{id}/archive
POST   /worksheets/{id}/unarchive
POST   /worksheets/{id}/duplicate             — Copia nueva
DELETE /worksheets/{id}
```

`POST /worksheets/ai-generate` acepta un campo opcional **`printable`** (`bool`, por defecto
`false`): el **modo físico**. Con `true`, el system prompt prohíbe las actividades de audio/habla y
`strip_non_printable` borra del script las que el modelo haya colado igualmente. El resto del
contrato no cambia y las llamadas que no manden el campo se comportan como siempre — ver
[06_AI](06_AI.md#modo-físico--imprimible).

También acepta **`ai_grading`** (`bool`, por defecto `true`) y **`ai_tolerance`** (`int` 0–100, por
defecto 50): la hoja generada se guarda con esos valores (misma autoevaluación con IA que al crear
desde el editor). El editor las manda desde los controles "Autoevaluación con IA" del panel de
generación.

Y **`image_bank`** (lista opcional de `{id, name, description, url, tags, level}`): la biblioteca
gratuita del profesor. Se inyecta en el prompt para que las actividades de imagen generadas usen
**solo URLs del banco** (con oraciones acordes a la `description` de cada imagen). Sin el campo, la IA
no genera actividades de imagen — ver [06_AI](06_AI.md#banco-de-imágenes-image_bank).

```json
{ "prompt": "Past simple, A2, 8 actividades", "created_by": "…", "printable": true, "ai_grading": true, "ai_tolerance": 30, "image_bank": [ { "id": "dr-001", "name": "Morning Alarm Clock", "description": "An alarm clock rings on a bedside table", "url": "https://images.unsplash.com/…", "tags": ["morning", "alarm"], "level": "A1" } ] }
```

## Aulas

```
POST   /classrooms                            — Crear aula
GET    /classrooms                            — Aulas del profesor
GET    /classrooms/{id}                       — Detalle (con estudiantes y hojas)
DELETE /classrooms/{id}
PATCH  /classrooms/{id}/visibility             — Pública / privada

POST   /classrooms/{id}/students              — Asignar alumno
DELETE /classrooms/{id}/students/{sid}
POST   /classrooms/{id}/worksheets            — Asignar hoja
DELETE /classrooms/{id}/worksheets/{wid}
```

## Respuestas y calificación

```
POST   /responses                             — Enviar respuestas (alumno autenticado)
POST   /worksheets/{id}/practice              — Modo práctica: califica sin guardar (dry-run, solo auto, sin IA)
GET    /worksheets/{id}/responses             — Todas las respuestas de una hoja
GET    /students/{id}/responses               — Respuestas de un alumno
POST   /responses/{id}/review                 — Corrección/comentario manual del profesor
DELETE /responses/{id}
```

La calificación ocurre **dentro del POST**: exacta siempre, IA si la hoja tiene `ai_grading`. Ver
[06_AI](06_AI.md) y [02_BACKEND](02_BACKEND.md#calificación-en-mainpy).

## Portal del alumno

```
GET    /students/{id}/worksheets              — Hojas del alumno (filtradas por aula)
GET    /students/{id}/classrooms              — Aulas del alumno
GET    /students/{id}/sessions                — Historial de sesiones
GET    /students/{id}/vocabulary              — Vocabulario del alumno (vía aula)
```

> **`GET /students/{id}/worksheets` NO tiene fallback a "todas las publicadas".** Si el alumno no
> tiene aula asignada, no ve ninguna hoja. Es intencional.

## Profesor: seguimiento

```
GET    /dashboard/teacher                     — Métricas del profesor
GET    /teacher/notifications                 — Respuestas recientes (últimas 48 h)
GET    /teacher/activity-feed?since=          — Historial completo (la campanita usa 7 días)
GET    /teacher/worksheet-summary/{id}        — Resumen de desempeño redactado por la IA
GET    /students/activity                     — Estado online/offline de los alumnos
GET    /teacher/guest-logs                    — Accesos de invitados (solo de las aulas propias)
GET    /teacher/guest-detail?guest_token&classroom_id — Detalle de un invitado (403 si el aula es de otro)
GET    /teacher/reader-logs                   — Accesos de lectores
```

## Vocabulario

```
POST   /vocabulary                            — Crear lista
POST   /vocabulary/ai-generate                — Generar vocabulario con IA por tema (CSV)
GET    /vocabulary                            — Listas del profesor
GET    /vocabulary/{id}                       — Detalle
DELETE /vocabulary/{id}

POST   /vocabulary/{id}/assign                — Asignar a aula
DELETE /vocabulary/{id}/assign/{classroom_id}
GET    /vocabulary/{id}/classrooms

POST   /vocabulary/{id}/readers               — Asignar a lector directo
DELETE /vocabulary/{id}/readers/{reader_id}
GET    /vocabulary/{id}/readers
GET    /readers/{id}/vocabulary
POST   /reader/log-session                    — Registra el acceso de un lector
```

## Imágenes (subida)

```
POST   /uploads/signature                     — Firma una subida directa a Cloudinary (profesor/admin)
```

Devuelve `{cloud_name, api_key, timestamp, folder, signature}`. **El archivo no pasa por este
backend**: con esa firma el navegador hace `POST` a
`https://api.cloudinary.com/v1_1/{cloud_name}/image/upload` y se queda con `secure_url`, que es lo
que se pega en el campo `image:` del DSL. El backend no gasta ancho de banda ni depende del cold
start de Render.

`folder` es siempre `mydinoenglish/{id del profesor}` — lo fija el servidor, no el cliente, así que
nadie puede escribir en la carpeta de otro. La firma caduca (Cloudinary rechaza timestamps viejos).
Requiere `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET`; sin ellas
responde **503**.

```
GET    /uploads/images                        — Biblioteca personal del profesor (recientes primero)
POST   /uploads/images                        — Registra { public_id, url } tras subir a Cloudinary
DELETE /uploads/images/{id}                   — Borra una imagen propia (404 si no es del profesor)
```

Estos tres solo guardan/leen la fila en `teacher_images` (tabla, ver [04_DATABASE](04_DATABASE.md));
el archivo en sí lo sube el navegador directo a Cloudinary con la firma de arriba, igual que antes.
La biblioteca **gratuita** (`src/data/image-library.json`) es estática y no pasa por el backend.

## Audio (TTS)

```
GET    /tts?text=…&voice=…&rate=…            — Sintetiza una oración → audio/mpeg
GET    /tts/conversation?lines=…&male=…&female=…&rate=… — Diálogo con voces m/f alternadas, MP3 concatenado
```

**Dos motores, una función.** Todo el audio de la plataforma (`/tts`, `/tts/conversation`,
`/live/{code}/audio` y la prueba de audio) pasa por `_synth_mp3(parts, rate)`, que recibe una lista de
`(texto, voz)` y devuelve una sola pista MP3:

1. Con `ELEVENLABS_API_KEY` → **ElevenLabs** (`POST /v1/text-to-speech/{voice_id}`, modelo
   `ELEVENLABS_MODEL`, default `eleven_multilingual_v2`, `mp3_44100_128`). El mp3 se guarda en la
   tabla **`tts_cache`** con clave `sha256(modelo|voice_id|speed|texto)`: el plan gratuito son
   10 000 créditos al mes y un carácter es un crédito, así que **cada texto se paga una vez**, no
   una por alumno y reproducción. La caché se mira dos veces: antes de esperar turno y ya con él
   (`_eleven_slots`, semáforo de **1**), para que 30 alumnos que abren la hoja a la vez no pidan el
   mismo mp3 30 veces. Con 2 turnos —lo que admite el plan gratuito— se probó que dos alumnos
   simultáneos pagaban el mismo texto dos veces; con 1, el segundo ya lo encuentra en caché.
2. Sin clave, o si ElevenLabs falla en **cualquier** turno (cuota agotada, red, voz borrada) →
   **edge-tts** para la pista **entera**, con un `print("[tts] ElevenLabs falló…")` en el log de
   Render que incluye el cuerpo de la respuesta (ahí se lee `quota_exceeded`). No se mezclan
   motores en una pista: 44,1 kHz y 24 kHz concatenados se traban en el navegador. Los turnos que
   ElevenLabs sí hizo quedan en caché y no se vuelven a pagar.

`voice`: se sigue nombrando con las **voces de edge-tts** (cualquiera de las ~47 en inglés,
`edge-tts --list-voices`); por defecto `en-US-AndrewNeural`, y `/tts/conversation` toma `male` y
`female` por separado (`en-US-AndrewNeural` / `en-US-AriaNeural`). Con ElevenLabs, `_eleven_voice_for`
traduce ese nombre a la voz de la cuenta que mejor case por **etiquetas** (`GET /v2/voices`, una vez
por proceso): género (`_EDGE_EN_VOICES` guarda el de las 47), acento (`en-GB-` → british, `en-AU-` →
australian, `en-IE-` → irish, `en-IN-` → indian, el resto american), edad (`young` para Ana y Roger,
`middle_aged` para el resto) y `use_case` (educativa antes que narración/conversación antes que redes
sociales, y nunca `characters_animation`: a Roger le tocaba "Harry - Fierce Warrior"); pesos 8/4/2/±,
así el acento manda sobre el uso y los empates se rompen por orden alfabético. Con las 21 voces por
defecto de septiembre de 2026 salen: Andrew → Chris, Aria → Bella, Ryan → Daniel, Sonia → Alice,
Natasha → Alice (no hay australiana), Ana → Jessica, Roger → Will. **`ELEVENLABS_VOICES`**
(`en-US-AndrewNeural=Adam,en-US-AriaNeural=Sarah`: nombre de la voz en la cuenta, lo que va antes
del " - ", o su `voice_id`) fija la sustitución de una voz concreta sin tocar código; lo que no esté
ahí, o no exista en la cuenta, sigue las etiquetas. **En producción se usa esta variable**, no las
etiquetas: la prueba controlada del 2026-09-21 (la misma frase de 171 caracteres en las 18 voces
adultas, velocidad 0.85, juzgada por Gemini a ciegas en dos órdenes distintos, por el ritmo real en
palabras/min y por la confianza de Whisper) dio `en-US-AndrewNeural=Adam,en-US-AriaNeural=Sarah,
en-GB-SoniaNeural=Lily,en-AU-NatashaNeural=Lily,en-US-AnaNeural=Laura,en-US-RogerNeural=Liam`
(Ryan → Daniel sale solo). Brian, la elección "obvia" por su descripción de narrador, quedó la última. No hay ids fijos a propósito: las voces por
defecto de ElevenLabs **caducan el 31-12-2026** y las reemplazan otras. Un **`voice_id` de ElevenLabs literal** (20 caracteres alfanuméricos, `_ELEVEN_ID_RE`) también
vale en `voice`/`male`/`female`: es la manera de usar una voz concreta —por ejemplo una infantil de
la Voice Library añadida a My Voices, porque ElevenLabs no trae voces de niño—; si toca edge-tts,
suena Andrew en su lugar. El selector del reproductor ofrece 8 curadas (6 adultas + las infantiles
Ana ♀ y Roger ♂ — `voicePreference.ts`). **Las únicas voces de niño de la plataforma son Ana y
Roger**: en conversaciones y listening, un diálogo entre niños se hace con `en-US-AnaNeural` (niña)
y `en-US-RogerNeural` (niño). En edge-tts Roger es el único niño que sirve el endpoint, por eso el
backend le sube el tono `+35Hz` (`_VOICE_PITCH`); en ElevenLabs los dos caen a la voz **joven** de
su género. Un nombre literal que no esté en las 47 voces en inglés del endpoint de edge se rechaza
con un **400** y un mensaje claro (`_check_voice_exists`) **antes** de intentar nada, con o sin
ElevenLabs. Las voces de la conversación las pone el DSL (`male_voice`/`female_voice` en
`conversation {}` o en el `lines:` de un bloque): el front las manda aquí ya resueltas; si la
actividad no las fija, el endpoint usa las curadas de cada género.

`rate`: velocidad de **síntesis**, formato `±NN%` (el DSL la escribe como `very slow`/`slow`/
`normal` y el parser la normaliza a esta forma). Por defecto **`-15%`**: el alumno es principiante
y el motor vuelve a generar el audio más lento con articulación y pausas limpias, que es distinto de
estirar la onda con el `playbackRate` del navegador. En ElevenLabs se traduce a `voice_settings.speed`
= 1 + NN/100 acotado a **[0.7, 1.2]** (`_eleven_speed`): `-35%` (Muy lento) se queda en 0.7. `rate` y
`voice` acaban dentro del SSML que edge-tts manda a Microsoft, así que se validan (`_tts_rate` /
`_tts_voice`) y lo que no encaje cae al valor por defecto.
`/tts/conversation` concatena frames MP3 en crudo; si hiciera falta una pausa marcada entre turnos,
habría que intercalar un MP3 de silencio.

**Topes** (los dos son públicos a la fuerza: el front los usa como `src` de un `<audio>`, que no
manda cabeceras): `text` ≤ 2000 caracteres, `lines` ≤ 8000 → **422**. Más de **300 peticiones por
minuto y por IP** → **429**.

**Qué gasta créditos** (solo con ElevenLabs y solo en fallo de caché): la primera reproducción de
cada texto con cada `rate` (el alumno que cambia a «Muy lento» pide otra síntesis), cada pregunta
con audio la primera vez que se lanza en vivo, y **cada clic en "Probar el audio"** de una hoja que
cambió (la prueba sintetiza todo lo audible **con la voz y la velocidad del DSL de cada actividad**,
así que lo que sintetiza queda en caché y es exactamente lo que la hoja pedirá después: la prueba
precalienta la hoja sin pagar versiones que nadie oirá). La caché no expira: ~10 000 caracteres son unos 10 MB de mp3 al mes.

> ⚠️ La URL del TTS lleva el texto en claro, así que **filtra la respuesta de los listening**. Es un
> caso particular del problema descrito en [el plan de fuga de respuestas](plans/PLAN-fuga-de-respuestas.md).
> Pasarlo a POST **no** lo arregla (el cuerpo se ve igual en la pestaña de red).

## Evaluación en tiempo real (`/live/*`)

Sesión sincrona estilo Kahoot: el profesor lanza cada pregunta y el salón responde desde el celular.
El estado vive **en memoria** (`backend/app/live.py`), no en la base.

```
POST   /live/sessions                 — Abrir sesión desde una hoja propia → código de 5 letras   (profesor)
GET    /live/sessions                 — Sesiones abiertas propias (recuperar tras recargar)       (profesor)
GET    /live/history                  — Sesiones YA TERMINADAS con su podio (sale de la BD)       (profesor)
GET    /live/{code}/host              — Estado del panel: marcador completo + temario             (dueño)
POST   /live/{code}/next              — Lanzar la siguiente pregunta (body opcional: `duration`)  (dueño)
POST   /live/{code}/answers           — Cerrar la escucha y arrancar el cronómetro               (dueño)
GET    /live/{code}/audio?k=…         — mp3 de la pregunta abierta, para la PANTALLA          (llave)
POST   /live/{code}/reveal            — Cerrar la pregunta antes de tiempo y revelar              (dueño)
POST   /live/{code}/finish            — Terminar y GUARDAR una entrega por alumno                 (dueño)
DELETE /live/{code}                   — Cerrar y descartar la sesión                              (dueño)

GET    /live/{code}?pid=…             — Estado de la sesión (lo que polean alumno y pantalla)     (sin JWT)
POST   /live/{code}/join              — Entrar con los campos `info {}` de la hoja → `pid`        (sin JWT)
POST   /live/{code}/answer            — Enviar respuesta a la pregunta abierta                    (sin JWT)
POST   /live/{code}/react             — Lanzar uno de los 5 emojis de `REACTIONS`                 (sin JWT)
POST   /live/{code}/avatar            — Cambiar el avatar (solo en `lobby` o `ended`)             (sin JWT)
```

- **Catorce tipos jugables** (`LIVE_TYPES`): `multiplechoice`, `multiselect`, `truefalse`,
  `imagechoice`, `matching`, `imagematching`, `dragdrop`, `fillblank`, `listeningmultiplechoice`,
  `listeningtruefalse`, `listeningmatching`, `listeningfillblank`, `listeningorder` y
  `readingtruefalse`. Son los que se responden desde el celular y se califican solos; el resto
  califica en diferido. Una hoja sin ninguno devuelve **422** al abrir la sesión.
- **La lectura NO pasa por la subfase, el audio sí**, y la diferencia no es de comodidad: el audio
  es **efímero** —no se puede volver a oír mientras el reloj corre, de ahí la pausa— y el texto se
  queda en pantalla, así que se lee mientras se responde. `readingtruefalse` manda su `content` en
  `question.passage`, con **cada** enunciado: el alumno responde el tercero varios minutos después
  de que se proyectara el primero. Mismo trato que los textos de un `block {}`.
- **Subfase `listening`** (ADR-33). Una pregunta con audio nace ahí: se proyecta y suena, pero los
  botones del alumno están **cerrados** y el cronómetro **no ha arrancado**. Lo cierra el profesor
  con `POST /live/{code}/answers`, y ahí empieza a contar. Sin esa subfase, el bono de rapidez de
  `_points` premia a quien toca un botón antes de oír: 500 puntos por adivinar a ciegas, y el que
  escucha la pregunta entera pierde por escucharla. Las preguntas **sin** audio no pasan por aquí.
- **El audio suena SOLO en la pantalla proyectada, y su texto no viaja nunca.** `public_state()`
  manda `has_audio: bool` y nada más; el mp3 se pide a `GET /live/{code}/audio?k={screen_key}`.
  La llave se genera al crear la sesión y viaja **solo en `host_state()`** (detrás del JWT); el
  panel la mete en la URL de proyección. Es necesario porque el alumno y la pantalla polean el
  MISMO endpoint público: sin una llave aparte, cualquier forma de mandar el audio a la pantalla
  se lo manda también al celular, y `audio_text` es la transcripción literal — la regla 41 rota
  por otra puerta. Lo cubre un test. Reproducir en 50 celulares además no serviría: van
  desfasados y son 50 peticiones a `/tts` por pregunta desde la IP del salón (429 asegurado).
- **El audio del `block {}` se hereda.** Una `multiplechoice` normal colgada de un bloque con
  `audio_text` es, en vivo, una pregunta de escucha. Los bloques de **conversación** (`lines`, dos
  voces) siguen descartándose y reportándose: sintetizarlos es concatenar un mp3 por turno.
- **`listeningorder`** usa `input: "order"` (fichas que se tocan en orden). Compara con `==` y no
  con `>=`: ahí sobrar una ficha **sí** es un error, al revés que en los huecos, donde lo que
  sobra es un campo vacío del cliente.
- **`fillblank` y `dragdrop` comparten mecánica** (`input: "blanks"`) y solo cambia de dónde sale
  la palabra: con `options` (el `bank`) se tocan **fichas**, sin ellas se **teclea**. Nada de
  arrastrar — en pantalla chica y contra reloj, tocar hace lo mismo sin frustrar. La respuesta es
  una lista **POSICIONAL**, un elemento por hueco, comparada como en `_build_answer_details`
  (`strip`+`lower`, y `len(dado) >= len(clave)`). Un `dragdrop` de **un** hueco con banco no usa
  esta mecánica: es un `multiplechoice` disfrazado y se juega con los botones de siempre.
  **Ojo:** `multi` y `blanks` llegan las dos con lista y se comparan al revés (conjunto vs.
  posición), por eso `is_correct` ramifica por `input` y no por `type`.
- **La clave de un hueco puede venir como cadena** (`answer: "May"`) o como lista. `_answer_list`
  la normaliza: recorrer la cadena la partía en LETRAS y la sesión pedía `"M"`, marcando mal a
  quien escribía la palabra entera. Igual en `listeningorder`, donde una cadena parecía N fichas.
- **Tope de `MAX_LIVE_BLANKS` (3) huecos** y hace falta al menos uno: el hueco es lo que se pinta
  como campo, así que un `fillblank` sin `_____` (que el parser sí admite) no es jugable.
- **`activity_questions()` es la única autoridad** sobre qué entra. `extract_questions` la recorre y
  `summarize` la usa para contar lo descartado, así que las dos respuestas no pueden contradecirse.
  Antes eran dos criterios distintos y una actividad de tipo jugable que no diera ninguna pregunta
  (sin clave, con demasiadas opciones) desaparecía sin contarse ni como jugada ni como descartada.
- **Una actividad no es siempre una pregunta.** Un `truefalse` de cinco enunciados son **cinco**
  preguntas y un `matching` de cuatro filas son **cuatro**, numeradas `{activity_id}:{índice}` — la
  misma convención que usa `_build_answer_details` para esos tipos, de modo que lo que guarda
  `finish` encaja con lo que Revisión ya sabe leer.
- **`matching` e `imagematching` se juegan como opción múltiple por fila**, no como un tablero que
  se arrastra: enunciado = `left[i]`, opciones = todas las `right`, clave = `right[i]`. La unidad de
  calificación ya era esa en `_build_answer_details`; en vivo son los mismos botones (ADR-32). Las
  opciones se **barajan de forma determinista** por `activity.id`: sin barajar, la clave de la fila
  `i` cae siempre en el botón `i` y el juego se resuelve sin leer.
- **En vivo las opciones NO se barajan** (salvo `matching`/`imagematching`, que barajan por
  `activity.id`): salen en el orden en que las escribió el profesor o la IA. Por eso quien redacta
  la hoja debe **repartir la respuesta correcta entre las posiciones**; diez preguntas con la clave
  en la primera opción se juegan sin leer.
- **Tope de `MAX_LIVE_OPTIONS` (6) opciones por pregunta.** `OPTION_COLORS` cicla cada cuatro: con
  siete hay dos azules y el color deja de identificar desde el fondo del salón. Lo que pasa del tope
  se descarta **entero** y se reporta — recortar perdería la clave la mitad de las veces.
- **`question.input` es la MECÁNICA de respuesta** (`choice` / `multi`), separada de `question.type`.
  El cliente pinta mirando `input`; `type` se queda para la etiqueta y el color. Con 21 tipos,
  ramificar por tipo son 21 ramas repartidas en tres archivos y la certeza de que alguna se olvida.
- **`question.scored` distingue la encuesta.** Solo `poll` llega con `false`: no da puntos, no rompe
  la racha, no marca ✓/✗ y no entra a `snapshot()` (Revisión). En `reveal` llega `option_counts`
  pero **no** `answer` ni `answer_label` — no hay respuesta correcta que anunciar. Es un booleano y
  no otro `input` porque la mecánica de respuesta es la de siempre; lo que cambia es la calificación.
- **El estímulo del `block {}` llega a la pregunta** (`question.passage`). `iter_activities()`
  aplana los bloques y tira el `BlockData`, así que hasta agosto de 2026 una hoja con una lectura
  arriba y preguntas debajo (ADR-24) mandaba al alumno las preguntas **sin el texto del que
  hablan** — bien formadas, pero sobre la nada. `create_live_session` pasa ahora `content.blocks`
  aparte. Las actividades que cuelgan de un bloque con **audio** se descartan y se reportan: una
  pregunta sobre un audio que nadie ha oído no es jugable, y servirla muda es fallar en silencio.
- **Lo descartado se reporta, no se pierde.** `live.summarize()` cuenta por tipo lo que la hoja tiene
  y en vivo no se puede jugar, y viaja en `host_state().skipped` para que el panel lo enseñe. Sin eso,
  una hoja de diez actividades abriría una sesión de tres preguntas sin explicar por qué. **El conteo
  está duplicado en `liveBreakdown()` (`LiveHostPanel.tsx`)** para no pedir una petición por hoja con
  cincuenta en la lista; un test compara los dos y falla si se separan.
- **La clave nunca viaja mientras la pregunta está abierta.** `public_state` añade `answer` y
  `option_counts` **solo** en fase `reveal`. Es el mismo criterio de la regla 13 y lo cubre un test.
- **El cronómetro lo calcula el servidor** (`remaining_ms`): el celular solo lo pinta, así que cambiar
  la hora del teléfono no lo adelanta. Al llegar a cero la fase pasa sola a `reveal`, y también en
  cuanto **todos** los participantes han respondido (como Kahoot, sin esperar el resto del tiempo); **lanzar** la
  siguiente pregunta siempre es una acción explícita del profesor.
- **Ninguno pasa por `_rate_limit`**, a propósito: el límite es por IP y un salón entero comparte la
  del WiFi. Ver la regla 17 en [12_RULES](12_RULES.md#backend).
- Identidad por `pid` (token opaco). Reentrar con el **mismo primer campo** (el carné) devuelve el
  mismo participante con sus puntos: recargar la página no cuesta el marcador.
- `finish` escribe una fila en `worksheet_responses` por alumno que haya respondido algo, con
  `guest_token = live:{code}:{pid}` y los `info {}` en `_info_N`. Aparecen en **Revisión** como
  cualquier otra entrega. Es lo único que sobrevive al reinicio del proceso.
- **El puntaje son DOS mitades y viajan separadas.** `_points()` devuelve `(500 por acertar, hasta
  500 por rapidez)`; `me.last_base` / `me.last_speed_bonus` las mandan al alumno **junto con el
  ✓/✗** (antes delataría si acertó) y `roster[].avg_speed` da al profesor los segundos promedio por
  acierto. Sin ese desglose, un marcador donde el segundo tiene más correctas que el primero no se
  puede explicar: es exactamente la pregunta que hace el salón al ver el podio (ADR-30).
- **Menciones al terminar** (`awards`, fase `ended` y siempre en `host_state`): *La mente maestra*
  (más aciertos **y** más rápido), *El mentalista*, *El más veloz del Oeste*, *El imparable*,
  *El francotirador*, *El incansable*. Cada alumno se lleva **una** como mucho — repartir las
  cuatro entre el mismo primer lugar deja al resto del salón sin nada. Solo cuentan los aciertos
  para la velocidad: contestar rapidísimo y mal no es ser rápido.
- **Avatar y reacciones son listas CERRADAS** (`AVATARS`, 20; `REACTIONS`, 5), duplicadas en
  `src/pages/LivePage.tsx` y comprobadas por un test. Lo que se elija ahí acaba proyectado en la
  pared del salón, así que el backend no acepta cualquier cadena que llegue en el JSON. Las
  reacciones no son un chat, a propósito: con cinco caras no hay nada que moderar. Llevan cooldown
  de 1,5 s por alumno, viven 6 s y **no** suben `version` (son decoración, no un evento de sesión).
- **El avatar se congela al arrancar.** `set_avatar` solo funciona en `lobby` o `ended`: cambiar de
  cara a mitad de pregunta distrae al salón y hace irreconocible el marcador entre una y otra.
- `lobby_roster` (solo en fase `lobby`) lleva **nombre y avatar y nada más**, cortado en 60. Sale
  por un endpoint sin JWT: el carné no tiene por qué viajar ahí. Lo cubre un test.
- `GET /live/history` **no** lee la memoria: reagrupa las entregas que dejó `finish` por el código
  del `guest_token`. Por eso una sesión en curso no aparece y el historial sobrevive a un redeploy,
  al revés que `GET /live/sessions` (ADR-31).
- **La nota se calcula sobre las preguntas LANZADAS, no sobre las respondidas** (ADR-28). Una
  pregunta sin responder cuenta como incorrecta, con el motivo en `teacher_comment` — se ve en
  Revisión con 💬: *"No respondió a tiempo."* si ya estaba dentro cuando se lanzó, *"Pregunta
  omitida: se conectó después de que se lanzara esta pregunta."* si entró después. Una pregunta que
  la sesión nunca llegó a lanzar no cuenta para nadie.

## Público / invitado (sin JWT)

```
GET    /public/classrooms                     — Aulas públicas (selector de invitado)
GET    /public/classrooms/{id}/worksheets     — Hojas del aula (invitado)
GET    /public/worksheets                     — Hojas publicadas
GET    /public/worksheets/{id}                — Hoja publicada por id (enlace directo /w/:id)
POST   /public/guest-sessions                 — Registrar acceso de invitado
POST   /public/responses                      — Enviar respuestas como invitado
GET    /public/responses?guest_token=…        — Respuestas calificadas del invitado
POST   /public/transcribe                     — Audio (speaking) → texto vía Groq Whisper (máx 4 MB)
GET    /public/vocabulary/{id}                — Lista de vocabulario por id (enlace /v/:vocabId)
GET    /public/readers-vocabulary             — Vocabulario público (/vocab)
```

- Identifican al invitado por `guest_token`. En el modo `/guest` es determinístico (aula + nombre);
  en el enlace directo `/w/:id` cada envío usa uno **nuevo**, para que cada entrega sea independiente.
- El límite de intentos del enlace directo es **por dispositivo** (`dw_count_{id}` en `localStorage`),
  coherente con el modelo suave de invitado: no hay identidad server-side.
- **Todo lo que necesite funcionar sin login va en `/public/*`.**
- `/public/transcribe` es el único público que cuesta **dinero** (cuota de Groq): 4 MB por petición
  y **60 por minuto y por IP** → **429**. Ver [09_SECURITY](09_SECURITY.md#topes-en-los-endpoints-públicos).

> ⚠️ Los cuatro endpoints que entregan una hoja al alumno (`/public/worksheets`,
> `/public/worksheets/{id}`, `/public/classrooms/{id}/worksheets`, `/students/{id}/worksheets`)
> devuelven `json_content` **completo**, con la clave de respuestas. Es el pendiente mayor: ver el
> [plan por fases](plans/PLAN-fuga-de-respuestas.md). Los endpoints del profesor **sí** deben seguir
> devolviendo todo (vista previa, modo práctica, impresión y editor lo necesitan).

> Esos **mismos cuatro endpoints** sí filtran ya el campo privado `note` (ADR-19): `_without_notes`
> lo borra del `json_content` y del `script_content` antes de responder. En
> `/students/{id}/worksheets` el filtro se aplica **solo si quien pregunta tiene rol `student`** —
> el profesor consulta ese listado para editar y necesita sus notas. Cuando se implemente la fase 1
> del plan de fuga de respuestas, el saneado de la clave debe pasar por el mismo sitio.
