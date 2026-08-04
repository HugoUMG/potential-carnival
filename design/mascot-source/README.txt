RexLearn — arte fuente de la mascota (DinoEnglish Studio)
=========================================================

Esta carpeta NO se despliega (vive fuera de public/). Guarda los originales por si hay
que reprocesar las poses o sacar una nueva.

Fuente vectorial vieja (SVG, 1024x1024, grilla 2x2 sobre fondo NEGRO) — hoy solo queda
viva para rex-wave.svg, el resto se reemplazo por cutouts de IA (ver mas abajo):
  - "file (2).svg"
        TL: pulgar arriba (SIN USAR)   TR: saludando
        BL: tumbado llorando (SIN USAR)    BR: pensativo (SIN USAR)
  - "file (1).svg"
        TL: guino/contento (SIN USAR)  TR: saltando de alegria (SIN USAR)
        BL: sentado triste (SIN USAR)  BR: llorando (SIN USAR)

Los PNG (las dos grillas y LOGO.png) son el arte previo al trazado vectorial; se
conservan como referencia. LOGO.png es la silueta que sigue viva en
public/mascot/rex-logo.png (logo del menu, cabecera de impresion y favicon): es pieza
aparte, no una pose, y no tiene version SVG.

Derivados en public/mascot/ y donde se usan:
  rex-hero.svg      dino de pie sonriendo -> Login, registro e inicio (imagen grande)
  rex-wave.svg      saludando          -> Navbars (alumno, profesor, lector, /vocab)
  rex-thinking.svg  pensativo, mano en el menton -> Pantallas de carga y confirmacion de envio
  rex-happy.svg     brazos arriba celebrando -> Tarjeta de resultado al aprobar (>=70)
  rex-sad.svg       llorando de pie    -> Tarjeta de resultado al no aprobar

rex-hero.svg, rex-thinking.svg, rex-happy.svg y rex-sad.svg son cutouts de PNG generados
por IA (recortados a fondo transparente, sin sombra — los originales traen fondo crema y
una sombra ovalada que se ve mal en modo oscuro) guardados aqui como
"rex-{pose}-cutout.png", incrustados como base64 dentro de un <image> del propio SVG. Se
incrustan en vez de referenciarse como archivo aparte porque un SVG cargado via <img src>
(como hace RexMascot) no puede resolver referencias externas a otro archivo raster.
Solo rex-wave.svg sigue viniendo del trazado vectorial de mas abajo.

Como se regenera un cutout nuevo (rex-hero, rex-thinking, rex-happy, rex-sad):
  1. Recortar el fondo a transparente con flood fill desde los bordes (tolerancia de
     color generosa para tragarse tambien la sombra ovalada) + un feather de ~1px en el
     canal alfa para que el borde no quede dentado.
  2. Recortar al bounding box del contenido y centrarlo en un lienzo cuadrado con ~6% de
     margen transparente.
  3. Incrustar el PNG resultante como base64 en un <svg><image .../></svg> del mismo
     tamano cuadrado.

Como se regenera rex-wave.svg (el unico que sigue en el pipeline viejo):

  node scripts/mascots.mjs

El script abre cada SVG en Chrome headless, tira el path del fondo negro, reparte los
demas por cuadrante segun su bounding box, descarta las motas sueltas lejos del cuerpo,
recorta al contenido centrado en un viewBox CUADRADO (asi todas las poses se ven del
mismo tamano aunque una este sentada y otra de pie) y redondea las coordenadas a 1
decimal. El mapa cuadrante -> pose esta en SOURCES, al principio del script: ahi se
agrega una pose nueva.

Para usarla en la app basta con anadirla a RexMood en src/components/RexMascot.tsx;
el componente arma la ruta /mascot/rex-{mood}.svg y esconde la imagen si falta.
