/* Reproductor y exportador del spot.
   - Normal: reproduce en el navegador con la música sintetizada.
   - ?export=1: renderiza los 1.500 fotogramas, codifica H.264 + AAC y manda el MP4 al servidor local. */

import { DURATION, FPS, W, H } from './util.js';
import { loadAssets } from './assets.js';
import { drawFrame } from './scenes.js';
import { renderMusic } from './audio.js';
import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer.mjs';

const params = new URLSearchParams(location.search);
const EXPORT = params.get('export') === '1';
const STILL = params.has('t');

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d', { alpha: false });

const $ = (id) => document.getElementById(id);

function log(msg) {
  console.log(msg);
  const el = $('status');
  if (el) el.textContent = msg;
  if (EXPORT) {
    fetch('/log', { method: 'POST', body: String(msg) }).catch(() => {});
  }
}

let audioBuffer = null;
let audioCtx = null;
let source = null;
let gainNode = null;
let muted = false;

let playing = false;
let startWall = 0;
let offset = 0;
let raf = 0;

async function boot() {
  log('Cargando fuentes y assets…');
  await loadAssets(log);
  log('Listo.');

  if (EXPORT) {
    document.body.classList.add('export');
    await exportVideo();
    return;
  }

  if (params.get('still') === '1') {
    document.body.classList.add('still');
    drawFrame(ctx, Math.min(DURATION - 0.001, parseFloat(params.get('t')) || 0));
    return;
  }

  if (params.get('audio') === '1') {
    document.body.classList.add('export');
    log('Sintetizando música…');
    const buf = await renderMusic();
    const wav = encodeWav(buf);
    await fetch('/save?name=spot.wav', { method: 'POST', body: wav });
    log('WAV guardado.');
    return;
  }

  const initial = STILL ? Math.min(DURATION - 0.001, parseFloat(params.get('t')) || 0) : 0;
  offset = initial;
  drawFrame(ctx, initial);
  updateUI(initial);
  $('play').addEventListener('click', togglePlay);
  $('smallPlay').addEventListener('click', togglePlay);
  $('timeline').addEventListener('input', (e) => seek(parseFloat(e.target.value)));
  $('mute').addEventListener('click', toggleMute);
  $('download').addEventListener('click', () => {
    const url = new URL(location.href);
    url.search = '?export=1';
    window.open(url.toString(), '_blank');
  });

  renderMusic()
    .then((buf) => {
      audioBuffer = buf;
      $('play').disabled = false;
      $('smallPlay').disabled = false;
      log('Audio listo. Pulsa play.');
    })
    .catch((e) => {
      log('No se pudo sintetizar el audio: ' + e.message);
      $('play').disabled = false;
      $('smallPlay').disabled = false;
    });
}

/* ── reproducción ───────────────────────────────────────────────────── */

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    gainNode = audioCtx.createGain();
    gainNode.gain.value = muted ? 0 : 0.9;
    gainNode.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function stopAudio() {
  if (source) {
    try { source.stop(); } catch { /* ya parado */ }
    source.disconnect();
    source = null;
  }
}

function startAudio(from) {
  if (!audioBuffer) return;
  ensureAudio();
  stopAudio();
  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(gainNode);
  source.start(0, Math.min(from, audioBuffer.duration - 0.01));
}

function togglePlay() {
  if (playing) pause();
  else play();
}

function play() {
  if (offset >= DURATION - 0.02) offset = 0;
  playing = true;
  startWall = performance.now();
  startAudio(offset);
  $('overlay').classList.add('hidden');
  $('play').classList.add('hidden');
  $('smallPlay').textContent = '❚❚';
  raf = requestAnimationFrame(tick);
}

function pause() {
  if (!playing) return;
  playing = false;
  cancelAnimationFrame(raf);
  offset = Math.min(DURATION, (performance.now() - startWall) / 1000 + offset);
  stopAudio();
  $('overlay').classList.remove('hidden');
  $('play').classList.remove('hidden');
  $('smallPlay').textContent = '▶';
}

function tick() {
  const t = (performance.now() - startWall) / 1000 + offset;
  if (t >= DURATION) {
    drawFrame(ctx, DURATION - 0.001);
    updateUI(DURATION);
    pause();
    offset = 0;
    $('overlay').classList.remove('hidden');
    return;
  }
  drawFrame(ctx, t);
  updateUI(t);
  raf = requestAnimationFrame(tick);
}

