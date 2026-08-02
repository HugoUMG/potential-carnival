# 14 — Glosario

Palabras que en este proyecto significan algo concreto. Si un término aparece en el código, aquí está
qué es y dónde vive.

## Dominio

**Worksheet / Hoja de trabajo** — La unidad de contenido. Un título, una descripción, un tema
opcional y una lista de actividades (planas o agrupadas en bloques). Fila en `worksheets`, con su
texto original en `script_content` y su versión parseada en `json_content`.

**Activity / Actividad** — Un ejercicio dentro de una hoja. Hay **19 tipos**
(`SUPPORTED_BLOCKS` en `parser.py`). Cada uno tiene su sintaxis DSL, su renderer y su forma de
calificarse.

**Block / Bloque** — Agrupación de actividades con título e instrucciones de sección
(`block { }` en el DSL). **Excluyente**: si la hoja tiene al menos un bloque, las actividades fuera de
bloques se ignoran.

**Classroom / Aula** — Grupo de alumnos al que se asignan hojas y listas de vocabulario. Puede ser
pública (visible en el selector de invitado) o privada.

**Response / Respuesta** — Un envío de un alumno o invitado (`worksheet_responses`). Guarda lo que
escribió (`answers_json`), el detalle calificado (`details_json`), la nota y los conteos.

**Vocabulary list / Lista de vocabulario** — Colección de palabras con traducción y audio, asignable
a aulas o directamente a lectores.

## DSL y parseo

**DSL / WorksheetScript** — El lenguaje propio en que se escribe una hoja. Referencia completa en
[07_DSL](07_DSL.md).

**`SUPPORTED_BLOCKS`** — La lista canónica de tipos de actividad que el parser reconoce
(`parser.py`). Lo que no está ahí se descarta en silencio.

**`WorksheetScriptError`** — Excepción del parser cuando una actividad quedaría imposible de
responder. `main.py` la traduce a un 400 con el número de actividad y el motivo.

**`_activity_problem` / `_validate`** — Las funciones de `parser.py` que revisan cada actividad antes
de devolverla. **Un tipo nuevo necesita su regla aquí.**

**`_____`** — Marcador de hueco, **exactamente cinco guiones bajos**. Usado por `fillblank`,
`dragdrop` y `listeningfillblank`.

**`_matching_brace`** — El buscador de bloques que ignora las llaves dentro de `"""…"""`, para que un
`content` con `<style>{}` o `@keyframes{}` no rompa el parseo.

**`info {}` / campos `_info_*`** — Campos de identificación a nivel de **hoja** (nombre, sección…).
Las respuestas se guardan como `answers_json._info_0`, `_info_1`… Son strings planos en el DSL
(`- Name`), no `- label: "Name"`.

## Calificación

**`AnswerDetail`** — El registro por unidad de puntaje: tipo, enunciado, respuesta correcta, respuesta
del alumno, `status`, `teacher_comment` y `context`.

**Unidad de puntaje** — Cada ítem que suma. Una actividad puede generar varias: `truefalse` una por
enunciado, `matching` una por par, `reading` una por pregunta. El id compuesto es
`f"{activity_id}:{index}"`. Todas pesan **lo mismo**.

**`status`** — `correct` · `incorrect` · `pending`. **No existe `partial`.**

**`pending`** — Respuesta abierta que aún no tiene veredicto. **No cuenta en el denominador de la
nota** hasta que alguien la resuelva (la IA o el profesor).

**`_build_answer_details`** — La calificación exacta, en `main.py`. Lee la clave **de la base**, nunca
de lo que manda el cliente.

**`_score_details`** — `score = correct / (correct + incorrect) * 100`.

**`_AI_RESCUABLE`** — Los tipos en que la IA puede convertir un `incorrect` en `correct`:
`fillblank`, `listeningfillblank`, `listening`, `conversation`, `matching`.

**`ai_tolerance`** — Barra 0–100 por hoja. Elige uno de tres bloques de reglas del prompt de
calificación (estricta / equilibrada / permisiva). Nunca perdona el contenido evaluado.

**`context`** — Lo que el alumno **escuchó o leyó**, que se le pasa a la IA para poder juzgar una
respuesta abierta (diálogo, texto del audio, texto de lectura).

**Modo práctica** — El profesor resuelve su propia hoja y `POST /worksheets/{id}/practice` la califica
**sin guardar nada** (dry-run, solo automático, sin IA), para verificar la clave.

## Accesos

**Guest / Invitado** — Alumno sin cuenta. Se identifica con un `guest_token` en `localStorage`. Portal
en `/guest`, **oculto en la UI** (solo por URL).

**`guest_token`** — El identificador suave del invitado. Determinístico (aula + nombre) en `/guest`;
**nuevo en cada envío** desde el enlace directo, para que cada entrega sea independiente.

**Enlace directo** — `/w/:worksheetId`. El flujo priorizado: el alumno abre la URL y resuelve, sin
login, sin menú y sin que le pidan el nombre (lo captura el `info {}` de la hoja). El id es un UUID no
adivinable: es una **URL-capability**.

**Reader / Lector** — Rol que solo accede al portal de vocabulario. No puede cambiar su contraseña.

**`created_by`** — En `users`, el profesor que dio de alta al alumno: la base del aislamiento entre
profesores. En `worksheets` y `classrooms`, el dueño del recurso.

## Frontend

**Renderer** — `WorksheetRenderer.tsx` (la hoja) + `activityRegistry.tsx` (un componente por tipo).
Ver [08_RENDERER](08_RENDERER.md).

**`activityRegistry`** — El mapa tipo → componente React.

**`gradeStatus`** — Prop del renderer que pinta el resultado inline sobre la hoja tras el modo
práctica.

**AiPanel** — El constructor de prompt del editor (presets + chips → textarea editable). Solo
frontend.

**`ACTIVITY_GROUPS`** — La taxonomía por habilidad (gramática, lectura, comprensión auditiva, escucha
fina, producción oral, escritura abierta). Existe en `WorksheetEditor.tsx` y, en paralelo, en
`_WORKSHEET_SYSTEM` de `ai.py`.

**`shuffledByHash`** — Barajado determinístico por `activity.id`: el alumno ve las opciones
desordenadas, pero siempre igual.

**`speakingWordStatus`** — Pinta en verde o rojo cada palabra de una actividad `speaking` con `target`
tras comparar la transcripción.

**SKIN de cristal / tema oscuro** — Capas puramente CSS: ningún componente sabe que existen. El tema
vive en el atributo `data-theme` del `<html>`.

**ZzFX** — Sintetizador de efectos de sonido por código (`utils/sfx.ts`): blips de clic y sonidos de
las animaciones de envío, sin ningún archivo de audio.

## Infraestructura

**Aiven** — Dónde está la base de datos de producción (no Render). Su latencia es la causa de los
spinners.

**UptimeRobot** — El monitor que mantiene despierto el backend en Render pegándole a `/health`.

**`ponytail:`** — Marca en un comentario del código: simplificación deliberada, con su límite y su
camino de mejora si algún día hace falta.
