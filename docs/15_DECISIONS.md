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

**Consecuencia.** Sigue la regla 20 (cadena del campo: parser.py, domain.py, models.py, types.ts,
api.ts) y la regla 21 (si el DSL lo enseña, sincronizar 07_DSL, `_WORKSHEET_SYSTEM`,
GENERATION_PROMPT). Implementación delegada: `docs/plans/PLAN-cambio-4-campo-note.md`.

## 🟢 ADR-20 — Actividades con imagen: empezar por MC con imagen y matching imagen-texto

**Decisión.** La ampliación de actividades con imagen (solicitud #5) empieza con **dos** tipos:
opción múltiple con imagen y matching imagen-texto. El carácter visual queda en el DSL; **no hay un
"modo imagen" opuesto al renderer**.

**Motivo.** Cubren los dos casos más usados en clase con uno de opción cerrada y uno de arrastre, sin
ampliar el alcance a todo lo que se pueda imaginar de golpe.

**Alternativa descartada.** Una super-actividad genérica de imagen que absorbería todos los tipos.
**Consecuencia.** Cada tipo recorre la cadena completa (reglas 17 y 20) y el DSL se sincroniza
(regla 21). El renderer de impresión los traduce a papel (decidido en ADR-21). Diseño primero:
`docs/plans/PLAN-cambio-5-actividades-imagen.md` (REVIEW antes de implementar).

## 🟢 ADR-21 — El renderer de impresión traduce a papel, sin DSL de imagen

**Decisión.** La impresión no inventa un DSL paralelo ni modos visuales: `WorksheetPrint` ya omite
`speaking` y `listening*`; cada tipo que sí imprime se **traduce a papel** con lo que ya sabe. El modo
"físico" de la IA (solicitud #12) restringe la generación al conjunto imprimible existente.

**Motivo.** Reutilizar la fuente de verdad de impresión ya consolidada en vez de bifurcar el parser.

**Consecuencia.** La lista de "imprimibles" usada por `WorksheetPrint` pasa a ser la referencia para
el filtro del modo físico. Implementación: `docs/plans/PLAN-cambio-12-modo-fisico.md`.

## 🟢 ADR-22 — Evaluaciones guardadas en tarjetas con mini vista previa y edición aislada

**Decisión.** La sección «Evaluaciones guardadas» (solicitud #6) se muestra como tarjetas con mini
vista previa de la hoja y menú «⋮» (ver respuestas, copiar enlace, duplicar, archivar/borrar). Clic en
la tarjeta abre el editor de ESA hoja en pantalla aislada (solo la hoja, con botón de volver); no se
crea copia.

**Motivo.** El profesor entiende mejor de un vistazo la biblioteca de evaluaciones y edita cada hoja
sin el ruido del dashboard.

**Alternativa descartada.** Seguir en lista de filas; o una miniatura que reprodujera audio/interacción
(se descarta: carga cara y permite responder). La miniatura es estática y sin audio.

**Consecuencia.** El modo aislado reutiliza el estado de edición de App.tsx. Implementación:
`docs/plans/PLAN-cambio-6-tarjetas-evaluaciones.md`.

---

## Cómo añadir una decisión

Cuando descartes una alternativa por un motivo que no se lea en el código, añade una entrada aquí:
**decisión · motivo · alternativa descartada · consecuencias**. Es la parte del conocimiento que de
otro modo solo vive en la cabeza de quien la tomó.

Si el estado actual **no** se decidió —se heredó de un prototipo, o creció por acumulación—, márcalo
🟠 y dilo con esas palabras. Un ADR que finge deliberación donde no la hubo es peor que no tenerlo:
hace que alguien defienda como principio lo que solo fue una circunstancia.
