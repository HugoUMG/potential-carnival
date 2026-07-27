/**
 * Corta las poses de RexLearn desde el arte vectorial de `design/mascot-source/`.
 *
 * Las fuentes son dos SVG de 1024×1024 con una grilla 2×2 de poses sobre fondo NEGRO
 * (trazado vectorial de los PNG originales). Este script, por cada pose:
 *   1. Tira el path del fondo (el rectángulo negro que ocupa todo el lienzo).
 *   2. Se queda con los paths cuyo centro cae en el cuadrante de esa pose.
 *   3. Recorta al contenido y lo centra en un viewBox CUADRADO (así todas las poses
 *      se ven del mismo tamaño aunque una esté sentada y otra de pie).
 *   4. Redondea las coordenadas a 1 decimal — el trazador escribe 6 y no aportan nada.
 *
 * Salida: public/mascot/rex-{pose}.svg, que consume `src/components/RexMascot.tsx`.
 *
 *   node scripts/mascots.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9336;
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// Cuadrantes: 0 = arriba-izq, 1 = arriba-der, 2 = abajo-izq, 3 = abajo-der.
const SOURCES = [
  {
    file: 'file (2).svg',
    poses: { 0: 'hero', 1: 'wave', 3: 'thinking' }, // pulgar arriba · saludando · pensativo
  },
  {
    file: 'file (1).svg',
    poses: { 1: 'happy', 2: 'sad' },                // saltando de alegría · sentado triste
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Corre DENTRO de la página: recibe {svg, poses} y devuelve {pose: markup}. */
const SLICE_FN = `({ svg, poses }) => {
  const PAD = 0.04;

  const host = document.createElement('div');
  host.innerHTML = svg;
  const root = host.querySelector('svg');
  document.body.appendChild(host);

  const paths = [...root.querySelectorAll('path')].map((el) => ({ el, box: el.getBBox() }));
  const [, , W, H] = root.getAttribute('viewBox').split(/[\\s,]+/).map(Number);

  const out = {};
  for (const [q, name] of Object.entries(poses)) {
    const cx = (q % 2) * (W / 2), cy = ((q / 2) | 0) * (H / 2);
    const mine = paths.filter(({ box }) => {
      if (box.width > W * 0.9 && box.height > H * 0.9) return false;   // el fondo negro
      const mx = box.x + box.width / 2, my = box.y + box.height / 2;
      return mx >= cx && mx < cx + W / 2 && my >= cy && my < cy + H / 2;
    });
    if (!mine.length) throw new Error('cuadrante vacío: ' + name);

    // Restos del trazado: motas sueltas lejos del personaje. Se tira lo que no toca la
    // caja del cuerpo (la de los paths grandes) con un margen del 10 %; así sobreviven
    // las líneas de movimiento pegadas a la cabeza, que sí son parte del dibujo.
    const big = mine.filter(({ box }) => box.width * box.height > (W / 2) * (H / 2) * 0.01);
    const hull = (list) => ({
      x0: Math.min(...list.map((p) => p.box.x)),
      y0: Math.min(...list.map((p) => p.box.y)),
      x1: Math.max(...list.map((p) => p.box.x + p.box.width)),
      y1: Math.max(...list.map((p) => p.box.y + p.box.height)),
    });
    const core = hull(big.length ? big : mine);
    const m = 0.10 * Math.max(core.x1 - core.x0, core.y1 - core.y0);
    const kept = mine.filter(({ box }) =>
      box.x <= core.x1 + m && box.x + box.width >= core.x0 - m &&
      box.y <= core.y1 + m && box.y + box.height >= core.y0 - m);

    const { x0, y0, x1, y1 } = hull(kept);
    const side = Math.max(x1 - x0, y1 - y0) * (1 + 2 * PAD);
    const vb = [
      (x0 + x1) / 2 - side / 2, (y0 + y1) / 2 - side / 2, side, side,
    ].map((n) => Math.round(n * 10) / 10);

    const body = kept
      .map(({ el }) => el.outerHTML.replace(/-?\\d+\\.\\d+/g, (n) => String(Math.round(+n * 10) / 10)))
      .join('');
    out[name] = { vb, body, paths: kept.length, dropped: mine.length - kept.length };
  }
  return JSON.stringify(out);
}`;

async function devtoolsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* Chrome aún no levanta el puerto */ }
    await sleep(250);
  }
  throw new Error('Chrome no expuso el puerto de DevTools');
}

function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    if (msg.error) slot.reject(new Error(msg.error.message));
    else slot.resolve(msg.result);
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('No se pudo abrir el WebSocket')), { once: true });
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ready, send, close: () => ws.close() };
}

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${join(tmpdir(), 'dino-mascot-profile')}`,
  'about:blank',
], { stdio: 'ignore' });

try {
  const { ready, send, close } = connect(await devtoolsUrl());
  await ready;
  await send('Runtime.enable');

  for (const src of SOURCES) {
    const svg = readFileSync(join('design/mascot-source', src.file), 'utf8');
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression: `(${SLICE_FN})(${JSON.stringify({ svg, poses: src.poses })})`,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(`${src.file}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    }
    for (const [pose, { vb, body, paths, dropped }] of Object.entries(JSON.parse(result.value))) {
      const markup =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}">${body}</svg>`;
      const out = join('public/mascot', `rex-${pose}.svg`);
      writeFileSync(out, markup);
      console.log(`✓ ${out}  ${paths} paths (${dropped} motas fuera), ${Math.round(markup.length / 1024)} kB`);
    }
  }

  close();
} finally {
  chrome.kill();
}
process.exit(0);
