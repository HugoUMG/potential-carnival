# 13 — Roadmap y pendientes

Estado a **2026-08-03**, rama `feat/student-ux`.

---

## Cambios de UX pedidos por el usuario (en curso)

Paquete de 12 cambios sobre la rama `feat/student-ux`.

**Hecho y commiteado:**
| Cambio | Commits |
|--------|---------|
| #2 Nueva evaluación siempre en blanco · #7 Visual por defecto + banner · #11 aterrizar en Evaluaciones guardadas · #9 botón vocabulario en header · #8 toggle tema en `/w/:id` · #10 sin guiones largos en la UI | `714707c` |
| #1 duplicar actividad + arrastrar/soltar imagen en el constructor visual · #3 plantillas rápidas en modo script | `a93f951` |

**Pendiente (prompts de Claude listos en `docs/plans/`):**
| Cambio | Prompt | Dominio |
|--------|--------|---------|
| #4 campo privado `note` para la IA | [PLAN-cambio-4-campo-note.md](plans/PLAN-cambio-4-campo-note.md) | DSL + BD + IA |
| #5 actividades con imagen (MC con imagen + matching imagen-texto) | [PLAN-cambio-5-actividades-imagen.md](plans/PLAN-cambio-5-actividades-imagen.md) — REVIEW primero | DSL + IA + renderer |
| #6 evaluaciones como tarjetas (mini vista previa + ⋮ + edición aislada) | [PLAN-cambio-6-tarjetas-evaluaciones.md](plans/PLAN-cambio-6-tarjetas-evaluaciones.md) | Frontend |
| #12 modo físico/imprimible en la generación con IA | [PLAN-cambio-12-modo-fisico.md](plans/PLAN-cambio-12-modo-fisico.md) | IA + API + renderer |

---

## Pendiente mayor (con plan escrito)

### La hoja le entrega al alumno su propia clave de respuestas

Los endpoints que entregan una hoja al alumno devuelven `json_content` **completo**: `answer`,
`statements[].answer`, `pairs[].match` y `audio_text` viajan al navegador de todos los alumnos. La URL
del TTS es un caso particular del mismo error.

No compromete la calificación (que se hace en el servidor leyendo de la base), sí la evaluación.

**Plan por fases, listo para ejecutar:** [plans/PLAN-fuga-de-respuestas.md](plans/PLAN-fuga-de-respuestas.md)

| Fase | Esfuerzo | Cierra |
|------|----------|--------|
| 1 — sanear el payload | 1 función + 4 llamadas | Todas las claves escritas, de opción múltiple, T/F y listeningmatching |
| 2 — audio por referencia | 1 endpoint + `AudioPlayer` + context + 7 renderers | El texto oculto de todos los listening y de conversation |
| 3 — matching y listeningorder | `bank` obligatorio (barato) · matching (caro) | Los dos casos con orden significativo |

Empezar por la fase 1: casi todo el daño y no toca el frontend.

---

## En cola

### Rendimiento (carga de base de datos)

Hecho: pool de conexiones, `teacher_dashboard` sin N+1, `/public/readers-vocabulary` en un JOIN.

Siguiente:
- Caché de lecturas públicas (vocabulario y hojas de invitado).
- Co-ubicar la región de Render con la de Aiven.
- Revisar el resto de N+1.

### Nota parcial de verdad

`partial` se eliminó del prompt de calificación porque el modelo lo devolvía y se guardaba como
`incorrect`. Implementarlo de verdad toca `AnswerDetail.status`, `_score_details`, los badges de
revisión y la impresión. Es una tarea propia, no un ajuste de prompt.

### Rebrand DinoEnglish

Plan temático (mascota RexLearn) **solo** para el portal de alumno/invitado. En pausa.

### Menores

- **Bug:** puede faltar el tratamiento de `\n` en algún campo específico que no pase por `RichText`.
- **Pausa entre turnos de `conversation`:** la concatenación de MP3 es cruda; si hace falta una pausa
  marcada, intercalar un MP3 de silencio.
- **Tests de frontend:** no hay ninguno. Hoy la red son `tsc -b` y ESLint.
- **El candado anti-doble-envío es por proceso.** `_response_locks` (`main.py:59`) es un diccionario
  en memoria: con más de un worker de uvicorn no protege nada. Los invitados sí están cubiertos por el
  índice único de BD; los **alumnos registrados no** (ese índice se eliminó porque rompía
  `max_attempts`). Con un solo worker no es un problema hoy — pero es lo primero que se rompe al
  escalar horizontalmente.
- **Primer corte pendiente de `main.py`:** sacar `grading.py` (ver
  [15_DECISIONS, ADR-12](15_DECISIONS.md)).
- **Deuda de lint:** `npm run lint` reporta 18 errores heredados (`no-explicit-any` en el constructor
  visual y el editor, una variable sin usar, un bloque vacío) y 6 avisos de `useEffect`. Mientras
  tanto, la regla es no añadir errores nuevos.

---

## Cerrado recientemente

### Revisión QA de los 19 tipos (julio 2026)

- Round-trip de `listeningmatching`: `_parse_pairs` acepta `pair {}` **y** la lista `pairs:` que emite
  el constructor visual (antes, guardar desde el editor visual destruía la actividad).
- **El parser valida antes de devolver**: los fallos silenciosos ahora son un error al guardar, con el
  número de actividad y el motivo.
- `listening` y `conversation` añadidos a `_AI_RESCUABLE`; después, también `matching`.
- La IA recibe el **contexto** del audio y de la lectura al calificar.
- `GENERATION_PROMPT` reescrito (documentaba 11 de 19 tipos y se contradecía sobre `speaking`).
- La referencia del DSL, que documentaba 13 tipos y declaraba `speaking` prohibido, completada.
- `esc()` del serializador visual: los backslashes ya no llegan al alumno.
- Enunciado true/false sin `|` → error al guardar, en vez de una clave equivocada en silencio.
- El ancho del input de `fillblank` ya no delata la longitud de la respuesta.
- `partial` fuera del prompt de calificación.
- Instrucciones de mecánica en español.
- Reproductor quitado de `reading` y `readingtruefalse`.

### Cuentas, tema y navegación (julio 2026)

Tema claro/oscuro global por CSS · registro de profesor solo con Google (y `POST /auth/register`
eliminado) · login con Google · el backend lee `.env` · aislamiento de alumnos por profesor con
backfill en el arranque · portal enrutado por secciones · menú lateral agrupado · panel de
notificaciones con historial de 7 días · modo invitado oculto de la UI · pestaña "Lectores" retirada
del portal (los endpoints siguen) · schema SQLite completado con las tablas de vocabulario.

### Ya resueltos, aunque aparecían como pendientes

- **El alumno ve a qué aula pertenece** — pestaña Perfil.
- **Perfil del alumno con historial de notas y cambio de contraseña propio** — implementado.

---

## Ideas sin compromiso

- Versionar la API si algún día hay clientes externos (hoy frontend y backend se despliegan juntos).
- Reactivar el modo invitado en la UI: basta con volver a poner un enlace a `/guest` en el login.
- Analíticas por alumno más allá del dashboard actual.
