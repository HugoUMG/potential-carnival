# 15 — Decisiones de arquitectura (ADR)

Por qué el proyecto es como es. Sirve para que quien proponga un cambio —persona o agente— sepa qué
se descartó ya y con qué motivo.

> **🟢** decisión tomada a propósito, con su motivo confirmado.
> **🟠** el estado actual **no** se decidió: se heredó o creció por acumulación. Igual de vinculante
> para no romperlo, pero no hay que defenderlo como si fuera doctrina.

---

## 🟠 ADR-01 — Python + FastAPI en el backend, React + Vite en el frontend

**El stack no se eligió: vino con el prototipo.** La idea era una plataforma para crear hojas de
trabajo con puro código. El primer prototipo lo generó **Codex** el 2026-05-29 (rama
`codex/develop-ai-worksheet-builder-web-application`), y Python + FastAPI + React + Vite fue **su**
decisión, no una comparativa del autor. A partir de ahí el proyecto creció con Claude sobre esa base.

> Los commits del 2026-05-23 (bot de Dialogflow) son residuo de un proyecto anterior sin relación que
> vivía en el mismo repositorio. No significan nada para esta arquitectura.

**Qué lo sostiene hoy** — a posteriori, pero real, y es lo que haría caro cambiarlo:

- **`edge-tts` es una librería de Python** y de ahí sale *todo* el audio de la plataforma (los seis
  tipos `listening*` y `conversation`). Migrar el backend a otro lenguaje significaría perder el TTS
  o mantener un servicio de Python solo para eso.
- **Pydantic se está usando de verdad**: cada una de las ~83 rutas declara `response_model` y
  `models.py` **es** el contrato de la API.
- **React se gana su sitio en `activityRegistry.tsx`**: 19 componentes con estado interactivo real
  (arrastrar fichas, unir columnas con líneas de colores, grabar audio y pintar palabra por palabra
  el resultado). Eso no es una plantilla que se pueda renderizar en el servidor.

**Lo que NO es argumento.** Que el parser del DSL esté en Python: son 554 líneas de `re` sin
dependencias, que se escribirían igual en cualquier lenguaje.

**Consecuencias.** Dos entornos de ejecución (pip + npm) y dos comandos de arranque en local.

**Cómo tratarlo.** No hay una comparativa previa que respetar, así que una propuesta de cambio no
choca contra una decisión — choca contra los tres puntos de arriba. Si alguno deja de ser cierto, la
conversación se puede volver a abrir.

---

## 🟢 ADR-02 — Un DSL propio en vez de un editor de formularios o JSON

**Decisión.** El profesor escribe la hoja en un lenguaje de texto propio; el parser lo convierte a
JSON.

**Motivo.** El DSL es a la vez el formato de autoría **y** el formato que una IA puede generar. Un
prompt bien escrito produce una hoja completa en un solo mensaje — algo que ni un formulario ni un
JSON con llaves y comillas permiten con la misma fiabilidad. Además el profesor puede pegar el prompt
en cualquier IA externa (`GENERATION_PROMPT`) y traer el resultado.

**Consecuencias.** Hay que mantener el parser, sus validaciones y **tres** sitios que enseñan la
sintaxis. A cambio existe también un constructor visual que serializa al mismo DSL
(`dslSerializer.ts`), así que quien no quiera escribir texto no tiene que hacerlo.

---

## 🟢 ADR-03 — La calificación ocurre en el servidor, leyendo la clave de la base

**Decisión.** `_build_answer_details` relee `worksheets.json_content` desde la base; nunca usa lo que
manda el cliente.

**Motivo.** Es lo que hace posible arreglar la fuga de la clave de respuestas sin tocar la corrección
(ver [el plan](plans/PLAN-fuga-de-respuestas.md)): se puede quitar `answer` del payload que recibe el
alumno y todo sigue calificando igual.

---

## 🟢 ADR-04 — Migraciones idempotentes en el arranque, sin Alembic

