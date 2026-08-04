# Cambio 6 — Evaluaciones como tarjetas (prompt Claude)

Solicitud original: «Las evaluaciones guardadas como tarjetas estilo Netflix, con mini vista previa y
menú de 3 puntos, y edición aislada». **Decisiones del usuario** (en `docs/15_DECISIONS.md`):
- Vista de tarjetas con **mini vista previa** de la hoja + **menú de tres puntos** (⋮).
- Hacer clic en una tarjeta **abre el editor de ESA hoja aislado** (solo la hoja, sin el resto de la
  interfaz), en lugar del comportamiento actual.

Modelo recomendado: Claude Code (feature compleja de frontend). Plantilla base:
`docs/prompts/FEATURE.md`. Dominio: `03_FRONTEND` (+ `05_API` si el detalle lo pide).

---

## Prompt (copiar/pegar en Claude)

```
# Rol
Eres un ingeniero senior en MyDinoEnglish. La tarea está diseñada y delimitada: no la rediseñes,
no amplíes alcance, no refactorices código ajeno.

# Contexto que cargas (en este orden, y SOLO esto)
1. docs/00_OVERVIEW.md (solo el resumen) y docs/01_ARCHITECTURE.md
2. docs/12_RULES.md  ← reglas duras
3. docs/08_RENDERER.md y docs/03_FRONTEND.md
4. docs/15_DECISIONS.md (la decisión de las tarjetas)
Entra a main.py, repository.py y 07_DSL.md con Grep / Read(offset, limit): superan las 1000 líneas.

# Tarea
Rediseñar la sección «Evaluaciones guardadas» del portal del profesor (hoy lista de filas) como
tarjetas, y separar la edición.

[COMPORTAMIENTO]
1. Cada evaluación guardada se muestra como TARJETA con:
   - mini vista previa de la hoja (renderizada con WorksheetRenderer/WorksheetPrint en miniatura,
     sin interacción),
   - título, estado (draft/published/archived) y nº de actividades,
   - botón de menú «⋮» (tres puntos) con: Ver respuestas, Copiar enlace, Duplicar, Archivar/Borrar.
2. Clic en el cuerpo de la tarjeta (o en «Editar») abre el editor de ESA hoja en MODO AISLADO: una
   pantalla dedicada con SOLO el WorksheetEditor de esa hoja (sin dashboard, sin menú lateral), con
   botón para volver a la lista. No se crea copia: se edita la misma hoja.
3. La miniatura NO debe cargar el contenido interactivo ni sus scripts ni los audios de listening
   (aunque la hoja los tenga). Solo un render estático, ignorando audio y sin permitir responder.
4. El modo aislado reutiliza el estado de edición que hoy vive en App.tsx (editingWorksheetId,
   activeWorksheet, scriptDraft, etc.): al abrir una tarjeta se carga esa hoja, al volver se sale.

# Restricciones
- No cambies el contrato del backend salvo que sea estrictamente necesario; si añades/borras un
  endpoint, actualiza docs/05_API.md en el mismo cambio.
- La miniatura es solo visual: reutiliza los componentes existentes en modo readonly/no-audio; no
  inventes un mini-DSL.
- El flujo del alumno (/w/:id) no se toca.
- Modo oscuro solo por CSS (:root[data-theme='dark']). Textos de interfaz en español.
- Sin dependencias nuevas (regla 16). No instales librerías de tarjetas/carousel.

# Entregables
1. Código, diff mínimo, mismo estilo; comentarios `ponytail:` para simplificaciones deliberadas.
2. Documentación actualizada EN EL MISMO cambio: 03_FRONTEND.md y, si toca API, 05_API.md.
3. Verificación real, con salida: npm run lint && npm run build.
4. Resumen de 3-5 líneas: qué cambió, qué verificaste, qué queda pendiente.

# Aceptación
- La sección «Evaluaciones guardadas» muestra tarjetas con miniatura estática y menú ⋮ con las
  acciones listadas.
- Clic en una tarjeta abre el editor aislado de ESA hoja y vuelve a la lista sin perder el estado.
- La miniatura no reproduce audio ni permite responder. lint + build pasan.
```

---

## Notas del orquestador

- El editor aislado puede vivir como sub-vista dentro de App.tsx (adminMenu/estado) o como ruta
  nueva; decídelo tú según el menor cambio posible, y anótalo en el ADR.
- «Mini vista previa»: si renderizar la hoja en miniatura fuese muy caro por hoja, alternativa
  aceptable: tarjeta con el renderer en readonly dentro de un contenedor `scale-50`/`zoom`.
- Fases 1 y 2 del PLAN-fuga-de-respuestas (payload del alumno) NO bloquean esto: la miniatura usa el
  json que ya tiene el profesor.