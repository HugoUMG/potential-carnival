/* Carga de fuentes locales y de los assets reales del proyecto. */

const FONTS = [
  ['Inter', 'assets/inter.woff2', { weight: '100 900', style: 'normal' }],
  ['Poppins', 'assets/poppins-600.woff2', { weight: '600', style: 'normal' }],
  ['Poppins', 'assets/poppins-800.woff2', { weight: '800', style: 'normal' }],
];

const IMAGE_SRC = {
  wave: '../../public/mascot/rex-wave.svg',
  happy: '../../public/mascot/rex-happy.svg',
  hero: '../../public/mascot/rex-hero.svg',
  thinking: '../../public/mascot/rex-thinking.svg',
  ia: '../../public/shots/editor-ia.webp',
  visual: '../../public/shots/editor-visual.webp',
  dsl: '../../public/shots/editor-dsl.webp',
};

export const IMG = {};

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn('No se pudo cargar', src);
      resolve(null);
    };
    img.src = src;
  });
}

export async function loadAssets(log = () => {}) {
  const fontJobs = FONTS.map(async ([family, url, desc]) => {
    try {
      const face = new FontFace(family, `url(${url})`, desc);
      await face.load();
      document.fonts.add(face);
    } catch (e) {
      console.warn('Fuente no disponible:', family, e.message);
    }
  });

  const imgJobs = Object.entries(IMAGE_SRC).map(async ([key, src]) => {
    IMG[key] = await loadImage(src);
    log(`asset ${key}: ${IMG[key] ? 'ok' : 'falta'}`);
  });

  await Promise.all([...fontJobs, ...imgJobs]);
  await document.fonts.ready;
}