**Decisión.** El schema **es** la migración: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN
IF NOT EXISTS`. `initialize_database()` lo aplica en cada arranque.

**Motivo.** Un solo entorno de producción y un solo desarrollador: la maquinaria de versiones de
Alembic costaría más de lo que resuelve. Y hay una ventaja que se aprovechó de verdad: el backfill de
`users.created_by` corre **en el mismo arranque que crea la columna**, así que no existe una ventana
entre desplegar y acordarse de ejecutar un script.

**Consecuencias.** No hay rollback automático y no se puede renombrar ni borrar una columna. De ahí la
regla de nunca hacer `DROP`.

---

## 🟢 ADR-05 — Registro solo con Google

**Decisión.** La única alta pública es `POST /auth/google`. `POST /auth/register` se **eliminó**, no
se escondió.

**Motivo.** No hay forma de comprobar que un correo escrito a mano sea de quien se registra; Google
entrega el correo ya verificado. Y esconder el botón dejando la ruta abierta no habría cambiado nada.

**Alternativa descartada.** Verificación por correo propia: implica servidor de correo, plantillas y
tokens de un solo uso para el mismo resultado que ya da Google.

**Consecuencias.** Se usa el flujo de **ID token**, no el de código de autorización, así que el
`client_secret` no vive en ningún sitio de la app. Sin `GOOGLE_CLIENT_ID` el endpoint responde **503 a
propósito**: sin `aud` que comparar, un ID token de cualquier otra app de Google abriría cuentas aquí.

---

## 🟢 ADR-06 — Aislamiento total entre profesores, sin excepción para `created_by IS NULL`

**Decisión.** Un alumno sin dueño no lo ve ni lo administra ningún profesor; solo el admin.

**Motivo.** Existió la excepción contraria (los alumnos anteriores a la columna eran visibles para
todos, para no esconderle a nadie los suyos al desplegar). Con el registro por Google abierto se
convirtió en un agujero: cualquier desconocido que se registrara los veía y podía borrarlos. Se cerró
moviendo el backfill a la migración de arranque.

**Consecuencia.** Falla en cerrado: si algo queda huérfano, desaparece de la vista en vez de quedar
expuesto.

---

## 🟢 ADR-07 — El enlace directo es el flujo prioritario, el modo invitado quedó oculto

**Decisión.** `/w/:worksheetId` es la forma de compartir una hoja. Las entradas a `/guest`
desaparecieron del sitio, del inicio y del login; la ruta sigue existiendo.

**Motivo.** El alumno no necesita cuenta, ni elegir aula, ni escribir su nombre en un formulario
aparte: el nombre lo captura el `info {}` de la propia hoja. Es un clic.

**Consecuencias.** La identidad es **suave**: el límite de intentos es por dispositivo
(`dw_count_{id}` en `localStorage`, estilo liveworksheets) y quien tenga el enlace puede resolver la
hoja (URL-capability sobre un UUID no adivinable). Es el modelo que se quiso, no un descuido. Para
reactivar el modo invitado basta con volver a poner un enlace a `/guest` en el login.

---

## 🟢 ADR-08 — La IA solo puede rescatar, nunca empeorar

**Decisión.** La IA puede convertir `incorrect` → `correct` únicamente en `_AI_RESCUABLE`, y **nunca**
puede marcar como incorrecto algo que el corrector automático dio por bueno.

**Motivo.** El corrector exacto es la verdad en todo lo que se elige de una lista cerrada. Donde el
alumno **escribe** la respuesta, la comparación exacta falla con aciertos legítimos (sinónimos,
respuestas cortas, dedazos) — ahí es donde el modelo aporta. `matching` se añadió después porque su
clave por índice **no es la única combinación válida**.

**Consecuencia.** Un fallo del proveedor de IA nunca perjudica al alumno:
`ai_grade_activities` devuelve los detalles sin tocar y queda la calificación automática.

---

## 🟢 ADR-09 — La tolerancia de la IA son tres bloques de reglas, no un número

**Decisión.** `_grade_system(tolerance)` elige entre `_TOLERANCE_STRICT`, `_TOLERANCE_BALANCED` y
`_TOLERANCE_LOOSE`.

**Motivo.** Pasarle "tolerancia: 70/100" al modelo funcionaba mal. Una lista de casos concretos
("perdona la puntuación final y un dedazo; marca error si cambia el tiempo verbal") se obedece mucho
mejor que una escala abstracta.

---

## 🟢 ADR-10 — Modo oscuro por CSS puro, sin tocar el JSX

**Decisión.** El tema vive en el atributo `data-theme` del `<html>`; el modo oscuro es un bloque de
`app.css` que repinta las mismas clases de Tailwind que ya usan las pantallas.

**Motivo.** Ningún componente sabe que existe un tema. No hay props `theme`, ni contexto, ni
duplicación de clases en cada JSX. Para adaptar una pantalla nueva se añade una línea a ese bloque.

**Consecuencias.** Va dentro de `@media screen` (al imprimir el papel siempre es blanco), y las
variantes con opacidad necesitan su propio selector `[class*='bg-rex-light\/']` porque Tailwind genera
una clase por porcentaje.

---

## 🟢 ADR-11 — Las secciones del portal son rutas, no estado

**Decisión.** La pestaña activa se deriva de `useParams`, no de `useState`.

**Motivo.** Se comparte por URL, se marca en favoritos y el botón "atrás" del navegador funciona.

---

## 🟠 ADR-12 — Un solo `main.py`: no se decidió el monolito, se acumularon dos fases

**Nadie decidió "esto va en un archivo".** El backend creció por fases, y cada una añadió sus rutas al
final del mismo módulo:

1. **Alumnos registrados y aulas** — la intención original: crear usuario, login, asignar hojas a un
   aula. De ahí salen `/students`, `/classrooms` y `POST /responses`.
2. **Invitados** — vino después, como área aparte, y **esa sí fue una división consciente**: un
   alumno sin cuenta necesita endpoints sin JWT. De ahí todo `/public/*`, incluido
   `POST /public/responses`.
3. **Enlace directo `/w/:id`** — encima de la fase 2, reusando `/public/responses`.

El resultado es que **la división entre alumno registrado e invitado sí existe conceptualmente, pero
está entreverada en un solo archivo** en vez de reflejada en la estructura. Hoy, además, ni las aulas
ni los alumnos registrados son el flujo vivo en producción (lo es el enlace directo, ver ADR-07), así
que la mitad más antigua del archivo es la menos usada.

**Las costuras reales, medidas** (`backend/app/main.py`, 1297 líneas, 83 rutas):

- `require_teacher_or_admin` aparece **53 veces** y `get_current_user` **16**. Partir en routers
  obliga a sacar las cuatro dependencias de rol y las cuatro de propiedad a un `deps.py`. Es barato.
- **Estado de módulo compartido entre las dos fases:** `_response_locks` (`main.py:59`) lo escriben
  `POST /responses` (701–707) y `POST /public/responses` (890–895) — endpoints que caerían en routers
  distintos. Al sacarlo se hace visible algo que hoy queda disimulado: **ese candado anti-doble-envío
  es por proceso**; con más de un worker de uvicorn no protege nada. Los invitados sí están cubiertos
  por el índice único de BD; los alumnos registrados no (ese índice se eliminó porque rompía
  `max_attempts`).
- **La calificación la comparten cuatro endpoints de tres "dominios"**: `POST /responses` (709),
  `POST /worksheets/{id}/practice` (734), `POST /responses/{id}/review` (769) y
  `POST /public/responses` (897).
- **El orden de declaración importa**: `/worksheets/ai-generate` (471), `/worksheets/response-counts`
  (503) y `/worksheets/classroom-assignments` (509) están **antes** de `/worksheets/{worksheet_id}`
  (621). Si se invirtiera, `GET /worksheets/response-counts` entraría por la ruta con parámetro y
  devolvería 404. Hoy eso se ve leyendo el archivo de arriba abajo; repartido en routers pasaría a
  depender del orden de los `include_router()` — la misma trampa, pero **invisible** y sin ningún test
  que la cubra.

**Por qué no se ha partido.** Un solo desarrollador, un archivo que cabe en un `grep`, y una
partición por dominio HTTP que crearía una clase nueva de bug silencioso (el punto del orden) a cambio
de estética.

**La frontera que sí está trazada y sí importa es la otra: `main.py` no escribe SQL.** Todo va a
`repository.py`, en las 83 rutas.

**Si algún día se parte, el primer corte no es por dominio.** Es sacar **`grading.py`**:
`_build_answer_details`, `_score_details`, `_norm_answer`, `_speaking_match` y
`_resolve_correct_answers` (~250 líneas, `main.py:1081–1324`). Es un bloque cohesionado, **sin
dependencias de FastAPI**, usado por cuatro endpoints, y contiene la lógica de los 19 tipos — hoy lo
más difícil de encontrar en el archivo. Se puede hacer sin tocar una sola ruta ni el orden de
registro. Partir por dominio HTTP (auth / worksheets / classrooms / responses / vocabulary / public)
es el paso siguiente, y solo si entra más gente a tocar el backend a la vez.

---

## 🟢 ADR-13 — Sin dependencias para lo que se resuelve en unas líneas

**Decisión.** `.env` se lee con un parser de seis líneas en vez de `python-dotenv`; el ID token de
Google se valida con `httpx` contra el endpoint `tokeninfo` en vez de con la librería de Google.

**Motivo.** Menos superficie que mantener y actualizar, para funcionalidad que cabe en una función.
Los comentarios `ponytail:` del código marcan estas simplificaciones **y su límite**: el de
`settings.py` dice explícitamente que si algún día hacen falta valores multilínea, entonces sí toca
`python-dotenv`.

**Consecuencias.** El parser de `.env` tuvo que aprender un caso raro real (una línea añadida en
UTF-16 por PowerShell 5.1 sobre un archivo UTF-8), que ahora tiene su test.

---

## 🟢 ADR-14 — TTS en vez de archivos de audio

**Decisión.** Todos los `listening*` y `conversation` sintetizan la voz con `edge-tts` en el momento.
No existe un campo `audio:`.

**Motivo.** El profesor no tiene que grabar nada ni subir archivos, y el texto oculto se puede editar
como cualquier otro campo. `conversation` concatena los turnos con voz masculina y femenina en un solo
MP3.

**Consecuencias.** (a) La URL del TTS lleva el texto en claro y **filtra la respuesta**: es la fase 2
del [plan](plans/PLAN-fuga-de-respuestas.md). (b) La concatenación de MP3 es cruda: para una pausa
marcada entre turnos habría que intercalar un MP3 de silencio. (c) Las actividades con audio **no
pasan a papel**: `WorksheetPrint` las omite.

---

## 🟢 ADR-15 — Dos motores de base de datos (SQLite en desarrollo, PostgreSQL en producción)

**Decisión.** El backend elige según exista `DATABASE_URL`.

**Motivo.** Desarrollar sin levantar nada: `python scripts/init_db.py` y ya hay base.

**Consecuencias.** Los dos schemas deben mantenerse en paralelo — y se pagó no hacerlo (las tablas de
vocabulario solo estaban en el de Postgres y `/vocabulary` reventaba en local). Además hay que
normalizar diferencias de tipos: JSONB vs TEXT, BOOLEAN vs INTEGER, fechas.

---

## 🟢 ADR-16 — La base en Aiven, con el servicio de Render despierto

**Decisión.** La base se migró de Render a Aiven y un monitor de UptimeRobot mantiene despierto el
backend.

**Consecuencia que cambia cómo se optimiza.** El servicio **no** tiene cold start: la lentitud
percibida es la **latencia de la base**. Por eso las mejoras que se hicieron son de carga de BD (pool
de conexiones, quitar N+1) y por eso toda pantalla que dependa de la primera consulta muestra spinner.
Optimizar el arranque del servicio no aporta nada.

---

## 🟢 ADR-17 — El parser valida y rechaza, en vez de guardar en silencio

**Decisión.** `_activity_problem` lanza `WorksheetScriptError` con el número de actividad y el motivo
cuando la actividad quedaría imposible de responder.

**Motivo.** Antes todos esos casos se guardaban sin error y **el alumno** se encontraba la pregunta
rota. Es mejor que falle el profesor al guardar que el alumno al resolver.

**Consecuencia.** Un tipo nuevo **necesita** su regla ahí, o vuelve el fallo silencioso.

---

## 🟢 ADR-18 — La tarjeta plegada del constructor usa el renderer del alumno

**Decisión.** En el constructor visual, la actividad plegada se pinta con el componente de
`activityRegistry` (`readonly` + `pointer-events-none`) traduciendo el estado con
`toWorksheetActivity`. Lo que el profesor ve plegado **es** lo que verá el alumno.

**Motivo.** El formato de Google Forms: diseñar y previsualizar no son dos pantallas. Una imitación
"parecida" se desincroniza en cuanto cambia un renderer, y el profesor descubre la diferencia cuando
ya la ha mandado a clase.

**Alternativa descartada.** Un endpoint `POST /worksheets/parse` que devolviera el JSON real para
pintarlo: una sola fuente de verdad y sin mapeo nuevo en TypeScript, pero mete una llamada de red
(con su debounce) en cada tecla del constructor. Se prefirió el mapeo local por latencia cero.

**Consecuencia.** `toWorksheetActivity` es un tercer sitio que recorrer al añadir un campo, junto a
`serializeActivity` y `worksheetToVisualState`. Si falta un tipo entero, `tsc` lo caza por el `switch`
exhaustivo; **si falta un campo, no lo caza nadie**: la tarjeta miente en silencio.

---

## 🟢 ADR-19 — Campo privado `note` por actividad (solo calificación con IA)

**Decisión.** Las actividades ganan un campo opcional `note` (texto libre) que el profesor escribe y
que **solo consume la IA al calificar**; el alumno nunca lo ve (ni en pantalla ni en papel). Forma
parte de la solicitud #4 del paquete de cambios UX.

**Motivo.** Hay respuestas abiertas (imagen, textbox, speaking) donde el criterio de logro no se lee
del texto: el profesor puede escribir una pista privada (p. ej. "debe mencionar el color rojo") sin
que el alumno la vea.

**Alternativa descartada.** Compartir el campo con instrucciones públicas, o meterlo a nivel de hoja:
público filtra contenido y a nivel de hoja pierde granularidad. Se eligió por actividad y privado.

**Consecuencia (implementado, 2026-08-03).** Recorre la cadena completa de la regla 20 y los tres
sitios del DSL de la regla 21. Dos decisiones concretas que se tomaron al implementarlo:

- **La `note` NO viaja en los `AnswerDetail`.** Esos se le devuelven al alumno con la corrección, así
  que la nota llega a `ai_grade_activities` por un parámetro aparte (`notes = {activity_id: note}`,
  lo arma `_activity_notes` en `main.py`). Meterla en el detalle habría sido una línea menos y una
  fuga garantizada.
- **Se limpia también el `script_content`, no solo el `json_content`.** `_without_notes` borra la
  línea `note:` del script en los cuatro endpoints que entregan una hoja al alumno; en
  `/students/{id}/worksheets` solo cuando quien pregunta es un `student` (el profesor edita desde ese
  mismo listado). Si se limpiara solo el json, el texto seguiría viajando en el script.

No hay migración: es un campo dentro de `json_content`. Plan: `docs/plans/PLAN-cambio-4-campo-note.md`.

## 🟢 ADR-20 — Actividades con imagen: empezar por MC con imagen y matching imagen-texto

**Decisión.** La ampliación de actividades con imagen (solicitud #5) empieza con **dos** tipos:
opción múltiple con imagen y matching imagen-texto. El carácter visual queda en el DSL; **no hay un
"modo imagen" opuesto al renderer**.

**Motivo.** Cubren los dos casos más usados en clase con uno de opción cerrada y uno de arrastre, sin
ampliar el alcance a todo lo que se pueda imaginar de golpe.

**Alternativa descartada.** Una super-actividad genérica de imagen que absorbería todos los tipos.

**Nombres y forma (REVIEW resuelto, 2026-08-03): `imagechoice` e `imagematching`.** La regla que
salió del REVIEW y que hay que respetar al tocarlos: **la imagen es un campo paralelo, nunca el valor
de la clave.**

- `imagechoice`: `options` (texto = la clave) + `option_images` paralelo por índice, más un `image`
  opcional de enunciado. Se califica con la rama de `multiplechoice`, **sin una línea nueva**.
- `imagematching`: `left_images` + `right`, con `left` autogenerado (`Image 1`, `Image 2`…) si el
  profesor no lo escribe. Se califica con la rama de `matching` y entra en `_AI_RESCUABLE` por
  herencia (su clave por índice tampoco es la única combinación válida).

Poner las URLs dentro de `options`/`left` habría costado menos código y habría llenado de URLs de 90
caracteres la pantalla de revisión del profesor y el resumen de la IA. Cuando una opción o una fila
tiene imagen se muestra **solo la imagen** (el texto va como `alt`): enseñar el texto resolvería el
ejercicio.

**Consecuencia.** Cada tipo recorre la cadena completa (reglas 17 y 20) y el DSL se sincroniza
(regla 21): son 21 tipos, no 19. El renderer de impresión los traduce a papel (ADR-21) reusando el
layout de `multiplechoice` y de `matching` con miniaturas. Ninguno tiene renderer propio. Diseño
completo con las alternativas descartadas: `docs/plans/PLAN-cambio-5-actividades-imagen.md`.

## 🟢 ADR-21 — El renderer de impresión traduce a papel, sin DSL de imagen

**Decisión.** La impresión no inventa un DSL paralelo ni modos visuales: `WorksheetPrint` ya omite
`speaking` y `listening*`; cada tipo que sí imprime se **traduce a papel** con lo que ya sabe. El modo
"físico" de la IA (solicitud #12) restringe la generación al conjunto imprimible existente.

**Motivo.** Reutilizar la fuente de verdad de impresión ya consolidada en vez de bifurcar el parser.

**Consecuencia (implementado, 2026-08-03).** La lista vive ahora como `PRINTABLE_TYPES` /
`NON_PRINTABLE_TYPES` en `parser.py` y es la misma que descarta `isPrintable()` en
`WorksheetPrint.tsx`; un test comprueba que entre las dos cubren `SUPPORTED_BLOCKS` sin solaparse.

El modo físico es **prompt + filtro**, no solo prompt: `_PRINTABLE_MODE` se lo pide al modelo y
`strip_non_printable` borra lo que haya colado igualmente. Solo con el prompt saldría, de vez en
cuando, una hoja para imprimir con un `listening` dentro — en papel, una actividad que el alumno no
puede resolver. El filtro trabaja sobre el **script** y no sobre el json, porque `script_content` es
lo que se vuelve a parsear en cada guardado: filtrar solo el json haría reaparecer el audio al primer
guardado. Plan: `docs/plans/PLAN-cambio-12-modo-fisico.md`.

## 🟢 ADR-22 — Evaluaciones guardadas en tarjetas con mini vista previa y edición aislada

**Decisión.** La sección «Evaluaciones guardadas» (solicitud #6) se muestra como tarjetas con mini
vista previa de la hoja y menú «⋮» (ver respuestas, copiar enlace, duplicar, archivar/borrar). Clic en
la tarjeta abre el editor de ESA hoja en pantalla aislada (solo la hoja, con botón de volver); no se
crea copia.

**Motivo.** El profesor entiende mejor de un vistazo la biblioteca de evaluaciones y edita cada hoja
sin el ruido del dashboard.

**Alternativa descartada.** Seguir en lista de filas; o una miniatura que reprodujera audio/interacción
(se descarta: carga cara y permite responder). La miniatura es estática y sin audio.

**Consecuencia (implementado, 2026-08-03).** El modo aislado es una **sub-vista de `crear`, no una
ruta nueva**: un booleano `isolatedEdit` en `App.tsx` que oculta `TeacherDashboard` y quita la columna
del menú. Se eligió así porque el editor ya vivía ahí con todo su estado (`editingWorksheetId`,
`activeWorksheet`, `scriptDraft`); una ruta nueva habría obligado a levantar ese estado o a duplicarlo,
y a tocar `TEACHER_SECTIONS` y `GROUPS` (regla 24) para una pantalla que no es una sección del portal.

La miniatura es `WorksheetThumb`, exportada desde `WorksheetRenderer.tsx`: el renderer del alumno en
`readonly` con `scale`, **filtrando** los tipos que montarían audio (`listening*`, `conversation`),
micrófono (`speaking`) o un iframe (`content` con `sandbox`). Sin ese filtro, nueve tarjetas en
pantalla dispararían decenas de peticiones al TTS por una imagen de 160 px. Plan:
`docs/plans/PLAN-cambio-6-tarjetas-evaluaciones.md`.

## 🟢 ADR-23 — Permisos por lista blanca de rol, y topes en los públicos sin dependencia nueva

**Decisión.** Tres cosas que salieron de la revisión de seguridad de agosto de 2026:

1. Una ruta que ramifica por rol **cierra con 403** para el rol no contemplado.
2. Los `/public/*` que cuestan CPU o dinero se acotan **por tamaño de petición y por peticiones/IP**,
   con un dict en memoria (`_rate_limit`), no con Redis ni `slowapi`.
3. La IP se lee de la entrada **más a la derecha** del `X-Forwarded-For`.

**Motivo.** (1) no es estilo: `PUT /users/{id}/password` ramificaba `if student … elif teacher …` y el
rol `reader` no entraba en ninguna, así que caía al `UPDATE` y podía fijar la contraseña del admin.
El fallo no fue una comprobación mal escrita sino una **ausente**, y una cadena sin cierre convierte
"rol nuevo" en "permiso total" sin que nadie lo escriba. Con el 403 al final, el fallo por defecto es
"no me deja".

**Alternativas descartadas.**

- *`slowapi` o Redis para el rate limit.* El backend corre con **un worker** (`render.yaml`) y esto
  solo tiene que frenar un script en bucle; una dependencia nueva y un servicio más no compran nada
  hoy. Cuando haya más de un worker o haga falta un límite exacto, el dict deja de servir — es el
  disparador para cambiarlo, no el número de usuarios.
- *Limitar por usuario en vez de por IP.* `/tts` se consume como `src` de un `<audio>`, que no manda
  cabeceras, y `/public/transcribe` sostiene el modo invitado, que existe **para no pedir cuenta**.
  No hay identidad que usar sin romper los dos casos de uso.
- *Solo el tope de tamaño, sin límite de peticiones.* Cubre `/tts` (edge-tts sintetiza el MP3 entero
  en RAM antes de responder, así que el tamaño es el coste), pero no `/public/transcribe`, donde cada
  llamada gasta cuota de Groq y el daño es el **volumen**. Por eso van los dos topes, no uno.
- *`request.client.host` para la IP.* Detrás del proxy de Render devuelve el proxy para todo el
  mundo: el límite habría metido a todos los usuarios en un solo cupo y roto un aula entera en vez de
  parar a nadie. Y la entrada **izquierda** del `X-Forwarded-For` la pone el cliente, así que tomarla
  dejaría saltarse el límite con una cabecera. La derecha la añade el proxy.
- *`--proxy-headers --forwarded-allow-ips=*` en uvicorn.* Habría dejado la IP en `request.client`,
  pero con `*` uvicorn confía en toda la cadena y vuelve a la entrada izquierda, falsificable. Tres
  líneas propias son más seguras que un flag que hay que razonar por versión de uvicorn.

**Consecuencia.** Los números (2000/8000 caracteres, 4 MB, 300/60 por minuto) van **holgados a
propósito**: un colegio entero tras un NAT comparte cupo. Están para frenar un bucle, no para medir
consumo legítimo. Los dos techos conocidos —por proceso y por IP— están escritos en el docstring de
`_rate_limit`, no solo aquí.

---

## 🟢 ADR-24 — Un audio o un texto para varias preguntas: el estímulo va en el `block {}`, no en la actividad

**Decisión.** Para hacer N preguntas sobre un mismo audio o un mismo texto, el estímulo (`lines`,
`audio_text` o `text`) se declara en el **bloque**, y las actividades de dentro —de **cualquier**
tipo— quedan como están. Ni un tipo de actividad nuevo, ni un array de preguntas dentro de los tipos
existentes.

**Motivo.** El contenedor ya existía: `block {}` agrupa actividades y el renderer ya lo pinta. Poner
el estímulo ahí no toca **nada** de la calificación —cada actividad se sigue calificando con el
código que ya tenía— y hace que funcione de golpe con los 21 tipos: opción múltiple, multiselect,
matching, dragdrop, verdadero/falso, fillblank, textbox… Lo único que hubo que añadir en el backend
fue pasarle a la IA el estímulo del bloque como `context` (`_block_contexts`).

**Alternativas descartadas.**

- *`questions: []` dentro de `conversation` y de cada `listening*`.* Era la petición literal, y es
  el camino largo: hay que recorrer el tipo entero (parser → domain → models → grading → types.ts →
  api.ts → renderer → serializador visual → docs) **por cada tipo**, y al final cada uno solo sabría
  hacer sus propias preguntas — `conversation` daría preguntas abiertas, `listeningtruefalse` daría
  verdadero/falso, y mezclar tipos de pregunta sobre un mismo audio seguiría sin poder hacerse.
- *Un tipo nuevo `audioblock` / `readingblock` con actividades anidadas.* Es el `block {}` otra vez,
  con otro nombre y con un renderer y una calificación que habría que escribir de cero.
- *Repetir el mismo `lines:` en varias `conversation`.* Es lo que había. Funciona, pero regenera el
  MP3 una vez por pregunta y el alumno oye el mismo diálogo tantas veces como preguntas haya.

**Consecuencia.** Los campos del bloque se leen **solo hasta su primera actividad**
(`_block_header`). Sin ese recorte, `_get_scalar` encontraba el `audio_text:` de un
`listeningfillblank` hijo y le montaba al bloque un reproductor que nadie pidió — y de paso arregla
el mismo robo, que ya existía en silencio, con el `title:` de un `reading {}`. En papel, un bloque
con audio se omite **entero**: sus actividades son de tipos imprimibles, pero preguntan sobre algo
que en una hoja no suena.

---

## 🟢 ADR-25 — La sesión en vivo va con polling y estado en memoria, no con WebSockets ni tabla

**Decisión.** La evaluación en tiempo real (`/live/*`) mantiene cada sesión en un **dict de módulo**
(`backend/app/live.py`) y los clientes la consultan con un **poll de 1 segundo**. No hay tabla, ni
Redis, ni WebSockets.

**Motivo.** El caso real es un salón: ~50 personas, una hora, una sesión a la vez. Con ese tamaño,
1 segundo de latencia no se distingue de "instantáneo" en un juego de preguntas, y el poll cuesta una
lectura de diccionario — menos que el `SELECT` que costaría una tabla. WebSockets, en cambio, es
infraestructura nueva entera: servidor con soporte, gestión de conexiones y desconexiones,
reconexión cuando un alumno pierde la señal, y verificar que el plan de Render aguante conexiones
persistentes. Es la pieza más cara del diseño para el problema menos urgente.

**Alternativas descartadas.**

- *WebSockets desde el principio.* Elimina el retraso y el tráfico ocioso, pero es la infraestructura
  que el proyecto no tiene. Sigue siendo el salto correcto **si** la latencia llega a molestarse o si
  las sesiones pasan de unos cientos de participantes.
- *Long-polling.* Da push casi real sin WebSockets, pero deja 50 peticiones abiertas a la vez contra
  un solo worker y se pelea con los tiempos de espera del proxy de Render. Más piezas móviles que el
  poll, para ganar menos de un segundo.
- *Guardar cada respuesta en la base según llega.* Son 50 escrituras a Aiven por pregunta para
  alimentar un marcador que se descarta al terminar. `finish` escribe una vez por alumno al final,
  que es cuando el dato deja de ser efímero y pasa a ser una nota.

**Consecuencias.** Tres techos, y hay que conocerlos antes de una clase:

1. **Un reinicio del proceso borra las sesiones vivas.** Un redeploy a media actividad la mata. Por eso
   `finish` persiste en `worksheet_responses`: lo que se pierde es la sesión en curso, no las notas.
2. **Obliga a un solo worker.** Con `--workers` en `render.yaml`, cada proceso tendría su propio dict
   y los alumnos verían sesiones distintas. Eso ya valía para `_rate_limit` y `_response_locks`; aquí
   deja de ser un detalle y pasa a ser la regla 39.
3. **Los endpoints `/live/*` no pueden pasar por `_rate_limit`** (regla 40): es por IP y un salón
   entero comparte la del WiFi.

## 🟢 ADR-26 — `live.py` no importa `main.py`, aunque eso duplique seis líneas de calificación

**Decisión.** `live.py` es lógica pura: no importa `main`, ni `repository`, ni `database`. Como
consecuencia lleva su propio `LiveQuestion.is_correct()`, seis líneas que repiten el criterio de
`_build_answer_details` para los tipos jugables.

**Motivo.** Importar `backend.app` carga el `.env` real (regla 35): un test que importe `main` puede
acabar escribiendo en Aiven. Manteniendo `live.py` limpio, `test_live_session.py` corre sin abrir una
sola conexión, y de paso se evita el import circular (`main` importa `live` para montar los
endpoints, no al revés).

**Alternativas descartadas.**

- *Importar `_build_answer_details` desde `main`.* Es la reutilización obvia y la que pide la regla de
  no duplicar. Arrastra el `.env` de producción a la ruta caliente y al test — precio demasiado alto
  por seis líneas.
- *Mover el calificador a un módulo compartido.* Correcto a futuro, pero `_build_answer_details`
  depende de `AnswerDetail`, del `WorksheetJson` completo y de los contextos de bloque: sacarlo es una
  refactorización de `main.py`, no un movimiento de archivo. Si un tercer sitio llega a necesitarlo,
  ahí sí toca.

**Consecuencia.** Si cambia el criterio de acierto de esos tipos, hay que tocar **los dos sitios**. El
test cubre los casos que se desincronizarían primero (comparación de texto sin distinguir mayúsculas
en MC, conjunto exacto en multiselect), así que el descuadre sale en rojo y no en el salón.

La duplicación se pagó una sola vez y se aprovecha: `truefalse` entra convertido a las opciones
`"True"`/`"False"` —las mismas cadenas que guarda el renderer de la hoja— así que cae en la
comparación de texto que ya existía, sin una rama de calificación nueva. Lo mismo `imagechoice`, que
por ADR-20 se califica por el TEXTO de la opción y solo añade las URLs al payload.

## 🟢 ADR-27 — El QR de la sala de espera sí justifica una dependencia (`qrcode.react`)

**Decisión.** La pantalla proyectada de una sesión en vivo muestra un QR generado con
`qrcode.react` (17 KB, **cero dependencias transitivas**), en vez de escribirlo a mano o pedirlo a
un servicio.

**Motivo.** La regla 16 dice comprobar primero si la biblioteca estándar o algo ya instalado lo
resuelve. Se comprobó: no hay nada. Y codificar un QR no es un caso como el del `.env`, que se
resolvió con seis líneas propias en vez de `python-dotenv`: es Reed-Solomon, matrices de bits,
selección de máscara e información de formato — unas 300 líneas de especificación que se escriben
mal en el primer intento y fallan justo donde importa (una cámara que no lee). Aquí la
proporción se invierte: la dependencia es menos código propio *y* menos riesgo.

**Alternativas descartadas.**

- *Escribir el codificador.* Reinventar una especificación cerrada, sin ganancia. La versión
  perezosa de verdad es no escribirla.
- *Una API externa de QR* (`api.qrserver.com` y similares). Sin dependencia en el `package.json`,
  pero mete una llamada de red **en el momento más frágil**: el salón entrando a la sesión, con el
  WiFi del evento. Un QR que no carga porque el WiFi está saturado es peor que no tener QR.
- *Generarlo en el backend.* Una dependencia de Python y una petición por sesión, para algo que el
  navegador puede calcular solo con datos que ya tiene (`window.location.origin` + el código).

**Consecuencias.** El bundle sube 16 KB (6,6 KB gzip). El QR se calcula en el cliente, así que
funciona aunque el backend esté caído — la URL no depende de la red. Se pintan **320 px** a nivel
de corrección **M**: con la URL de producción son 33×33 módulos, unos 9,7 px cada uno, que es lo
que hace falta para escanearlo desde el fondo del salón. Más corrección de errores lo haría más
denso y **peor** de leer a distancia, que es justo lo contrario de lo que se busca. La tarjeta
blanca con margen no es decorativa: sin zona de silencio, sobre fondo oscuro, no lo lee ninguna
cámara.

---

## 🟢 ADR-28 — La nota en vivo se calcula sobre las preguntas lanzadas, no sobre las respondidas

**Decisión.** `LiveSession.snapshot()` recorre TODAS las preguntas que llegaron a lanzarse
(`question_opened_at`), no solo las que cada alumno respondió. Las que faltan cuentan como
**incorrectas**, con el motivo en `teacher_comment` — distinguido según si el alumno ya estaba
dentro cuando se lanzó ("No respondió a tiempo.") o entró después ("Pregunta omitida: se conectó
después de que se lanzara esta pregunta.").

**Motivo.** Bug real, reportado en producción: `_score_details` calcula
`correct_count / len(graded)`, y `graded` salía de `details`, que antes solo llevaba las preguntas
que el alumno había respondido. Alguien que entraba a media sesión y se perdía la mitad de las
preguntas terminaba con el mismo denominador que alguien que las contestó todas — la nota se
inflaba exactamente en la proporción de lo que se había perdido. Con 5 de 10 respondidas y las 5
correctas, salía 100, igual que quien respondió las 10.

**Alternativas descartadas.**

- *Excluir al alumno tardío de la nota (dejarlo `pending`).* Oculta el problema en vez de
  resolverlo: un tardío con 3 de 3 seguiría sacando 100 aunque se perdiera 7 preguntas. El
  denominador tiene que ser el mismo para todos los que vivieron la sesión.
- *Registrar solo "no respondió", sin distinguir el motivo.* Es lo mínimo que arregla la nota, pero
  en Revisión un profesor no puede distinguir "no le dio tiempo de leer la pregunta" (problema de
  ritmo, quizás dar más segundos) de "no estaba conectado" (problema de asistencia). Son
  intervenciones distintas y confundirlas en el mismo texto no ayuda a decidir.
- *Guardar el motivo como un campo nuevo en el modelo.* No hizo falta: `AnswerDetail.teacher_comment`
  ya existe (lo usa la IA al calificar) y el frontend de Revisión ya lo pinta con 💬. Cero cambios de
  esquema.

**Consecuencias.** Una pregunta que la sesión **nunca llegó a lanzar** (se cerró antes de tiempo) no
cuenta ni a favor ni en contra de nadie — no forma parte de la sesión que vivió ningún alumno. El
motivo se decide comparando `participant.joined_at` contra el momento en que se lanzó esa pregunta
concreta (`question_opened_at[q.id]`), no contra la hora de cierre de la sesión: alguien que entró
a media pregunta abierta y no llegó a responder cae en "se conectó después", que es la lectura
correcta aunque técnicamente estuviera unos segundos conectado antes del reveal.

## 🟢 ADR-29 — El destello de pregunta nueva no depende del objeto `state` entero

**Decisión.** El `useEffect` de `useQuestionAlert` (`LivePage.tsx`) tiene como dependencias
`[phase, index]` — dos primitivos — en vez de `[state, state.phase, state.index]`.

**Motivo.** Bug real, reportado como "la pantalla se queda naranja fija y hay que recargar".
`useLivePoll` crea un objeto `state` **nuevo** en cada poll (cada ~1s) aunque nada haya cambiado.
Con `state` en las dependencias, React reejecutaba el efecto en **cada poll**, y antes de correr el
cuerpo nuevo llamaba al cleanup del anterior (`clearTimeout`). El cuerpo del efecto corta antes de
volver a programar el apagado (`if index === lastAlerted.current return`), así que si ese
`clearTimeout` llegaba a ejecutarse ANTES de que el `setTimeout(900ms)` original disparase — el
margen es de sobra en una red estable (900 vs ~1000ms), pero se cierra o se invierte con la latencia
irregular de un WiFi de salón, o con los timers que un navegador móvil retrasa cuando la pestaña
pasa a segundo plano — el temporizador que iba a apagar el destello se cancelaba sin que nada lo
reemplazara. El destello se quedaba encendido hasta que un remount (recargar la página) reiniciaba
el estado desde cero.

Se verificó el mecanismo exacto reproduciendo, en el motor de JS del navegador, la misma
comparación de dependencias que usa React (`Object.is` sobre el array): con `state` completo como
dependencia, tras 8 "polls" simulados el destello queda en `true`; con `[phase, index]`, se apaga
solo en los 8 casos.

**Alternativas descartadas.**

- *Aumentar la duración del `setTimeout` a 2-3s.* Reduce la ventana de la carrera sin eliminarla —
  sigue siendo posible con suficiente jitter, solo que menos frecuente. No es una corrección, es
  bajarle el volumen a un bug que sigue ahí.
- *Memoizar `state` con `useMemo`/comparación profunda en `useLivePoll`.* Resuelve el síntoma en
  este hook concreto, pero deja la trampa disponible para el siguiente `useEffect` que alguien
  escriba con `state` completo en las dependencias. Corregir en el sitio que la usa mal es más
  robusto que blindar el productor.

**Consecuencia.** Se añadió además una red de seguridad: cualquier fase que no sea `"question"`
apaga el destello explícitamente (no solo confía en que el `setTimeout` dispare). Cubre el caso
límite de una pregunta que se revela o se salta antes de que el timer de 900ms llegue a correr.

## 🟢 ADR-30 — El puntaje en vivo se enseña desglosado, no se simplifica a "aciertos"

**Contexto.** Un profesor proyectó el marcador final y el salón se le echó encima: el segundo lugar
tenía **18 respuestas correctas** y el primero **17**, pero el primero ganaba por 900 puntos. La
fórmula (`_points`) es 500 por acertar + hasta 500 por rapidez, así que el resultado era correcto —
pero la pantalla solo enseñaba el total, y un total que mezcla dos cosas no se puede defender
delante de treinta adolescentes.

**Decisión.** Se mantiene la fórmula y se rompe la opacidad: `_points()` devuelve las dos mitades
por separado, el alumno ve `+500 por acertar +320 por rapidez` junto a su ✓, el marcador lleva una
línea fija que dice que acertar más no siempre gana, y al terminar se reparten **menciones**
nombradas (*El mentalista* al que más acertó, *El más veloz del Oeste* al mejor promedio, *La mente
maestra* al que gana las dos). Cada alumno se lleva una mención como mucho.

**Alternativas descartadas.**

- *Quitar el bono de velocidad y ordenar por aciertos.* Es lo que pedía la intuición, y es peor: con
  cincuenta alumnos y diez preguntas, media clase empata en el primer puesto. El bono existe para
  desempatar (ver el comentario de `_points`), no por gamificación gratuita.
- *Enseñar la fórmula en la pantalla.* "500 + 500·(1 − t/T)" no explica nada a un alumno de
  secundaria. Un nombre propio para lo que cada uno hizo mejor sí.
- *Ordenar el marcador por aciertos y enseñar el puntaje como dato secundario.* Cambia qué significa
  ganar a mitad del curso, con sesiones ya corridas y notas ya guardadas.

**Consecuencia.** El `roster` del profesor lleva `avg_speed` (segundos promedio por acierto): es lo
único que separa "acertó más" de "fue más rápido" cuando dos puntajes se cruzan, y el profesor es
quien recibe la pregunta. Las menciones solo cuentan los aciertos para la velocidad — contestar
rapidísimo y mal no es ser rápido, y sin ese filtro el premio se lo lleva quien toca el primer botón
que ve.

## 🟢 ADR-31 — El historial de sesiones en vivo se reconstruye de las entregas, sin tabla nueva

**Contexto.** Hacía falta un panel de sesiones en vivo pasadas. El estado de `live.py` vive en
memoria y se pierde al reiniciar el proceso (ADR-25), así que ahí no hay historial que leer.

**Decisión.** `GET /live/history` reagrupa las filas de `worksheet_responses` por el código que ya
va dentro del `guest_token` (`live:{code}:{pid}`, que `finish` escribe desde el primer día). Cero
tablas, cero migraciones, cero datos nuevos que guardar.

**Alternativas descartadas.**

- *Una tabla `live_sessions`.* Duplicaría información que ya está en `worksheet_responses` y abriría
  la puerta a que las dos se contradigan (una sesión registrada cuyas entregas alguien borró).
- *Persistir la sesión en memoria antes de morir.* Requiere un hook de apagado en el que no se puede
  confiar: Render mata el proceso, y un `finish` que ya guardó lo importante hace el resto inútil.

**Consecuencia.** El agrupado se hace en Python, no en SQL: partir el token dentro de la query
pediría `split_part` en Postgres y `substr`/`instr` en SQLite — dos dialectos para lo que aquí es un
`for`. El techo conocido: el `LIMIT` va sobre **filas**, no sobre sesiones. Y una sesión en curso no
aparece en el historial hasta que se termina, que es exactamente lo correcto: hasta entonces está en
`GET /live/sessions`.

## 🟢 ADR-32 — `matching` en vivo es una opción múltiple por fila, no un tablero que se arrastra

**Contexto.** `matching` se descartó de la sesión en vivo con este motivo: *"el problema no es el
código sino el dedo: emparejar con prisa en pantalla chica frustra más de lo que enseña"*. Es cierto
**de la mecánica del renderer normal**, que empareja trazando líneas. Al revisar el catálogo completo
apareció que `_build_answer_details` (`main.py`) **nunca calificó `matching` como un todo**: emite un
detalle por fila, con `activity_id = f"{id}:{index}"`, `prompt = left[i]` y `correct_answer =
right[i]`. La unidad de calificación siempre fue una pregunta de opción múltiple.

**Decisión.** En vivo se explota fila a fila: enunciado `left[i]`, opciones = todas las `right`,
clave `right[i]`. Son los mismos botones que ya pinta el resto de tipos, con cero UI nueva, y el
"problema del dedo" desaparece igual que desapareció con `truefalse`. `imagematching` va idéntico,
con la imagen como enunciado. `dragdrop` de un hueco entra por el mismo razonamiento: su `bank` ya
está validado por el parser para contener todas las respuestas, así que **es** un `multiplechoice`.

**Alternativas descartadas.**

- *Portar el tablero de líneas al celular.* Es la lectura literal de la objeción original y lleva a
  construir una mecánica táctil nueva para un problema que la explosión disuelve.
- *Dejarlo fuera.* Habría descartado los tres tipos con mejor relación valor/coste del catálogo por
  una objeción que no aplicaba al modelo de datos real.

**Consecuencia.** Las opciones se **barajan de forma determinista** con `random.Random(activity.id)`:
sin barajar, la clave de la fila `i` cae en la posición `i` (fila 1 → primer botón…) y la actividad
se resuelve sin leerla. La semilla es fija para que el orden no cambie entre polls —el cliente
pregunta cada segundo— y para que un test pueda comprobarlo. Y aparece un tope, `MAX_LIVE_OPTIONS`
(6): un `matching` de ocho columnas son ocho botones con `OPTION_COLORS` de cuatro entradas, o sea
dos azules; se descarta entero y se reporta, porque recortar perdería la clave la mitad de las veces.

## 🟢 ADR-33 — El audio en vivo suena solo en la pantalla, con llave, y detiene el cronómetro

**Contexto.** Los cinco tipos `listening*` no entraban a la sesión en vivo por dos problemas que
parecían de UI y son de arquitectura.

**Decisión — dónde suena.** Solo en la **pantalla proyectada**, nunca en los celulares.
Reproducir en 50 teléfonos no sirve: van desfasados unos de otros, y son 50 peticiones a `/tts`
por pregunta desde la IP del salón, que con `_rate_limit(limit=300)` es un 429 a la sexta pregunta.
Proyectado es **una** petición por pregunta.

**Decisión — cómo llega sin filtrarse.** `audio_text` es la transcripción literal de lo que hay
que escuchar, y el alumno y la pantalla polean el **mismo** endpoint público (`GET /live/{code}`):
cualquier campo que se añada ahí para que la pantalla reproduzca el audio se lo regala también al
celular. Por eso el estado público solo lleva `has_audio: bool`, y el mp3 se sirve aparte en
`GET /live/{code}/audio?k={screen_key}`, con una llave que solo viaja en `host_state()`.

**Decisión — cuándo arranca el reloj.** Fase nueva `listening`: la pregunta se lanza, suena y se
proyecta con las respuestas **cerradas**; el cronómetro empieza cuando el profesor pulsa *Abrir
respuestas*. Sin ella, el bono de rapidez de `_points` premia a quien toca un botón antes de oír
—500 puntos por adivinar a ciegas— y castiga a quien escucha la pregunta entera.

**Alternativas descartadas.**

- *Mandar la URL de `/tts?text=…` a la pantalla.* Lleva el texto en el query string: lo filtra
  igual, y encima lo deja en el historial del navegador.
- *Cronómetro corriendo mientras suena, con tiempos por defecto más largos.* No arregla el
  incentivo, solo lo diluye: sigue ganando quien contesta sin escuchar.
- *Sin cronómetro para los tipos con audio.* Simple y justo, pero se pierde el desempate por
  velocidad justo en las preguntas donde más gente empata.
- *Servir el audio detrás del JWT del profesor.* La pantalla suele abrirse en el PC del proyector,
  donde nadie ha iniciado sesión.

**Consecuencia.** La pantalla necesita un **gesto de desbloqueo** ("Activar el audio"): ningún
navegador reproduce sonido sin una interacción previa en esa pestaña, y sin el botón el primer
`play()` de la clase falla dejando al salón mirando una pantalla muda. Se pide una vez, en la sala
de espera, cuando no hay prisa. La llave viaja en la URL de proyección, así que un profesor que
proyecte con la barra de direcciones visible la enseña: es del mismo orden que enseñar el código de
sesión, y quien quisiera usarla tendría que teclear un token de 11 caracteres para oír un audio que
está sonando por los altavoces.

## 🟢 ADR-34 — El polling se espacia por fase, no se optimiza la lógica de la sesión

**Contexto.** El backend corre en el plan **gratuito** de Render: 0.1 CPU y 512 MB. Con 50 alumnos
poleando cada segundo son ~52 peticiones/segundo sostenidas, y había que saber si aguantaba.

**Medición** (`live.py` es lógica pura, así que se puede cronometrar sin levantar la app):

| Parte de una petición | Coste | % |
|---|---|---|
| `public_state()` + `json.dumps()` | 0,027 ms | **0,6 %** |
| Pila HTTP/ASGI | ~4,4 ms | **99,4 %** |

RAM: 0,06 MB por sesión de 50 alumnos, 0,30 MB con 300 — irrelevante frente a 512 MB. Y el **tipo**
de actividad no cambia nada por poll (0,018 ms sea `multiplechoice`, escucha o lectura): la
explosión y la extracción ocurren **una vez**, al abrir la sesión.

**Decisión.** No se optimiza nada de `live.py`: sería pulir el 0,6%. Se reduce el número de
peticiones espaciando el poll **por fase** — 2s en `lobby`, 5s en `ended`, 1s en el resto. El
desperdicio no está en el juego sino en la sala de espera (cincuenta celulares preguntando cada
segundo mientras el profesor monta el proyector) y en la pantalla de resultados. Medido sobre una
sesión modelo: **31% menos peticiones**, y más si esas dos pantallas se quedan puestas.

**Alternativas descartadas.**

- *Subir el intervalo base a 2s para todo.* Ahorra más, pero el retraso se siente justo donde
  importa: al lanzar una pregunta y al revelarla.
- *Reprogramar el `setInterval` en cada cambio de fase.* Obliga a meter el estado en las
  dependencias del efecto, que es exactamente lo que provocó el bug de ADR-29. El temporizador
  late siempre a 1s y una compuerta decide si toca pedir; la fase vive en un `ref`.
- *WebSockets.* Sigue siendo la salida correcta por encima de ~100 alumnos simultáneos (ADR-25),
  pero es una infraestructura entera para un problema que un `if` resuelve a este tamaño.

**Consecuencia.** El riesgo real del plan gratuito **no es la CPU**: es que la sesión vive en
memoria (ADR-25) y un reinicio del proceso la borra. UptimeRobot evita el spin-down por
inactividad, pero **un redeploy a media clase pierde la sesión en curso** — las notas solo
sobreviven si ya se pulsó *Terminar y guardar*.

## Cómo añadir una decisión

Cuando descartes una alternativa por un motivo que no se lea en el código, añade una entrada aquí:
**decisión · motivo · alternativa descartada · consecuencias**. Es la parte del conocimiento que de
otro modo solo vive en la cabeza de quien la tomó.

Si el estado actual **no** se decidió —se heredó de un prototipo, o creció por acumulación—, márcalo
🟠 y dilo con esas palabras. Un ADR que finge deliberación donde no la hubo es peor que no tenerlo:
hace que alguien defienda como principio lo que solo fue una circunstancia.
