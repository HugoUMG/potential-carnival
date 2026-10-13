# Plan: salas multijugador para los juegos

Cualquier juego de `/j/:setId` se puede jugar **en grupo**. Alguien crea una sala, los demás se
unen con un código y todos ven el mismo tablero en vivo. Esto lo hace posible una pieza genérica
(`useShared`) que sustituye a `useState` en los juegos. El servidor no entiende ningún juego: solo
guarda el estado y vigila quién tiene el control.

Se implementa **en dos fases**, con un commit cada una:
1. Backend, infraestructura del cliente y **Memorama** como piloto.
2. Los demás juegos, uno por uno, según la tabla de abajo.

## Qué ve el usuario

1. Dentro de un juego que admite salas, el encabezado muestra **👥 Jugar en grupo**. Al tocarlo
   aparecen **Crear sala** y **Unirme con código**. Jugar solo queda **igual que hoy**.
2. **Crear sala:** escribe su nombre, elige el modo y recibe un código de 4 letras más el enlace
   `/j/:setId?sala=K7QF#memorama` con botón de copiar. Quien la crea es el **anfitrión** 👑.
   **Una sala es de un solo juego.** Si alguien cambia de juego desde la barra lateral, sale de
   la sala tras confirmarlo.
3. **Unirse:** con el enlace (que salta directo al formulario) o con el código. Pide el nombre.
4. Una barra de sala con: los jugadores (nombre, 👑, punto gris si está desconectado y puntos en
   modo Turnos), un aviso de quién mueve ("▶ Turno de Ana", "👀 Viendo a Ana" o "🎮 Ahora mueve
   Luis (1 turno)"), el código y Copiar enlace. Quien no tiene el control ve el juego en vivo
   **sin poder tocarlo**.
5. **Modos:**
   - **Turnos** (parejas, tríos…): el control rota entre los jugadores conectados, en el orden en
     que entraron. Cada juego define cuándo termina un turno (ver la tabla). El anfitrión puede
     **saltar el turno** de alguien desconectado.
   - **Presentador** (uno a muchos): por defecto **solo el anfitrión mueve** y los demás ven
     exactamente lo mismo que él. El anfitrión toca a un jugador de la lista y **cede el
     control**:
     - **"Un turno"**: esa persona hace un turno, según la tabla, y el control vuelve solo al
       anfitrión.
     - **"Sin límite"**: esa persona mueve hasta que el anfitrión pulse **"Recuperar control"**.
     El anfitrión **siempre** puede recuperar el control o mover, aunque lo haya cedido.
   - En ambos modos el anfitrión puede **reiniciar** la partida (el "Otra vez" de cada juego).

## Backend: `backend/app/rooms.py` (nuevo, en memoria, sin BD)

Copia el patrón de `live.py` (`_new_code`, `_evict`, `CODE_ALPHABET`, TTL y tope de salas). **No
toca la base de datos**, así que no hay migraciones.

```python
ROOM_GAMES = {...}   # lista blanca: los ids de la tabla de abajo (sin "contrarreloj")

@dataclass
class Player:
    id: str          # público, corto (se ve en el estado)
    token: str       # secreto, secrets.token_urlsafe(16); NUNCA sale en el estado público
    name: str
    last_seen: float

@dataclass
class Room:
    code: str
    game: str        # en ROOM_GAMES
    set_id: str
    mode: str        # "turnos" | "presentador"
    host_id: str
    players: list[Player]
    turn: str        # id del jugador que puede escribir
    lend: str | None # solo presentador: None (lo tiene el anfitrión) | "once" | "always"
    state: dict      # blob opaco del juego
    version: int
    created_at: float
```

Límites: nombre de 1 a 24 caracteres (con `strip`), máximo 8 jugadores, estado JSON de hasta 50 KB
(Chat guarda respuestas escritas), TTL de 3 h y `MAX_ROOMS = 500`. Un jugador cuenta como
**conectado** si hizo un poll en los últimos 10 s.

### Endpoints (en `main.py`, públicos y sin login, como `/live/{code}`)

| Método | Ruta | Body | Hace |
|---|---|---|---|
| POST | `/rooms` | `{game, set_id, mode, name}` | Crea la sala con el estado vacío. Devuelve `{code, token, me, ...public}` |
| POST | `/rooms/{code}/join` | `{name}` | Devuelve `{token, me, ...public}` |
| GET | `/rooms/{code}?token=…&since=N` | — | Actualiza `last_seen`. Si `version == since`, devuelve el estado público sin `state` |
| POST | `/rooms/{code}/state` | `{token, version, state, turn}` | Reemplaza el blob. **409** si `version` no coincide. Hace `version += 1` |
| POST | `/rooms/{code}/turn` | `{token, to, lend?}` | Solo el anfitrión. En `turnos`, salta un turno. En `presentador`, cede el control (`lend` = `"once"` o `"always"`) o lo recupera (`to` = `host_id`, que pone `lend = None`) |

Estado público: `{code, game, set_id, mode, host_id, turn, lend, version, state, players: [{id, name, online}]}`.

Quién puede mandar `POST /state` y qué `turn` puede poner:
- El **anfitrión puede escribir siempre**, en cualquier modo, para corregir o reiniciar.
- Cualquier otro jugador solo puede escribir si `room.turn` es su id. Si no → 403.
- En `turnos`, `turn` debe ser el id de un jugador que exista. Si no → 422.
- En `presentador`, quien no es anfitrión solo puede mandar `turn` = él mismo o `turn` =
  `host_id`. Cualquier otro valor → 422. Cuando `turn` vuelve a `host_id`, `lend = None`.

Reglas:
- Errores con `HTTPException` y mensaje en español, igual que `LiveError`.
- Usa el rate limit de `main.py` (`_rate_hits`) en `create` y `join`.
- Declara `/rooms` antes de `/rooms/{code}`, como se hace en `/live`.

**Autoridad en el cliente (decisión consciente, va como ADR).** El servidor no valida jugadas.
Solo comprueba quién tiene el control y que la versión coincida. En una clase, que alguien haga
trampa desde DevTools no importa, y así el mismo backend sirve para los 15 juegos.

## Frontend: la infraestructura (fase 1)

### `src/services/api.ts` + `types.ts`
Añade `createRoom`, `joinRoom`, `getRoom`, `pushRoomState` y `passRoomTurn`, con los tipos
`RoomState` y `RoomPlayer`.

### `src/games/room.tsx` (nuevo)
**`RoomProvider`** (contexto) hace el polling y expone:
```ts
{ room, me, isHost, canAct,              // canAct = no hay sala, o room.turn === me, o isHost
  endTurn(),                             // termina "un turno" (ver abajo)
  addPoint(n = 1),                       // suma a __scores[me]; solo cuenta en modo turnos
  passTurn(to, lend?), leave() }
```
- Polling cada 1 s con `since=version`. Se pausa si `document.hidden`.
- El token se guarda en `sessionStorage` con la clave `dg-room-{code}`, así un F5 no expulsa al
  jugador.

**`useShared<T>(key, init)`**: reemplazo directo de `useState`. Es la pieza central.
- **Sin sala:** es exactamente `useState(init)`. Jugar solo no cambia nada.
- **En sala:** el valor sale de `room.state[key]`. El setter acepta un valor o una función,
  igual que `useState`.
  - **Si `!canAct`, el setter no hace nada.** Por eso los `useEffect` y `setTimeout` de cada juego
    se pueden ejecutar en todos los navegadores sin peligro: solo cambia algo en el de quien
    tiene el control. Esto evita tocar la lógica de los juegos.
  - Quien tiene el control ve el cambio al instante (optimista). Los cambios se juntan en un
    objeto pendiente y se mandan como **un solo `POST /state` en vuelo a la vez**. Lo que cambie
    mientras tanto se manda en la siguiente petición. Eso cubre varios setters en el mismo
    clic, escribir letra por letra y animaciones como el dado. Mientras haya cambios pendientes,
    el poll no pisa el estado local.
  - Si el servidor responde 409 (el anfitrión corrigió algo), se adopta el estado del servidor
    y se descarta lo pendiente.
  - Si el blob no tiene `key`, el anfitrión escribe `init`. Esto incluye repartos y barajadas,
    así todos ven el mismo azar. Hasta que el blob tenga `__ready: true`, el resto ve
    "Esperando al anfitrión…".
- Los valores tienen que ser JSON. **Los `Set` de los juegos pasan a arrays.**

**Turnos (`endTurn`)**, según `room.mode` y `room.lend`:
- En `turnos`: el control pasa al siguiente jugador **conectado**, en el orden de `players`.
- En `presentador` con `lend == "once"` y sin ser anfitrión: el control vuelve a `host_id`.
- En cualquier otro caso no hace nada.
El nuevo `turn` viaja en el mismo `POST /state` que lo pendiente.

**Audio sincronizado:** `speak()` (`util.ts`), cuando lo llama quien tiene el control en una
sala, escribe además `__say: {text, slow, n}`. `RoomProvider`, en los demás navegadores,
reproduce el audio cuando `n` cambia. Así se oye en todos los dispositivos sin tocar cada juego,
lo que importa sobre todo en Escucha y Dictado.

**Bloqueo para espectadores:** si `!canAct`, el área del juego lleva `inert` y una clase con
cursor `not-allowed`. Se acepta que los espectadores no puedan abrir el diccionario de palabras
mientras miran.

**UI:** `RoomBar` y `RoomGate` (crear, unirse, nombre, modos permitidos por juego). Los estilos van
en `games.css`, colgados de `.dg`, y el modo oscuro solo con variables (regla 23).

### `registry.ts` y `GamePlayer.tsx`
- Añade a cada entrada de `GAMES` un campo `room?: ('turnos' | 'presentador')[]` con los modos
  que permite ese juego. Sin el campo, el juego no muestra "👥 Jugar en grupo".
- `GamePlayer` lee `?sala=`, envuelve el juego activo en `RoomProvider` y muestra `RoomBar` o
  `RoomGate`. Si la sala es de otro juego que el del hash, abre el juego de la sala.

## Los juegos (fase 2; Memorama va en la fase 1)

En cada juego: cambia `useState` por `useShared` en lo que deben ver todos (columna "Compartido").
Lo de la columna "Local" se queda en `useState`. Añade `endTurn()` y `addPoint()` donde dice la
tabla. Convierte los `Set` en arrays.

| Juego | Modos | Compartido | Local | `endTurn()` cuando… | `addPoint()` cuando… |
|---|---|---|---|---|---|
| 🧠 Memorama | ambos | cards, open, matched[], moves | — | se cierra un par **fallado** (si acierta, sigue) | encuentra un par |
| 🃏 Tarjetas | ambos | order, pos, flipped, dir, done[] | startX, swiped | pasa a la siguiente tarjeta | — |
| 💬 Chat | ambos | order, answers, draft | typing, copied, end | envía una respuesta | — |
| 🎡 Ruleta | ambos | round, done[], rot, spinning, open | — | cierra la pregunta | — |
| 📌 Corcho | ambos | done[], open | — | cierra la nota | — |
| 🎲 Dados | ambos | face, qi, rolling, rolls, deck | — | cierra la pregunta | — |
| 🏆 Equipos | presentador | scores, turn, deck, shown | — | califica una respuesta | — (ya tiene sus propios equipos) |
| 🎤 Pronuncia | ambos | order, pos, said, best | listening, err | pasa a la siguiente frase | supera el umbral de acierto que ya usa |
| 👂 Escucha y elige | ambos | order, pos, opts, chosen, score | — | pasa a la siguiente | acierta |
| ✍️ Dictado | ambos | order, pos, typed, hits, accuracy | — | comprueba y pasa | acierta ≥ 80 % |
| 🔢 Bingo | presentador | called | **card, marked, shake** (cada uno tiene su cartón) | canta un número | — |
| 🧩 Ordena | ambos | order, pos, pool, picked, status, score, hint | — | pasa a la siguiente oración | acierta |
| 🕳️ Completa | ambos | order, pos, gap, chosen, score | — | pasa a la siguiente | acierta |
| 🎈 Globos | ambos | order, pos, secret, guessed[], wins, clue | — | **falla una letra** (si acierta, sigue) | completa la palabra |
| ✅ ¿Coincide? | ambos | n, round, score, streak, result | drag, startX | responde | acierta |
| ⏱️ Contrarreloj | **no tiene sala** | — | — | — | — |

Notas por juego:
- **Bingo:** en sala, el que tiene el control "canta" y `teacherCalls` queda forzado a `false`.
  Cada alumno marca su propio cartón localmente. El cartón no se comparte, a propósito.
- **Pronuncia:** el micrófono es el del que tiene el control. Los demás ven lo que dijo y su nota.
- **Ruleta y Dados:** la animación llega a los espectadores con hasta ~1 s de retraso, y el dado
  se ve a saltos. Es aceptable.
- **Contrarreloj queda fuera:** es una carrera de 60 s con reacción al instante. Con polling de
  1 s, los espectadores lo verían a saltos y por turnos no tiene sentido. No lleva campo `room`.

## Tests: `backend/tests/test_rooms.py`
Sigue el patrón de `test_juegos.py`. Es todo en memoria, pero recuerda la regla 2: importar
`backend.app` carga el `.env` real, así que **no escribas nada que toque la BD**. Casos:
- crear sala y unirse: el estado público **no** contiene tokens
- `game` fuera de `ROOM_GAMES` (por ejemplo `contrarreloj`) → 422
- `state` con el token de alguien sin turno → 403; `state` con una versión vieja → 409
- `turnos`: `turn` hacia un id inexistente → 422; `/turn` de alguien que no es anfitrión → 403
- `presentador` sin ceder: un `state` de alguien que no es anfitrión → 403
- ceder con `"once"` a B: B escribe; B manda `turn` = C → 422; B manda `turn` = anfitrión →
  `lend` queda en `None` y el siguiente `state` de B → 403
- ceder con `"always"` a B: B escribe varias veces seguidas; el anfitrión recupera con `/turn` y
  luego un `state` de B → 403
- el anfitrión puede escribir aunque el control esté cedido
- más de 8 jugadores → error; nombre vacío o de más de 24 caracteres → 422; blob de más de
  50 KB → 413
- `since == version` devuelve el estado sin `state`

En el frontend no hay tests (no hay runner). La lógica de `endTurn` (siguiente jugador conectado,
volver al anfitrión) va en una **función pura** dentro de `room.tsx` para que sea fácil de
revisar.

## Docs (en el mismo cambio)
- `docs/05_API.md`: los 5 endpoints `/rooms`.
- `docs/03_FRONTEND.md`: en "Juegos de práctica", explicar las salas, `useShared`, `RoomProvider`
  y el campo `room` en `GAMES`. Añadir a "Añadir un juego" que, para que admita sala, use
  `useShared` y llame a `endTurn`.
- `docs/15_DECISIONS.md`: un ADR nuevo sobre salas en memoria con polling de 1 s (un worker, como
  `live.py`), autoridad en el cliente, `useShared` en vez de transmitir el DOM (con el DOM, quien
  recibe el control no tendría el estado) y la exclusión de Contrarreloj.
- `docs/14_GLOSSARY.md`: **sala**, **anfitrión**, **ceder el control**.
- `docs/13_ROADMAP.md`: las salas, y como pendientes los WebSockets (si la latencia molesta) y el
  modo libre.

## Verificación
`python -m pytest backend/tests`, `npm run lint` y `npm run build`. Después, una prueba manual
con dos pestañas en Memorama, Ruleta, Bingo y Escucha: crear sala, unirse, jugar por turnos,
ceder "un turno" y "sin limite", recuperar el control y recargar con F5 sin perder la sala.

## Fuera de alcance (a propósito)
- El modo "libre" (todos tocan a la vez).
- WebSockets.
- Persistir salas en la BD: un reinicio de Render las borra, igual que pasa en `live.py`.
- Contrarreloj.
