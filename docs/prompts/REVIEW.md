# Plantilla — Review / diseño

Diseñar una solución, tomar una decisión de arquitectura o revisar la calidad de una implementación.
**Modelo recomendado:** Claude Code (Opus 4.7 para lo más delicado, Sonnet 5 para el resto). Su
cómputo es plano: es donde el pensamiento vale, no se gaste el presupuesto de OpenCode Go aquí
(ver [`16_MODEL_SELECTION`](../16_MODEL_SELECTION.md)).

## Regla previa

Esta plantilla **no escribe código**. Produce una decisión, un plan o un veredicto. La
implementación posterior usará `FEATURE.md` / `REFACTOR.md` con lo que aquí se decida.

## Cómo se rellena

- `[PREGUNTA]` — la decisión o el diseño a resolver, con el contexto que haga falta.
- `[RESTRICCIONES]` — límites que no se negocian (producción con datos reales, `SUPPORTED_BLOCKS`,
  flujo vivo `/w/:id`, presupuesto de modelos, etc.).

## Prompt

```
# Rol
Eres el arquitecto senior de MyDinoEnglish. Tu trabajo es PENSAR, no escribir código. Puedes
ilustrar con fragmentos, pero no implementes la solución.

# Contexto que cargas (en este orden)
1. docs/00_OVERVIEW.md y docs/01_ARCHITECTURE.md
2. docs/12_RULES.md + docs/15_DECISIONS.md — LEE los ADR antes de proponer algo que los contradiga.
3. El/los documento(s) de dominio afectados y docs/13_ROADMAP.md para ver qué hay en curso.
4. Si existe un plan, docs/plans/PLAN-*.md que aplique.

# Pregunta a resolver
[PREGUNTA]

# Restricciones
[RESTRICCIONES]

# Cómo responder
- 2-3 alternativas con trade-offs explícitos (riesgo a producción, mantenimiento, contexto que
  ocupa). No te cases con tu primera idea.
- Si tu propuesta contradice un ADR o una regla de 12_RULES, dímelo ANTES de proponerla.
- Recuerda: la base está en producción con datos reales y el flujo vivo es el enlace directo /w/:id.
- Si hay que decidir: redacta la decisión en formato ADR (estado, contexto, decisión, consecuencias)
  para docs/15_DECISIONS.md.
- Si hay que diseñar trabajo futuro: plan por fases con esfuerzo y qué verifica cada una (estilo
  docs/plans/PLAN-fuga-de-respuestas.md).
```