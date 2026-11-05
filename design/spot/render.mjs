/* Servidor local + lanzador de Chrome para renderizar el spot.
   Uso:
     node render.mjs                 → exporta design/spot/spot.mp4
     node render.mjs --mbps 0.8      → versión ligera (≈15 MB) en design/spot/spot-ligero.mp4
     node render.mjs --stills 1,12   → guarda fotogramas sueltos en design/spot/stills/
*/

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'spot.mp4');
const STILLS = path.join(HERE, 'stills');
const PORT = Number(process.env.PORT || 4178);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
};

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('No encuentro Chrome. Define CHROME_PATH.');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && url.pathname === '/log') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      console.log('  ' + body);
      res.writeHead(204).end();
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/save') {
    const name = path.basename(url.searchParams.get('name') || 'spot.mp4');
    const dest = path.join(HERE, name);
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 400 * 1024 * 1024) {
        res.writeHead(413).end('demasiado grande');
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      fs.writeFileSync(dest, buf);
      console.log(`\n✔ ${path.relative(ROOT, dest)} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      setTimeout(() => finish(0), 400);
    });
    return;
  }

  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('fuera del proyecto');
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404).end('no encontrado');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
});

let chrome = null;
function finish(code) {
  if (chrome && !chrome.killed) chrome.kill();
  server.close(() => process.exit(code));
}

function launch(args, url) {
  const cp = spawn(chromePath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  cp.stderr.on('data', (d) => {
    const s = d.toString();
    if (/error|fail/i.test(s) && !/DevTools|GPU|gpu|dbus|Fontconfig|sandbox/i.test(s)) {
      process.stderr.write(s);
    }
  });
  return cp;
}

async function main() {
  const args = process.argv.slice(2);
  const stillsArg = args.indexOf('--stills');
  const audioMode = args.includes('--audio');
  const mbpsArg = args.indexOf('--mbps');
  const mbps = mbpsArg !== -1 ? `&mbps=${Number(args[mbpsArg + 1])}` : '';

  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  console.log(`Servidor en http://127.0.0.1:${PORT}`);

  const base = `http://127.0.0.1:${PORT}/design/spot/index.html`;
  const profile = path.join(HERE, '.chrome-profile');

  if (stillsArg !== -1) {
    const times = (args[stillsArg + 1] || '1,6,12,20,28,35,43,48').split(',').map(Number);
    fs.mkdirSync(STILLS, { recursive: true });
    for (const t of times) {
      const out = path.join(STILLS, `t-${String(t).replace('.', '_')}.png`);
      const cp = launch([
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
        '--no-default-browser-check', '--user-data-dir=' + profile,
        '--window-size=1920,1080', '--force-device-scale-factor=1',
        '--virtual-time-budget=6000',
        '--screenshot=' + out,
        `${base}?still=1&t=${t}`,
      ]);
      await new Promise((resolve) => cp.on('exit', resolve));
      console.log(`  ${path.basename(out)}`);
    }
    finish(0);
    return;
  }

  console.log(audioMode ? 'Sintetizando pista de audio…' : 'Renderizando spot (≈1 min)…');
  chrome = launch([
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--user-data-dir=' + profile,
    '--window-size=1920,1080', '--force-device-scale-factor=1',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `${base}${audioMode ? '?audio=1' : '?export=1' + mbps}`,
  ]);
  chrome.on('exit', (code) => {
    console.log('Chrome terminó con código', code);
  });

  setTimeout(() => {
    console.error('Tiempo de espera agotado (5 min).');
    finish(1);
  }, 5 * 60 * 1000).unref();
}

main().catch((e) => {
  console.error(e);
  finish(1);
});
