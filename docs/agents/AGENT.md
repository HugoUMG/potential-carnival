# Instrucciones para agentes

Independiente del modelo y de la herramienta. Cualquier agente que trabaje en este repositorio sigue
esto.

## 1. Lee primero, siempre

1. [`docs/00_OVERVIEW.md`](../00_OVERVIEW.md) — qué es el proyecto.
2. [`docs/01_ARCHITECTURE.md`](../01_ARCHITECTURE.md) — cómo encajan las piezas.
3. [`docs/12_RULES.md`](../12_RULES.md) — **las reglas duras. No negociables.**

Nada más. **No cargues toda la documentación**: el resto se abre según la tarea.

## 2. Carga según la tarea

| La tarea toca… | Abre |
|----------------|------|
| Endpoints, permisos, calificación | `02_BACKEND.md`, `05_API.md` |
| React, portales, editor | `03_FRONTEND.md` |
| Tablas, queries, migraciones | `04_DATABASE.md` |
| Prompts, generación o calificación por IA | `06_AI.md` |
| Sintaxis del DSL, parser, tipos de actividad | `07_DSL.md` |
| Cómo se pinta y se resuelve una actividad | `08_RENDERER.md` |
| Auth, roles, JWT, Google | `09_SECURITY.md` |
| Variables, Render, arranque local | `10_DEPLOYMENT.md` |
| Tests | `11_TESTING.md` |
| Qué falta o está en curso | `13_ROADMAP.md` |
| Un término desconocido | `14_GLOSSARY.md` |
| "¿Por qué está hecho así?" antes de proponer un cambio | `15_DECISIONS.md` |

## 3. Reglas que valen para cualquier tarea

- **Nunca `DROP TABLE` ni `DROP COLUMN`.** La base está en producción con datos reales.
- **Importar `backend.app` carga el `.env` real.** Si apunta a Aiven, cualquier escritura desde un
  script o un test va a **producción**. Borrar `DATABASE_URL` del entorno del proceso no basta.
- **La documentación está por dominio.** Si añades algo, va en su archivo. No vuelvas a acumular todo
  en un solo documento y no crees un cuarto sitio que enseñe el DSL.
- **Si tocas un campo o un tipo de actividad, recorre la cadena completa** (parser → domain → models
  → types.ts → api.ts → renderer → serializador visual → impresión → docs → test). Saltarse un paso
  hace que se pierda **en silencio**. La lista está en `08_RENDERER.md`.
- **No inventes endpoints, campos ni tipos.** La lista canónica de tipos es `SUPPORTED_BLOCKS` en
  `backend/app/parser.py`; la de endpoints, `backend/app/main.py`.
- **Verifica antes de afirmar.** Esta documentación describe el estado en la fecha de cada archivo:
  si vas a apoyarte en un detalle concreto (un nombre de función, un flag, una columna), compruébalo
  en el código.
- **Ante una ambigüedad que cambie el resultado, pregunta.** Ante una que no, decide, dilo y sigue.

## 4. Al generar una hoja de trabajo

- Entregar **solo el DSL en el chat**, sin crear un archivo aparte.
- Validar mentalmente contra `07_DSL.md`: un campo por línea, toda actividad dentro de un `block {}`
  si existe alguno, `info {}` con strings planos, comillas tipográficas.
- Aplicar la **guía de calidad** ([`07_DSL.md` §14](../07_DSL.md#14-guía-de-calidad-al-generar-hojas)):
  distractores plausibles, sin patrones predecibles, sin revelar respuestas, nivel coherente.
- El contenido que el alumno lee o responde va **en inglés**; `title`, `description` e `instructions`
  pueden ir en español.

## 5. Antes de dar por terminada una tarea

### 5.1 Actualiza la documentación del dominio que tocaste

Si el cambio **altera comportamiento**, la documentación se actualiza **en el mismo cambio**, no
"después". Si no aplica ningún documento, **dilo explícitamente** en vez de callarlo.

| Tocaste… | Actualiza |
|----------|-----------|
| `parser.py`: tipo, campo o validación | [`07_DSL.md`](../07_DSL.md) + `_WORKSHEET_SYSTEM` (`ai.py`) + `GENERATION_PROMPT` (`generationPrompt.ts`) |
| Un endpoint (nuevo, borrado o con otro contrato) | [`05_API.md`](../05_API.md) |
| Tabla, columna, índice o migración | [`04_DATABASE.md`](../04_DATABASE.md) |
| Prompts o lógica de IA | [`06_AI.md`](../06_AI.md) |
| Renderer o componente de actividad | [`08_RENDERER.md`](../08_RENDERER.md) |
| Auth, roles o permisos | [`09_SECURITY.md`](../09_SECURITY.md) |
| Variable de entorno o despliegue | [`10_DEPLOYMENT.md`](../10_DEPLOYMENT.md) |
| Cerraste o abriste un pendiente | [`13_ROADMAP.md`](../13_ROADMAP.md) |
| Descartaste una alternativa por un motivo que no se lee en el código | [`15_DECISIONS.md`](../15_DECISIONS.md) |

Un término propio nuevo va a [`14_GLOSSARY.md`](../14_GLOSSARY.md); una regla dura nueva, a
[`12_RULES.md`](../12_RULES.md).

**Qué NO documentar:** un refactor sin cambio de comportamiento, un arreglo de estilo, o algo que ya
se lee igual de bien en el código. La documentación cuenta lo que el código no puede contar solo.

### 5.2 Verifica

```bash
python -m pytest backend/tests
```

```bash
npm run lint
```

```bash
npm run build
```

Si algo falla, dilo con la salida. No reportes como hecho lo que no se verificó.

## 6. Estilo de trabajo

- **La solución más simple que funcione.** Antes de añadir una dependencia, comprueba que la
  biblioteca estándar o algo ya instalado no lo resuelve — este proyecto lee `.env` con seis líneas y
  valida un ID token con `httpx` a propósito.
- **Escribe código que se parezca al de alrededor**: misma densidad de comentarios, mismos nombres,
  mismos modismos.
- **Marca las simplificaciones deliberadas** con un comentario `ponytail:` que nombre el límite y el
  camino de mejora.
- **Menos archivos, diff más corto.** Borrar es mejor que añadir.
