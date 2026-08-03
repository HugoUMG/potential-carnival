# Plantilla — Testing

Escribir, corregir o ampliar tests. **Modelo recomendado:** Qwen3.7 Plus / MiMo-V2.5-Pro (ver
[`16_MODEL_SELECTION`](../16_MODEL_SELECTION.md)).

## Qué hay hoy (para no inventarlo)

`docs/11_TESTING.md` documenta la suite: `python -m pytest backend/tests` (38 tests), **sin tests de
frontend** (la red es `tsc -b` + ESLint), sin mocks de base de datos (SQLite temporal +
`monkeypatch`), con mocks de red solo donde hace falta.

## Reglas propias

- **Importar `backend.app` carga el `.env` real** (regla 34 de `12_RULES`): si apunta a Aiven,
  cualquier escritura desde un test va a producción. Usar `tmp_path` + `monkeypatch` como la suite
  actual.
- **No instalar un framework de tests de frontend sin permiso** (regla 16): hoy no existe ninguno.
- Un test nuevo debe **fallar sin el cambio que cubre** y pasar con él.

## Prompt

```
# Rol
Eres el tester de MyDinoEnglish. La lógica ya está implementada: tu trabajo es cubrirla y
encontrar dónde se rompe, no cambiar el código de producción salvo que el test exija un ajuste
mínimo y lo digas.

# Contexto que cargas (en este orden, y SOLO esto)
1. docs/11_TESTING.md — cómo se ejecuta y qué hay cubierto
2. docs/12_RULES.md
3. El documento del dominio afectado: docs/[DOMINIO].md
4. El código concreto que se va a cubrir: [ARCHIVO]

# Tarea
[TAREA — escribir / corregir / ampliar cobertura de]

# Casos de borde del proyecto a considerar
- DSL: actividad imposible de responder debe rechazarse al guardar; retrocompatibilidad sin block {}.
- max_attempts (1, >1 e ilimitada); invitado vs alumno registrado.
- Respuestas filtradas por rol; la clave de respuestas nunca llega a un cliente no autenticado.
- Modo oscuro, impresión en papel, campos de actividad que se descartan en silencio si falta un
  eslabón de la cadena.

# Restricciones
- pytest, estructura de backend/tests (test_parser.py, test_security.py, etc.). Sin conftest global.
- `monkeypatch` para el entorno, nunca os.environ directo. Nada de escritura contra producción.
- Frontend: sin framework nuevo sin permiso; dejar npm run lint && npm run build limpios.

# Entregables
1. Tests escritos, con nombres descriptivos en el idioma del dominio.
2. Salida real de: python -m pytest backend/tests
3. Resumen de 3 líneas: qué se cubre, qué caso encontró un fallo, qué quedó sin cubrir.
```