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

```json
{ "prompt": "Past simple, A2, 8 actividades", "created_by": "…", "printable": true, "ai_grading": true, "ai_tolerance": 30 }
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
GET    /teacher/guest-logs                    — Accesos de invitados
GET    /teacher/guest-detail                  — Detalle de un invitado
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
GET    /tts?text=…&voice=en-US-GuyNeural      — Sintetiza una oración → audio/mpeg en streaming
GET    /tts/conversation?lines=…              — Diálogo con voces m/f alternadas, MP3 concatenado
```

`voice`: `en-US-GuyNeural` (masculina, por defecto) o `en-US-JennyNeural` (femenina).
`/tts/conversation` concatena frames MP3 en crudo; si hiciera falta una pausa marcada entre turnos,
habría que intercalar un MP3 de silencio.

> ⚠️ La URL del TTS lleva el texto en claro, así que **filtra la respuesta de los listening**. Es un
> caso particular del problema descrito en [el plan de fuga de respuestas](plans/PLAN-fuga-de-respuestas.md).
> Pasarlo a POST **no** lo arregla (el cuerpo se ve igual en la pestaña de red).

## Público / invitado (sin JWT)

```
GET    /public/classrooms                     — Aulas públicas (selector de invitado)
GET    /public/classrooms/{id}/worksheets     — Hojas del aula (invitado)
GET    /public/worksheets                     — Hojas publicadas
GET    /public/worksheets/{id}                — Hoja publicada por id (enlace directo /w/:id)
POST   /public/guest-sessions                 — Registrar acceso de invitado
POST   /public/responses                      — Enviar respuestas como invitado
GET    /public/responses?guest_token=…        — Respuestas calificadas del invitado
POST   /public/transcribe                     — Audio (speaking) → texto vía Groq Whisper
GET    /public/vocabulary/{id}                — Lista de vocabulario por id (enlace /v/:vocabId)
GET    /public/readers-vocabulary             — Vocabulario público (/vocab)
```

- Identifican al invitado por `guest_token`. En el modo `/guest` es determinístico (aula + nombre);
  en el enlace directo `/w/:id` cada envío usa uno **nuevo**, para que cada entrega sea independiente.
- El límite de intentos del enlace directo es **por dispositivo** (`dw_count_{id}` en `localStorage`),
  coherente con el modelo suave de invitado: no hay identidad server-side.
- **Todo lo que necesite funcionar sin login va en `/public/*`.**

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
