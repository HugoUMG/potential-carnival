/**
 * RexLearn — la mascota.
 *
 * Cada ánimo es un SVG en `public/mascot/rex-{mood}.svg`, cortado del arte vectorial de
 * `design/mascot-source/` con `node scripts/mascots.mjs`. Se cargan como <img>: pesan
 * ~150 kB cada uno, así que van por red (cacheados) y no dentro del bundle.
 *
 * Sustituye al dino que estaba dibujado a mano aquí en vectores, y antes de eso a los
 * PNG recortados. La API no cambió: mismos `mood` / `className` / `title`.
 *
 * El logo del menú y el favicon son otra pieza (`/mascot/rex-logo.png`, la silueta).
 */
export type RexMood = 'hero' | 'wave' | 'thinking' | 'happy' | 'sad';

export default function RexMascot({
  mood = 'hero',
  className = '',
  title,
}: {
  mood?: RexMood;
  className?: string;
  /** Texto accesible. Sin él la mascota es decorativa (aria-hidden). */
  title?: string;
}) {
  return (
    <img
      src={`/mascot/rex-${mood}.svg`}
      alt={title ?? ''}
      aria-hidden={title ? undefined : true}
      className={className}
      // ponytail: si falta el archivo se esconde, como el resto de imágenes de marca.
      onError={(e) => { e.currentTarget.style.display = 'none'; }}
    />
  );
}
