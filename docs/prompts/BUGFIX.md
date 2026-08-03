# Plantilla — Bugfix

Corregir un bug. **Modelo recomendado:** DeepSeek V4 Flash / Qwen3.7 Plus (ver
[`16_MODEL_SELECTION`](../16_MODEL_SELECTION.md)).

## Regla previa

El orquestador **verifica la causa antes de delegar**: sin reproducción o causa localizada, el
prompt de bugfix se convierte en adivinar. Si no se puede localizar la causa, se usa la plantilla
de [`REVIEW.md`](REVIEW.md) para investigar antes.

## Cómo se rellena

- `[SINTOMA]` — qué hace hoy, qué debería hacer.
- `[CAUSA]` — archivo:línea de la causa si se conoce, con la cadena por la que se produjo.
- `[REGRESION]` — qué test o flujo verifica que la corrección no rompió nada alrededor.

## Prompt

```
# Rol
Eres un ingeniero senior en MyDinoEnglish. La causa del bug está localizada: corrígela sin
reabrir el diseño ni tocar código ajeno.

# Contexto que cargas (en este orden, y SOLO esto)
1. docs/00_OVERVIEW.md (solo el resumen)
2. docs/12_RULES.md
3. El documento del dominio afectado: docs/[DOMINIO].md
4. La sección "Antipatrones ya cometidos" de docs/12_RULES.md — comprueba que no es uno de ellos.

# Síntoma
[SINTOMA]

# Causa localizada
[CAUSA — archivo:línea y por qué produce el síntoma]

# Tarea
Corregir la causa. Sin parches a medias: si la corrección exige tocar la cadena completa
(parser → domain → models → types.ts → api.ts → renderer → serializador → impresión → docs → test),
tócala entera (regla 20).

# Restricciones
- No borres ni "arregles" cosas que no sean la causa. Diff mínimo.
- NUNCA DROP TABLE/COLUMN. Migraciones idempotentes.
- Textos de interfaz en español; contenido evaluable en inglés.

# Entregables
1. Código corregido con diff mínimo.
2. Test de regresión que falle sin la corrección y pase con ella (si la lógica es no trivial).
3. Verificación real: python -m pytest backend/tests  y/o  npm run lint && npm run build.
4. Resumen de 3 líneas: causa, corrección, qué verificaste.
```