function seek(t) {
  const wasPlaying = playing;
  if (playing) pause();
  offset = clampT(t);
  drawFrame(ctx, offset);
  updateUI(offset);
  if (wasPlaying) play();
}

function clampT(t) {
  return Math.max(0, Math.min(DURATION - 0.001, t));
}

function updateUI(t) {
  const tl = $('timeline');
  if (tl && document.activeElement !== tl) tl.value = String(t);
  const cur = $('cur');
  if (cur) cur.textContent = fmt(t);
}

function fmt(t) {
  const s = Math.floor(t);
  const f = Math.floor((t - s) * 100);
  return `0:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}

function toggleMute() {
  muted = !muted;
  if (gainNode) gainNode.gain.value = muted ? 0 : 0.9;
  $('mute').textContent = muted ? '🔇' : '🔊';
}

/* ── export ─────────────────────────────────────────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function encodeWav(buffer) {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const bytes = 44 + len * ch * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, ch, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * ch * 2, true);
  view.setUint16(32, ch * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, len * ch * 2, true);
  const data = [];
  for (let c = 0; c < ch; c++) data.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
  }
  return view.buffer;
}

async function waitQueue(enc, max) {
  while (enc.encodeQueueSize > max) await sleep(4);
}

async function exportVideo() {
  try {
    log('Sintetizando música…');
    const buffer = await renderMusic();

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: W, height: H, frameRate: FPS },
      audio: { codec: 'aac', sampleRate: 48000, numberOfChannels: 2 },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'strict',
    });

    log('Codificando audio AAC…');
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => log('AudioEncoder: ' + e.message),
    });
    audioEncoder.configure({
      codec: 'mp4a.40.2',
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 192000,
      aac: { format: 'aac' },
    });

    const L = buffer.getChannelData(0);
    const R = buffer.getChannelData(1);
    const CHUNK = 4800;
    for (let off = 0; off < buffer.length; off += CHUNK) {
      const n = Math.min(CHUNK, buffer.length - off);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(off, off + n), 0);
      data.set(R.subarray(off, off + n), n);
      const ad = new AudioData({
        format: 'f32-planar',
        sampleRate: 48000,
        numberOfFrames: n,
        numberOfChannels: 2,
        timestamp: Math.round((off / 48000) * 1e6),
        data,
      });
      audioEncoder.encode(ad);
      ad.close();
      if (audioEncoder.encodeQueueSize > 30) await waitQueue(audioEncoder, 30);
    }
    await audioEncoder.flush();
    audioEncoder.close();
    log('Audio listo.');

    log('Codificando video H.264…');
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => log('VideoEncoder: ' + e.message),
    });
    videoEncoder.configure({
      codec: 'avc1.4d0028',
      width: W,
      height: H,
      bitrate: 9_000_000,
      framerate: FPS,
      avc: { format: 'avc' },
      latencyMode: 'quality',
    });

    const total = Math.round(DURATION * FPS);
    const t0 = performance.now();
    for (let i = 0; i < total; i++) {
      drawFrame(ctx, i / FPS);
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1e6) / FPS),
        duration: Math.round(1e6 / FPS),
      });
      videoEncoder.encode(frame, { keyFrame: i % 60 === 0 });
      frame.close();
      if (videoEncoder.encodeQueueSize > 6) await waitQueue(videoEncoder, 6);
      if (i % 60 === 0) {
        const el = ((performance.now() - t0) / 1000).toFixed(1);
        log(`Fotograma ${i}/${total} · ${el}s`);
      }
    }
    await videoEncoder.flush();
    videoEncoder.close();
    log('Video listo. Muxando MP4…');

    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    log(`MP4: ${(blob.size / 1024 / 1024).toFixed(1)} MB. Enviando…`);
    const res = await fetch('/save?name=spot.mp4', { method: 'POST', body: blob }).catch(() => null);
    if (res?.ok) {
      log('Guardado. Puedes cerrar esta pestaña.');
    } else {
      // ponytail: /save solo existe con render.mjs; con `npm run dev` (Vite) el navegador lo descarga
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: 'spot.mp4',
      });
      a.click();
      log('Descargado como spot.mp4 (sin render.mjs no se guarda en el proyecto).');
    }
    document.title = 'Listo · spot.mp4';
  } catch (e) {
    log('ERROR: ' + (e?.stack || e?.message || e));
    console.error(e);
  }
}

boot();
