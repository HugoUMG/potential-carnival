/**
 * Capturas reales del editor para la página /aprende.
 *
 * Abre Chrome en headless, entra a /__shots (el banco de pruebas que monta el editor
 * real con datos de ejemplo), cambia de pestaña y guarda un WebP por modo.
 * Sin dependencias: usa el WebSocket nativo de Node 22 contra el DevTools Protocol.
 *
 *   1) npm run dev
 *   2) node scripts/shots.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.SHOTS_URL ?? 'http://localhost:5173';
const OUT = 'public/shots';
const PORT = 9333;
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/** Clic por texto exacto dentro del banco de pruebas. */
const clickJs = (label) =>
  `[...document.querySelectorAll('#shot button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})?.click()`;

/** Escribe en un input controlado por React (hay que usar el setter nativo + evento input). */
const typeJs = (placeholderFragment, text) => `(() => {
  const el = [...document.querySelectorAll('#shot input')].find(i => (i.placeholder ?? '').includes(${JSON.stringify(placeholderFragment)}));
  if (!el) return;
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`;

/* Cada paso de `setup` va en su propio tick: los chips guardan su estado en un mismo
   objeto, así que dos clics en el mismo tick leerían el estado viejo y solo valdría
   el último. Con un evaluate por paso, React re-renderiza entre clic y clic. */
const SHOTS = [
  {
    file: 'editor-visual.webp',
    width: 920,
    setup: [clickJs('Visual')],
    // El builder es más alto que la pantalla: se recorta a la cabecera + primer bloque.
    maxHeight: 1120,
  },
  {
    file: 'editor-dsl.webp',
    width: 920,
    setup: [clickJs('Script')],
    maxHeight: 1180,
  },
  {
    file: 'editor-ia.webp',
    width: 920,
    setup: [
      clickJs('Generar con IA'),
      clickJs('A2'),
      typeJs('Present Simple', 'Past simple'),
      clickJs('Evaluación'),
      clickJs('Adolescentes'),
      clickJs('20 min'),
      clickJs('🎼 Escucha fina'),
    ],
    maxHeight: 1330,
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
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

/** Cliente mínimo del DevTools Protocol sobre el WebSocket nativo. */
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
    ws.addEventListener('error', () => reject(new Error('No se pudo abrir el WebSocket de DevTools')), { once: true });
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ready, send, close: () => ws.close() };
}

const chromeArgs = [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${join(tmpdir(), 'dino-shots-profile')}`,
  '--window-size=1440,1200',
  'about:blank',
];

const chrome = spawn(CHROME, chromeArgs, { stdio: 'ignore', detached: false });

try {
  const { ready, send, close } = connect(await waitForDevtools());
  await ready;
  await send('Page.enable');
  await send('Runtime.enable');

  mkdirSync(OUT, { recursive: true });

  for (const shot of SHOTS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: shot.width, height: 1200, deviceScaleFactor: 1, mobile: false,
    });
    await send('Page.navigate', { url: `${BASE}/__shots` });
    await sleep(2500); // carga de módulos + fuentes + primer render

    for (const js of shot.setup) {
      await send('Runtime.evaluate', { expression: js, awaitPromise: true });
      await sleep(400);
    }
    await sleep(600);

    const { result } = await send('Runtime.evaluate', {
      expression: `(() => { const r = document.querySelector('#shot').getBoundingClientRect();
        return JSON.stringify({ x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }); })()`,
      returnByValue: true,
    });
    const box = JSON.parse(result.value);

    // WebP en vez de PNG: la misma captura pesa ~5 veces menos en una página pública.
    const { data } = await send('Page.captureScreenshot', {
      format: 'webp',
      quality: 90,
      captureBeyondViewport: true,
      clip: {
        x: Math.round(box.x) - 12,
        y: Math.round(box.y) - 12,
        width: Math.round(box.width) + 24,
        height: Math.min(Math.round(box.height) + 24, shot.maxHeight),
        scale: 2, // el doble de densidad: se ve nítido en pantallas retina
      },
    });

    const path = join(OUT, shot.file);
    writeFileSync(path, Buffer.from(data, 'base64'));
    console.log(`✓ ${path}  (${Math.round(Buffer.from(data, 'base64').length / 1024)} kB)`);
  }

  close();
} finally {
  chrome.kill();
}
