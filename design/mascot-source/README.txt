RexLearn — arte fuente de la mascota (DinoEnglish Studio)
=========================================================

Esta carpeta NO se despliega (vive fuera de public/). Guarda los originales por si hay
que reprocesar las poses o sacar una nueva.

Originales (1024x1024, grillas 2x2 con fondo NEGRO puro; LOGO.png ya trae alfa):
  - "pulgar arriba, saludando, encogido lloranndo, pensativo.png"
        TL: pulgar arriba              TR: saludando
        BL: encogido llorando (SIN USAR)   BR: pensativo
  - "1 feliz, 1 contento, una triste y una llorando.png"
        TL: feliz/guino (SIN USAR)     TR: contento/bailando
        BL: triste sentado             BR: llorando (SIN USAR)
  - LOGO.png  -> silueta negra, ya con transparencia

Derivados en public/mascot/ (512x512 PNG transparente) y donde se usan:
  rex-hero.png      pulgar arriba      -> Login (imagen grande)
  rex-wave.png      saludando          -> Navbars (alumno, profesor, lector, /vocab)
  rex-thinking.png  pensativo          -> Pantallas de carga y overlay al enviar
  rex-happy.png     contento/bailando  -> Tarjeta de resultado al aprobar (>=70)
  rex-sad.png       triste sentado     -> Tarjeta de resultado al no aprobar
  rex-logo.png      silueta            -> Favicon

Como se procesaron (Pillow + numpy):
  1. Recorte del cuadrante (1024/2 = 512 por pose).
  2. Quitar el fondo con flood-fill DESDE LOS BORDES, no con un umbral global: un umbral
     global borraria tambien los ojos oscuros y la panza clara del dino.
  3. Quedarse solo con el componente conectado mas grande -> elimina las lineas de
     emocion y las motas sueltas que flotan alrededor del personaje.
  4. Recorte al contenido + centrado en lienzo cuadrado + resize a 512.
  El LOGO no lleva knockout: ya tiene alfa. Ojo: convertirlo a RGB lo compone sobre negro
  y parece que el fondo fuese negro solido; hay que usar su alfa original.

Si se agrega una pose nueva: procesarla igual, dejarla en public/mascot/ y referenciarla
con <img src="/mascot/..."> + onError que la oculte (asi no rompe si falta el archivo).
