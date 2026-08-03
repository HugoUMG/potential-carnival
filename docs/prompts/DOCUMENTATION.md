# Plantilla — Documentación

Escribir o actualizar `docs/`. **Modelo recomendado:** Claude Code — la coherencia entre dominios
pide ver varios documentos (ver [`16_MODEL_SELECTION`](../16_MODEL_SELECTION.md)).

## Regla de fondo

La documentación cuenta **lo que el código no puede contar solo**: decisiones, motivos, límites,
glosario. Un refactor sin cambio de comportamiento, un arreglo de estilo o algo que ya se lee igual
de bien en el código **no se documenta** (`docs/agents/AGENT.md` §5.1).

## Mapa de documentos

| Tema | Documento |
|------|-----------|
| Visión general, módulos, índice | `docs/00_OVERVIEW.md` |
| Arquitectura | `docs/01_ARCHITECTURE.md` |
| Backend / API / BD / IA / DSL / Renderer / Seguridad | `docs/02`, `05`, `04`, `06`, `07`, `08`, `09` |
| Frontend | `docs/03_FRONTEND.md` |
| Despliegue | `docs/10_DEPLOYMENT.md` |
| Testing | `docs/11_TESTING.md` |
| Reglas duras | `docs/12_RULES.md` |
| Roadmap / Glosario / Decisiones | `docs/13`, `14`, `15` |
| Selección de modelo | `docs/16_MODEL_SELECTION.md` |
| Regla de cierre y carga por tarea | `docs/agents/AGENT.md` |

## Cómo se rellena

- `[TEMA]` — qué tocar: dominio, glosario, decisión, roadmap.
- `[VERDAD]` — el estado real que se va a reflejar, **verificado en el código** antes de escribir.

## Prompt

```
# Rol
Eres el documentador de MyDinoEnglish. Escribes en el idioma de los docs (español), con el estilo
de los archivos existentes (tablas, marcadores 🟢/🟠 en decisiones, estado con fecha).

# Contexto que cargas
1. docs/00_OVERVIEW.md (para el tono y la nomenclatura)
2. El/los documento(s) que vas a tocar y los archivos de código que respaldan lo que escribirás.

# Tema
[TEMA]

# Estado real (verificado)
[VERDAD — con archivo:línea cuando aplique]

# Reglas
- Documentación POR DOMINIO: cada cosa en su archivo. No crees un cuarto sitio que enseñe lo mismo
  (regla 36 y regla 21 de 12_RULES).
- Un término propio nuevo va a docs/14_GLOSSARY.md; una decisión descartada o tomada, a
  docs/15_DECISIONS.md en formato ADR; un pendiente cerrado o abierto, a docs/13_ROADMAP.md.
- Si el cambio toca reglas de comportamiento de agentes, reflejarlo en docs/agents/AGENT.md.
- Verifica antes de afirmar: no describas funciones, flags o columnas que no existen en el código.
- No traduzcas el contenido evaluable (inglés) ni cambies la terminología existente.

# Entregables
1. Documento(s) actualizado(s), diff mínimo.
2. Un índice de qué cambió y en qué archivo.
```
