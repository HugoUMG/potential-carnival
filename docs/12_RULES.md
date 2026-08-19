# 12 — Reglas del proyecto

Reglas duras. Si una de estas se rompe, algo se cae en producción o alguien pierde datos.
El *por qué* de las que no son obvias está en [15_DECISIONS](15_DECISIONS.md).

---

## Base de datos

1. **NUNCA `DROP TABLE` ni `DROP COLUMN`.** La base está en producción con datos reales.
2. Toda migración es **idempotente** y vive en el schema: `CREATE TABLE IF NOT EXISTS`,
   `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
3. **`db/schema.sql` (SQLite) y `db/schema.postgres.sql` se mantienen en paralelo.** Una tabla que
   solo esté en uno revienta en el otro entorno.
4. **Ids siempre UUID v4**, columna `TEXT`. Nunca autoincremento.
5. Fechas en **UTC**. Booleanos: `BOOLEAN` en Postgres, `INTEGER` 0/1 en SQLite.
6. `due_date` es nullable — no asumir que existe.
7. **Todo el SQL vive en `repository.py`.** `main.py` no escribe queries.
8. Nada de `executemany` sobre la conexión de psycopg (solo existe en el cursor).

## Backend

9. **Todo endpoint nuevo lleva una dependencia de auth**, salvo que sea `/public/*` y solo exponga
   contenido publicado.
10. Contraseñas **siempre** con `security.hash_password()` (PBKDF2-SHA256). Nunca texto plano.
11. **Todo lo que deba funcionar sin login va en `/public/*`** — lo usan el modo invitado y el enlace
    directo `/w/:id`.
12. **La calificación no confía en el cliente:** `_build_answer_details` relee la clave desde
    `worksheets.json_content` en la base.
13. **No añadir un endpoint que devuelva claves de respuestas a un cliente no autenticado.**
14. Cada endpoint declara su `response_model`. El contrato es `models.py`.
15. Errores como `HTTPException` con mensaje **en español**.
16. **Antes de añadir una dependencia**, comprobar que la biblioteca estándar o algo ya instalado no
    lo resuelve. El proyecto valida un ID token con `httpx` y lee `.env` con seis líneas a propósito.

## Parser y DSL

17. **La lista canónica de tipos es `SUPPORTED_BLOCKS`** en `parser.py`. Un tipo fuera de ella se
    ignora en silencio.
18. **Mantener retrocompatibilidad:** las hojas sin `block {}` deben seguir funcionando.
19. **Un tipo nuevo necesita su regla en `_activity_problem`.** Sin ella, una actividad imposible de
    responder se guarda sin error y el alumno se la encuentra rota.
20. **Un campo nuevo de actividad hay que añadirlo en los cinco sitios**: `parser.py`, `domain.py`,
    `models.py`, `src/types.ts` y `normalizeActivity`/`withInstructions` en `services/api.ts`. Si
    falta uno, se descarta en silencio al persistir o al leer.
21. **Los tres sitios que enseñan el DSL se sincronizan a la vez:** [07_DSL](07_DSL.md),
    `_WORKSHEET_SYSTEM` (`ai.py`) y `GENERATION_PROMPT` (`src/utils/generationPrompt.ts`).
    No crear un cuarto resumen del DSL.
22. Los `listening*` usan **TTS**: nunca un campo `audio:`, nunca archivos de audio.

## Frontend

23. **Modo oscuro: no se toca el JSX.** Se añade una regla al bloque `:root[data-theme='dark']` de
    `app.css` repintando la clase de Tailwind que la pantalla ya usa. Nada de props `theme` ni de
    `useTheme()` en componentes de pantalla.
24. **Las secciones del portal son rutas, no estado.** Para añadir una: `TEACHER_SECTIONS` en
    `App.tsx` **y** `GROUPS` en `TeacherDashboard.tsx`.
25. **Todas las llamadas HTTP pasan por `src/services/api.ts`.** Ningún componente hace `fetch`.
26. Toda pantalla que dependa de la primera consulta muestra `LoadingScreen`/`Spinner` — la base
    tarda.
27. Textos de interfaz en **español**; el contenido evaluable de las hojas, en **inglés**.
28. `npm run build` debe quedar limpio. `npm run lint` arrastra 18 errores heredados: **no añadir
    errores nuevos** (ver [11_TESTING](11_TESTING.md)).

## Contenido de las hojas

29. **Los distractores deben ser plausibles** y del mismo tipo que la respuesta correcta.
30. **Nada de patrones predecibles**: variar la respuesta correcta entre ítems, mezcla irregular en
    true/false, no agrupar de forma que se pueda acertar sin saber.
31. **El `content` de repaso no puede contener ninguna respuesta de los ejercicios.**
32. Un campo del DSL **por línea**. Comillas internas tipográficas `“ ”`.
33. **En conversaciones y listening, las únicas voces de niño son Ana y Roger**
    (`en-US-AnaNeural` niña / `en-US-RogerNeural` niño). Otras infantiles del catálogo de Azure no se
    ofrecen en los selectores; en el DSL solo por nombre literal, y el endpoint de Edge no sirve
    todas (p. ej. `en-GB-OliverNeural` falla).

Detalle completo en [07_DSL §14](07_DSL.md#14-guía-de-calidad-al-generar-hojas).

## Trabajo con agentes

34. **Al pedir el usuario una hoja de trabajo: entregar solo el DSL en el chat**, sin crear un archivo
    aparte.
35. **Importar `backend.app` carga el `.env` real.** Si apunta a Aiven, cualquier escritura desde un
    script o un test va a **producción**. Borrar `DATABASE_URL` del entorno no basta.
36. **No borrar ni tratar como inexistente `speaking`**: está implementado en sus dos modos. Las notas
    históricas que dicen lo contrario están obsoletas.
37. Documentación: cada dominio en **su** archivo de `docs/`. No volver a acumular todo en un solo
    documento.

---

## Antipatrones ya cometidos (no repetir)

| Error | Consecuencia real |
|-------|-------------------|
| Dos campos del DSL en la misma línea | El primero se traga el segundo; la actividad queda sin pregunta ni respuesta, sin error |
| Actividad fuera de un `block {}` cuando la hoja tiene blocks | Desaparece en silencio |
| `- Texto` sin `\| true/false` en un true/false | La clave quedaba en `true` y marcaba mal a quien respondía bien |
| Calcular el ancho del input con SU respuesta esperada | El ancho delataba la longitud de la respuesta |
| Escapar el backslash antes que la comilla en `esc()` | Backslashes visibles para el alumno |
| Índice único `(worksheet_id, student_id)` | Rompía `max_attempts` > 1 e ilimitada |
| Excepción de visibilidad para `created_by IS NULL` | Cualquiera que se registrara veía y podía borrar alumnos ajenos |
| Añadir un campo solo en el parser | Se descartaba al persistir o al leer (pasó con `voice`) |
| Poner el reproductor de audio en `reading` | Convertía comprensión lectora en auditiva |
| Pasar `pitch=None` explícito a `edge_tts.Communicate` | `TypeError: pitch must be str` — cayó TODO el audio del sistema (edge-tts 7.2.8) |
