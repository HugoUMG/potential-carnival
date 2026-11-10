# Spot de MyDinoEnglish

Spot promocional de **50 segundos**, generado con código y con los assets reales del
proyecto. No hay editor de vídeo ni material de stock: cada fotograma se pinta en un
`<canvas>` de 1920×1080 y la música se sintetiza con Web Audio.

## Entregables

| Archivo | Qué es |
|---------|--------|
| `spot.mp4` | Vídeo final: 1920×1080, 30 fps, H.264 + AAC, 50 s. |
| `spot-ligero.mp4` | El mismo vídeo con `--mbps 0.8` (≈15 MB), para subidas con límite de tamaño. |
| `index.html` | Reproductor interactivo con timeline, mute y descarga. |
| `spot.wav` | Pista de audio suelta para revisión (48 kHz, estéreo, 16 bit). |
| `stills/` | Fotogramas de control generados con `--stills`. |

Los MP4 y `spot.wav` son artefactos generados; no hacen falta para editar el spot.

## Ver el spot

El reproductor necesita un servidor local (los módulos ES y `fetch` no funcionan con
`file://`). Desde la raíz del repo:

```bash
npm run dev
```

Abre `http://localhost:5173/design/spot/` y pulsa play. El botón **Descargar MP4**
abre el render en otra pestaña (≈1–2 min) y el navegador descarga `spot.mp4`. Para que se
guarde directamente en `design/spot/spot.mp4`, usa `node render.mjs` (ver abajo).

Para una vista previa rápida sin el reproductor, abre directamente `spot.mp4`.

## Regenerar

Requisitos:

- Node.js 20 o superior.
- Chrome o Edge con WebCodecs (H.264 y AAC).
- Ninguna dependencia npm adicional: `mp4-muxer` está vendorizado.

Desde `design/spot`:

```bash
# Exportar el MP4 (tarda ~1–2 min)
node render.mjs

# Versión ligera (≈15 MB) en spot-ligero.mp4. El codificador de Chrome se pasa del
# bitrate pedido: 0.8 da ≈2,4 Mbps reales, 1.8 da ≈3,4 (21 MB)
node render.mjs --mbps 0.8

# Solo audio, para revisar niveles
node render.mjs --audio

# Fotogramas sueltos en stills/
node render.mjs --stills 1,8.5,15,30.8,49.5
```

`render.mjs` levanta un servidor local, lanza Chrome en modo headless y espera a que el
navegador codifique y envíe el archivo. Si Chrome no está en una ruta estándar, define
`CHROME_PATH`. El perfil temporal se crea en `.chrome-profile/`.

Si el Chrome headless se queda en «Sintetizando música…» y vence el tiempo (pasó en Windows
en nov. 2026), deja `render.mjs` corriendo y abre la misma URL en un Chrome normal:
`http://127.0.0.1:4178/design/spot/index.html?export=1` (añade `&mbps=0.8` para la ligera).
El archivo se guarda igual en `design/spot/`.

## Dónde se toca

| Archivo | Responsabilidad |
|---------|-----------------|
| `js/util.js` | Constantes (`DURATION`, `FPS`, `W`, `H`), paleta, dibujo y fondo común. |
| `js/assets.js` | Carga de fuentes locales y assets reales de `public/`. |
| `js/scenes.js` | Las 8 escenas, su composición y el montaje/transiciones. |
| `js/audio.js` | Música y SFX sintetizados (120 BPM, 25 compases). |
| `js/main.js` | Reproductor, exportación MP4/WAV y envío al servidor. |
| `render.mjs` | Servidor local + lanzador de Chrome para renderizar. |

Para cambiar la duración, edita `DURATION` en `js/util.js` y revisa los tiempos de
`SCENES` y de las transiciones en `js/scenes.js`. El render usa exactamente
`DURATION * FPS` fotogramas.

## Assets reales usados

- Mascota: `public/mascot/rex-wave.svg`, `rex-happy.svg`, `rex-hero.svg`,
  `rex-thinking.svg`.
- Capturas del editor: `public/shots/editor-ia.webp`, `editor-visual.webp`,
  `editor-dsl.webp`.
- Marca y paleta: `public/mascot/rex-logo.svg` y `tailwind.config.js`.

## Comprobaciones

Última exportación verificada:

- Duración: 50,005 s.
- Vídeo: 1920×1080, 30 fps, `avc1` (H.264).
- Audio: AAC, 48 kHz, 2 canales.
- Pico de audio: −1,0 dBFS; sin muestras recortadas.
- 1.500 fotogramas de vídeo y pista de audio completa.
- `spot-ligero.mp4`: 14,7 MB, misma duración y códecs.

## Documentación

Este cambio no altera el comportamiento de la aplicación: es un asset promocional
aislado en `design/spot/`. Por eso no se actualizaron los documentos de dominio de
`docs/`.
