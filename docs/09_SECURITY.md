# 09 — Seguridad

## Contraseñas y tokens (`backend/app/security.py`)

| Qué | Cómo |
|-----|------|
| Hashing | **PBKDF2-SHA256**, 390 000 iteraciones, salt aleatorio por usuario |
| Rehash | Los hashes heredados (menos iteraciones o texto plano antiguo) se actualizan al hacer login |
| JWT | **HS256**, firmado con `JWT_SECRET_KEY`, expiración `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` (480 = 8 h) |
| Transporte | `Authorization: Bearer` desde `localStorage` |

`security.hash_password()` es la única forma de guardar una contraseña. **Nunca** escribir una
contraseña en claro en la base.

## CORS

`FRONTEND_ORIGINS` (lista separada por comas). Sin la variable, el default de desarrollo es
`http://localhost:5173`.

## Roles

`admin` · `teacher` · `student` · `reader`, con `CHECK` en la columna `users.role`. Se verifican con
dependencias FastAPI en cada ruta — la lista está en
[02_BACKEND](02_BACKEND.md#autenticación-y-permisos).

Los `reader` **no pueden cambiar su contraseña** (es un acceso compartido a vocabulario, no una
cuenta personal).

### Los endpoints de usuario van por lista blanca, no por cadena de `if`

`PUT /users/{id}` y `PUT /users/{id}/password` ramifican por rol. Cuando la cadena era
`if student … elif teacher …` **el `reader` no entraba en ninguna rama y caía directo al `UPDATE`**:
podía fijar la contraseña de cualquier usuario, admin incluido. Y el `reader` es justo la cuenta
compartida — la credencial que más gente conoce.

La forma correcta es que **el rol no contemplado termine en 403**, no en el cuerpo de la función:
cada rama cubre un rol y la última es `elif current_user.role != UserRole.admin: raise 403`. Al
añadir un rol nuevo, el fallo es entonces "no me deja" y no "puede con todo" ([ADR-23](15_DECISIONS.md)).

Cubierto por `backend/tests/test_permisos_publicos.py`.

## Registro: solo con Google

**No existe alta pública con usuario y contraseña.** `POST /auth/register` se **eliminó**, no se
escondió: dejar la ruta abierta y quitarle el botón no habría cambiado nada.

El motivo es de producción: no hay forma de comprobar que un correo escrito a mano sea de quien se
registra. Google entrega el correo ya verificado.

### Cómo funciona `POST /auth/google`

1. El frontend usa Google Identity Services (`GoogleSignInButton.tsx`) y obtiene un **ID token**.
2. El backend lo valida contra `https://oauth2.googleapis.com/tokeninfo` (con `httpx`, sin librería
   nueva) comprobando **`aud`**, **`iss`** y **`email_verified`**.
3. Si el correo no existe, crea un **profesor** con contraseña aleatoria: esa cuenta solo entra por
   Google.

- **No se usa el flujo de código de autorización, así que el `client_secret` no vive en ningún sitio
  de la app.**
- Sin `GOOGLE_CLIENT_ID` en el backend, el endpoint responde **503 a propósito**: sin `aud` que
  comparar, un ID token de *cualquier otra app de Google* abriría cuentas aquí. Falla en cerrado.
- Sin `VITE_GOOGLE_CLIENT_ID` en el frontend, el botón simplemente no se pinta.
- En Google Cloud Console hay que listar el origen del frontend en "Orígenes autorizados de
  JavaScript".

Vías de alta que siguen existiendo, todas cerradas: el admin crea profesores (`POST /teachers`) y el
profesor crea a sus alumnos (`POST /students`).

Cubierto por `backend/tests/test_google_auth.py`.

## Aislamiento entre profesores

Cada profesor ve y administra **solo lo suyo**: sus aulas, sus hojas y sus alumnos
(`users.created_by`). **No hay excepción para `created_by IS NULL`** — un alumno sin dueño solo lo ve
el admin. Detalles y backfill en [04_DATABASE](04_DATABASE.md#aislamiento-de-alumnos-por-profesor-userscreated_by).

Cubierto por `backend/tests/test_student_isolation.py`.

### Invitados: el dueño es el aula

La tabla `guest_access_logs` no guarda profesor, pero sí `classroom_id`, y el aula sí tiene
`created_by`. **Ese JOIN es la comprobación de dueño**: `list_guest_access_logs(owner_id)` filtra por
ahí y `/teacher/guest-detail` exige `require_classroom_manager` sobre el aula que se consulta.

Dos consecuencias del INNER JOIN, ambas buscadas: un `classroom_id` que no exista desaparece del
panel de todos (`/public/guest-sessions` no lleva auth y acepta cualquier cadena), y en el detalle
una hoja ya desasignada del aula solo se muestra si es del profesor que pregunta — el `guest_token`
identifica al invitado, no al aula, así que sin ese filtro arrastraría respuestas de hojas ajenas.

Cubierto por `backend/tests/test_permisos_publicos.py`.

## Endpoints públicos

`/public/*` no lleva JWT **a propósito**: sostienen el modo invitado y el enlace directo. Sus reglas:

- Solo exponen hojas **publicadas**.
- El acceso al enlace directo es una **URL-capability**: el id es un UUID v4 no adivinable. Quien
  tiene el enlace puede resolver la hoja; es el modelo que se quiso (compartir sin cuentas), no un
  descuido.
- La identidad del invitado es **suave**: `guest_token` en `localStorage`. El límite de intentos del
  enlace directo es por dispositivo. No hay identidad server-side y no se pretende que la haya.
- Un invitado no puede leer respuestas ajenas: `GET /public/responses` filtra por su `guest_token`.

## Topes en los endpoints públicos

Sin login no hay cuota que consumir ni cuenta que bloquear, así que los públicos que gastan CPU o
dinero se acotan **por los dos lados**: cuánto cuesta *una* petición y cuántas caben por minuto.

| Endpoint | Por petición | Por IP y minuto |
|----------|--------------|-----------------|
| `GET /tts` | `text` ≤ 2000 caracteres; `voice`/`rate` validados contra inyección de SSML | 300 |
| `GET /tts/conversation` | `lines` ≤ 8000 caracteres | 300 |
| `POST /public/transcribe` | 4 MB de audio | 60 |

El tope de tamaño es el que más importa en `/tts`: edge-tts sintetiza el MP3 **entero en memoria**
antes de responder, así que sin `max_length` una sola petición podía tumbar la instancia. En
`/public/transcribe` el que importa es el de volumen: cada llamada gasta cuota de Groq.

`_rate_limit` (`main.py`) es una ventana deslizante en un dict, sin Redis ni `slowapi`. Sus dos
techos, escritos en el propio código: es **por proceso** (con más de un worker de uvicorn el límite
real se multiplica) y es **por IP** (un colegio tras un NAT comparte cupo — por eso los números van
holgados, no ajustados).

La IP se lee de la **entrada más a la derecha** de `X-Forwarded-For`, que es la que añade el proxy de
Render. Tomar la izquierda dejaría falsificar la IP con una cabecera y saltarse el límite; usar
`request.client.host` a secas metería a todos los usuarios en el mismo cupo detrás del proxy.

Los tres endpoints **no pueden pedir JWT**: `/tts` se usa como `src` de un `<audio>`, que no manda
cabeceras, y `/public/transcribe` sostiene el modo invitado, que existe precisamente para no pedir
cuenta.

## Contenido HTML del alumno (`content`)

El bloque `content` renderiza HTML que escribió el profesor:

- **Por defecto** se sanea inline con **DOMPurify**: bloquea `<script>`, `onclick`, `javascript:`.
- Con **`sandbox: true`** se renderiza en un `<iframe sandbox="allow-scripts">` **sin
  `allow-same-origin`**, así que ese HTML no puede tocar el DOM, las cookies ni el `localStorage` del
  portal.

## Problema abierto: la clave de respuestas viaja al cliente

Los endpoints que entregan la hoja al alumno devuelven `json_content` **completo**, con `answer`,
`statements[].answer`, `pairs[].match` y `audio_text`. **La clave entera llega al navegador de todos
los alumnos.** La URL del TTS es un caso particular del mismo error.

No compromete la **calificación** —`_build_answer_details` relee la clave de la base, nunca confía en
el cliente— pero sí la evaluación. Plan por fases, con lo que no hay que romper:
[plans/PLAN-fuga-de-respuestas.md](plans/PLAN-fuga-de-respuestas.md).

## Checklist antes de tocar algo sensible

- Toda ruta nueva lleva una dependencia de auth, salvo que sea `/public/*` **y** solo exponga datos
  publicados.
- Si la ruta ramifica por rol, **el rol no contemplado sale por 403**, no por el final de la función.
- Un `/public/*` que gaste CPU o cuota de una API externa lleva tope de tamaño **y** `_rate_limit`.
- Contraseñas: siempre `security.hash_password()`.
- Nada de secretos en el repo: `.env` está en `.gitignore`; en Render van como variables del servicio.
- `JWT_SECRET_KEY` largo, aleatorio y distinto en cada entorno.
- `SEED_DEMO_USERS=false` en producción.
- No añadir un endpoint que devuelva claves de respuestas a un cliente no autenticado.
