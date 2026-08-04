RexLearn — arte fuente de la mascota (DinoEnglish Studio)
=========================================================

Esta carpeta NO se despliega (vive fuera de public/). Guarda los originales por si hay
que reprocesar las poses o sacar una nueva.

Fuente vectorial vieja (SVG, 1024x1024, grilla 2x2 sobre fondo NEGRO) — SIN USAR, las 5
poses actuales vienen de cutouts de IA (ver mas abajo). Se conserva por si se quiere
volver a ese estilo o sacar una pose nueva de la misma grilla:
  - "file (2).svg"
        TL: pulgar arriba (SIN USAR)   TR: saludando (SIN USAR)
        BL: tumbado llorando (SIN USAR)    BR: pensativo (SIN USAR)
  - "file (1).svg"
        TL: guino/contento (SIN USAR)  TR: saltando de alegria (SIN USAR)
        BL: sentado triste (SIN USAR)  BR: llorando (SIN USAR)

Los PNG (las dos grillas y LOGO.png) son el arte previo al trazado vectorial; se
conservan como referencia. LOGO.png es la silueta que sigue viva en
public/mascot/rex-logo.png (logo del menu, cabecera de impresion y favicon): es pieza
aparte, no una pose, y no tiene version SVG.

Derivados en public/mascot/ y donde se usan (los 5, cutouts de IA):
  rex-hero.svg      dino de pie sonriendo -> Login, registro e inicio (imagen grande)
  rex-wave.svg      saludando con una mano -> Navbars (alumno, profesor, lector, /vocab)
  rex-thinking.svg  pensativo, mano en el menton -> Pantallas de carga y confirmacion de envio
  rex-happy.svg     brazos arriba celebrando -> Tarjeta de resultado al aprobar (>=70)
  rex-sad.svg       llorando de pie    -> Tarjeta de resultado al no aprobar

Cada uno viene de un PNG generado por IA (recortado a fondo transparente, sin sombra —
los originales traen fondo crema y una sombra ovalada que se ve mal en modo oscuro)
guardado aqui como "rex-{pose}-cutout.png", incrustado como base64 dentro de un <image>
del propio SVG. Se incrusta en vez de referenciarse como archivo aparte porque un SVG
cargado via <img src> (como hace RexMascot) no puede resolver referencias externas a
otro archivo raster.

Como se regenera un cutout (o se agrega una pose nueva con el mismo estilo):
  1. Recortar el fondo a transparente con flood fill desde los bordes (tolerancia de
     color generosa para tragarse tambien la sombra ovalada) + un feather de ~1px en el
     canal alfa para que el borde no quede dentado.
  2. Recortar al bounding box del contenido y centrarlo en un lienzo cuadrado con ~6% de
     margen transparente.
  3. Incrustar el PNG resultante como base64 en un <svg><image .../></svg> del mismo
     tamano cuadrado.
  4. Si es una pose nueva (no un reemplazo), agregarla a RexMood en
     src/components/RexMascot.tsx; el componente arma la ruta /mascot/rex-{mood}.svg y
     esconde la imagen si falta.

node scripts/mascots.mjs regenera desde la grilla vectorial vieja si algun dia se vuelve
a usar esa fuente; hoy ningun archivo de public/mascot/ depende de el.
