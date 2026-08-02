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

## Endpoints públicos

`/public/*` no lleva JWT **a propósito**: sostienen el modo invitado y el enlace directo. Sus reglas:

- Solo exponen hojas **publicadas**.
- El acceso al enlace directo es una **URL-capability**: el id es un UUID v4 no adivinable. Quien
  tiene el enlace puede resolver la hoja; es el modelo que se quiso (compartir sin cuentas), no un
  descuido.
- La identidad del invitado es **suave**: `guest_token` en `localStorage`. El límite de intentos del
  enlace directo es por dispositivo. No hay identidad server-side y no se pretende que la haya.
- Un invitado no puede leer respuestas ajenas: `GET /public/responses` filtra por su `guest_token`.

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
- Contraseñas: siempre `security.hash_password()`.
- Nada de secretos en el repo: `.env` está en `.gitignore`; en Render van como variables del servicio.
- `JWT_SECRET_KEY` largo, aleatorio y distinto en cada entorno.
- `SEED_DEMO_USERS=false` en producción.
- No añadir un endpoint que devuelva claves de respuestas a un cliente no autenticado.
