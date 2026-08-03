# 16 — Selección de modelo

Cómo elegir qué modelo ejecuta cada tarea, según el tipo de razonamiento que pide y el presupuesto
disponible. Hay **dos canales de pago distintos**; cada uno tiene su aritmética y no deben mezclarse.

## Los dos canales

| Canal | Costo | Naturaleza | Para |
|-------|-------|-----------|------|
| **Claude Code** (subscription plana) | Fijo al mes, no por petición | El razonamiento caro "no cuesta" dentro del canal | Diseño, decisiones, review, implementación dura |
| **OpenCode Go** | Limitado en dólares: US$12 / 5 h, US$30 / semana, US$60 / mes | Medido por petición y por modelo | Todo el trabajo diario, todo el código |

**Regla estructural: el razonamiento caro no se paga dos veces.** Claude tiene cómputo plano: se usa
también para escribir el código difícil, no solo para pensar. No reserves los modelos caros de
OpenCode Go para cosas que Claude hace en su plan sin gastar el presupuesto de Go.

## Modelos de OpenCode Go — peticiones por mes con el presupuesto mensual US$60

El **costo relativo** es `158.1k ÷ peticiones/mes` (base = DeepSeek V4 Flash, el más barato).

| Modelo | Pet/mes | Costo relativo | Uso |
|--------|---------|---------------|-----|
| DeepSeek V4 Flash | 158 k | ×1 | Orquestar, mecánico, CRUD, boilerplate |
| Qwen3.7 Plus | 21.6 k | ×7 | Lógica de negocio de 4-10 archivos |
| MiniMax M3 | 16 k | ×10 | Ídem, con más presupuesto por petición |
| DeepSeek V4 Pro | 17 k | ×9 | Lógica de mayor precisión |
| Qwen3.7 Max | 1.7 k | ×95 | Feature grande que cruza varias capas |
| GLM-5.2 | 4.3 k | ×37 | Feature grande multicapa; alternativa a Kimi K3 con ~9× más margen |
| Kimi K3 | 0.5 k | ×322 | **Solo** fallback comprobado: ≈2-3 features grandes al mes |
| Grok 4.5 | 0.6 k | ×264 | Ídem, margen parecido de escasez |

## Reglas de enrutado

| Complejidad | Alcance | Modelo |
|------------|---------|--------|
| **Baja** | 1-3 archivos, trabajo mecánico | DeepSeek V4 Flash o Qwen3.7 Plus |
| **Media** | 4-10 archivos, un solo dominio | Qwen3.7 Plus / DeepSeek V4 Pro / MiniMax M3 |
| **Alta** | 10+ archivos, o backend + frontend + base de datos, o DSL + IA + renderer | GLM-5.2 / Qwen3.7 Max · Kimi K3 solo si un modelo barato ya falló |
| **Diseño / decisión / review / feature dura** | Pensar, elegir alternativas, juzgar calidad | Claude Code (plan) |

### Cómo se aplica en la práctica

1. El **orquestador** (DeepSeek V4 Flash) clasifica la tarea y elige el modelo con esta tabla.
2. Rellena la plantilla de prompt correspondiente ([`docs/prompts/`](prompts/README.md)).
3. Si el resultado del modelo barato se queda corto, **se sube de nivel**, no se repite igual.
4. Ante la duda, asumir la complejidad menor: subir de modelo es barato; gastar un modelo caro en
   una tarea simple no tiene vuelta atrás.

## Reglas duras

- **Nunca gastar un modelo caro en algo que uno barato resuelve.** Kimi K3 y Grok 4.5 son presupuesto
  escaso: se reservan para el caso donde el modelo barato ya demostró que no llega.
- **El enrutado lo decide el orquestador, no el usuario.** Si el usuario pide explícitamente un
  modelo, se obedece; si no, se aplica esta tabla.

## Cuándo cambiar esta tabla

Depende del catálogo y precios de OpenCode Go y de Claude, que cambian. Es una tabla de configuración:
si cambian los precios, se actualiza **aquí**, en el mismo cambio. Nada en el código la enlaza, y no
debe volverse a copiar en otro documento.
