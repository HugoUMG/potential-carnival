# 11 — Testing

## Cómo se ejecuta

```bash
python -m pytest backend/tests
```

```bash
npm run lint
```

```bash
npm run build
```

Los tres, más `python -m compileall backend/app backend/tests`, son la verificación completa antes de
un commit grande. No hay CI que los ejecute: el único workflow de GitHub Actions es el respaldo
semanal de la base.

> **Estado real a 2026-08-01:** `pytest` pasa (38 tests). `npm run lint` **no** está limpio: reporta
> 18 errores y 6 avisos heredados (`no-explicit-any` en `VisualWorksheetBuilder.tsx` y
> `WorksheetEditor.tsx`, una variable sin usar en `activityRegistry.tsx`, un bloque vacío en
> `GuestPage.tsx`, dependencias de `useEffect`). La regla al trabajar es **no añadir errores nuevos**;
> dejarlo en cero es una tarea aparte ([13_ROADMAP](13_ROADMAP.md)).

## Qué hay cubierto

`pytest` sobre el backend, sin framework extra, sin `conftest` compartido, sin mocks de red salvo
donde hace falta. **No hay tests de frontend** (ni Vitest ni Playwright): el lint y `tsc -b` son la
red que hay.

| Archivo | Cubre |
|---------|-------|
| `test_parser.py` (356 líneas) | El DSL: parseo a JSON, orden de pares en `matching`, `listeningmatching` en sus **dos** formatos, las validaciones que rechazan una actividad imposible de responder, `statement {}` sin `answer`, `reading` sin preguntas y **`test_every_documented_type_parses`** |
| `test_grade_prompt.py` | El prompt de calificación: qué bloque de tolerancia elige `_grade_system`, el clamp del valor, que el cambio de pronombre esté permitido y que `matching` sea rescatable |
| `test_student_isolation.py` | `users.created_by`: el backfill del arranque, que un profesor nuevo no vea alumnos heredados, que no pueda administrarlos por id, el seed demo, y que sin ningún profesor el alumno quede sin dueño |
| `test_google_auth.py` | `/auth/google`: token válido, **503 sin `GOOGLE_CLIENT_ID` sin llamar a Google**, rechazo de claims inválidos (`aud`, `iss`, `email_verified`), 401 si Google rechaza |
| `test_security.py` | Que el hash no guarde texto plano y verifique; round-trip del JWT |
| `test_dotenv.py` | El parser de `.env`: UTF-8, la línea añadida en UTF-16 por PowerShell, que el entorno existente gane, y que la ausencia del archivo no sea error |

Además, un check de TypeScript que se corre a mano:

```bash
npx tsx scripts/check-dsl-serializer.ts
```

Verifica el round-trip del constructor visual → DSL (fue lo que detectó que `esc()` escapaba el
backslash antes que la comilla).

## El test que más protege

`test_every_documented_type_parses` escribe una hoja con **los 19 tipos** usando exactamente la
sintaxis que enseña [07_DSL](07_DSL.md) y comprueba que parsea. Si la documentación empieza a enseñar
algo que no funciona, ese test falla.

## Convenciones

- **Un archivo por dominio**, nombres de test descriptivos y en el idioma del dominio (los del
  parser en inglés, los de aislamiento y Google en español — no unificar por unificar).
- **Sin mocks de la base**: se usa SQLite temporal (`tmp_path` + `monkeypatch`), que es el mismo motor
  que el desarrollo local.
- **Las llamadas de red sí se mockean** (`test_google_auth` intercepta `httpx`). Ningún test toca
  Gemini, Groq ni Google de verdad.
- **`monkeypatch` para el entorno**, nunca `os.environ` directo: importar `backend.app` carga el
  `.env` real, y ese `.env` puede apuntar a producción.
- `pytest.mark.parametrize` para las tablas de casos (validaciones del parser, claims inválidos).

## Qué probar cuando se toca algo

| Si tocas… | Añade/actualiza |
|-----------|-----------------|
| `parser.py` (tipo o validación nueva) | Un caso en `test_parser.py`, y el tipo en `test_every_documented_type_parses` |
| El prompt de calificación | Un `assert` en `test_grade_prompt.py` sobre la regla concreta |
| Permisos o propiedad de recursos | `test_student_isolation.py` |
| Auth | `test_security.py` / `test_google_auth.py` |
| Frontend | No hay test: verificarlo en el navegador y dejar `npm run lint` y `npm run build` limpios |

Regla de fondo: **una lógica no trivial deja un check que falla si se rompe**. No hace falta una
suite por función.
