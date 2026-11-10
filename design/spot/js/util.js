/* MyDinoEnglish — spot 50 s
   Utilidades de dibujo. Todo se pinta en un lienzo 1920×1080 y debe ser
   determinista: el mismo t produce el mismo fotograma (el export no usa rAF). */

export const W = 1920;
export const H = 1080;
export const FPS = 30;
export const DURATION = 50;

export const C = {
  bg: '#0A0D08',
  bg2: '#0E1409',
  ink: '#2B2A26',
  inkSoft: '#5B5A50',
  cream: '#F6F4E9',
  paper: '#FCFAF2',
  paper2: '#F1EDDD',
  green: '#C7F08A',
  greenMid: '#84B84C',
  greenDeep: '#3D5E24',
  orange: '#FFB07A',
  orangeMid: '#EE7B30',
  orangeDeep: '#CE6014',
  red: '#E4573D',
  white: '#FFFFFF',
  line: 'rgba(233,241,222,0.12)',
  muted: 'rgba(233,241,222,0.62)',
  dim: 'rgba(233,241,222,0.38)',
};

export const E = {
  linear: (t) => t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inCubic: (t) => t * t * t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutQuint: (t) => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2),
  outBack: (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  outElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
};

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const inv = (t, a, b) => clamp((t - a) / (b - a));
export const anim = (t, start, dur, ease = E.outCubic) => ease(inv(t, start, start + dur));
export const mix = (a, b, t) => lerp(a, b, clamp(t));

/** Onda 0→1→0, útil para destellos y pulsos. */
export function bump(t, start, dur) {
  const p = inv(t, start, start + dur);
  return Math.sin(p * Math.PI);
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── formas ──────────────────────────────────────────────────────────── */

export function rr(ctx, x, y, w, h, r = 16) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function fillRR(ctx, x, y, w, h, r, fill) {
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function strokeRR(ctx, x, y, w, h, r, stroke, lw = 2) {
  rr(ctx, x, y, w, h, r);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
}

export function circle(ctx, x, y, r, fill) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/* ── texto ───────────────────────────────────────────────────────────── */

export function font(weight, size, family = 'Poppins') {
  return `${weight} ${size}px ${family}`;
}

export function setFont(ctx, o = {}) {
  const { size = 32, weight = 800, family = 'Poppins', ls = 0 } = o;
  ctx.font = font(weight, size, family);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${ls}px`;
}

export function txt(ctx, s, x, y, o = {}) {
  const {
    size = 32, weight = 800, family = 'Poppins', color = C.cream,
    align = 'left', baseline = 'alphabetic', alpha = 1, ls = 0, maxWidth,
  } = o;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  setFont(ctx, o);
  if (maxWidth) ctx.fillText(s, x, y, maxWidth);
  else ctx.fillText(s, x, y);
  ctx.restore();
}

export function measure(ctx, s, o = {}) {
  ctx.save();
  setFont(ctx, o);
  const w = ctx.measureText(s).width;
  ctx.restore();
  return w;
}

/** Varias líneas separadas por \n. */
export function txtLines(ctx, s, x, y, o = {}) {
  const lh = o.lh ?? (o.size ?? 32) * 1.12;
  s.split('\n').forEach((line, i) => txt(ctx, line, x, y + i * lh, o));
}

/** Parte un texto en líneas que quepan en maxW. */
export function wrap(ctx, s, maxW, o = {}) {
  const words = s.split(/\s+/);
  const out = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (measure(ctx, test, o) > maxW && line) {
      out.push(line);
      line = w;
    } else line = test;
  }
  if (line) out.push(line);
  return out;
}

export function wrapped(ctx, s, x, y, maxW, o = {}) {
  const lines = wrap(ctx, s, maxW, o);
  const lh = o.lh ?? (o.size ?? 32) * 1.25;
  lines.forEach((line, i) => txt(ctx, line, x, y + i * lh, o));
  return lines.length * lh;
}

export function fitSize(ctx, s, maxW, o = {}) {
  let size = o.size ?? 32;
  while (size > 8 && measure(ctx, s, { ...o, size }) > maxW) size -= 2;
  return size;
}

/* ── efectos ─────────────────────────────────────────────────────────── */

export function shadowed(ctx, { color = 'rgba(0,0,0,0.45)', blur = 40, x = 0, y = 18 } = {}, fn) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = x;
  ctx.shadowOffsetY = y;
  fn();
  ctx.restore();
}

export function glow(ctx, x, y, r, color, alpha = 0.5) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color.replace('ALPHA', String(alpha)));
  g.addColorStop(1, color.replace('ALPHA', '0'));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

const dust = (() => {
  const r = rng(7);
  return Array.from({ length: 46 }, () => ({
    x: r() * W, y: r() * H, s: 1 + r() * 2.4, sp: 0.15 + r() * 0.5, a: 0.05 + r() * 0.18,
  }));
})();

/** Fondo común: negro verdoso, rejilla y resplandores que respiran. */
export function background(ctx, t, o = {}) {
  const { glowX = 0.72, glowY = 0.22, warm = 0.55, grid = 1 } = o;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // resplandor frío (verde rex) y cálido (espina)
  const gx = W * glowX + Math.sin(t * 0.21) * 70;
  const gy = H * glowY + Math.cos(t * 0.17) * 40;
  glow(ctx, gx, gy, 900, 'rgba(132,184,76,ALPHA)', 0.16);
  glow(ctx, W * 0.18, H * 1.02, 760, 'rgba(238,123,48,ALPHA)', 0.1 * warm);

  // rejilla
  const step = 96;
  const off = (t * 9) % step;
  ctx.save();
  ctx.strokeStyle = `rgba(199,240,138,${0.05 * grid})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -step + off; x < W + step; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
  }
  for (let y = -step + ((t * 5) % step); y < H + step; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();
  ctx.restore();

  // polvo
  ctx.save();
  for (const d of dust) {
    const y = ((d.y - t * 14 * d.sp) % (H + 60) + H + 60) % (H + 60) - 30;
    const x = d.x + Math.sin(t * 0.3 * d.sp + d.y) * 18;
    circle(ctx, x, y, d.s, `rgba(233,241,222,${d.a})`);
  }
  ctx.restore();
}

let grainPattern = null;
function makeGrain(ctx) {
  const c = document.createElement('canvas');
  c.width = c.height = 220;
  const g = c.getContext('2d');
  const img = g.createImageData(220, 220);
  const r = rng(99);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(r() * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainPattern = ctx.createPattern(c, 'repeat');
}

export function grain(ctx, t) {
  if (!grainPattern) makeGrain(ctx);
  const f = Math.floor(t * FPS);
  const ox = (f * 37) % 220;
  const oy = (f * 71) % 220;
  ctx.save();
  ctx.globalAlpha = 0.055;
  ctx.globalCompositeOperation = 'overlay';
  ctx.translate(-ox, -oy);
  ctx.fillStyle = grainPattern;
  ctx.fillRect(0, 0, W + 220, H + 220);
  ctx.restore();
}

let vig = null;
export function vignette(ctx) {
  if (!vig) {
    vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.92);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(0.72, 'rgba(0,0,0,0.18)');
    vig.addColorStop(1, 'rgba(0,0,0,0.62)');
  }
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

/** Barrido de dos bandas inclinadas. p: 0→1; cubre la pantalla en p≈0.5. */
export function wipe(ctx, p, c1 = C.green, c2 = C.orangeMid) {
  if (p <= 0 || p >= 1) return;
  const e = E.inOutCubic(p);
  const x = lerp(-W * 1.45, W * 1.02, e);
  const skew = 150;
  ctx.save();
  ctx.fillStyle = c2;
  ctx.beginPath();
  ctx.moveTo(x - 220 + skew, 0);
  ctx.lineTo(x - 220 + skew + W * 1.45, 0);
  ctx.lineTo(x - 220 + W * 1.45, H);
  ctx.lineTo(x - 220, H);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = c1;
  ctx.beginPath();
  ctx.moveTo(x + skew, 0);
  ctx.lineTo(x + W * 1.45, 0);
  ctx.lineTo(x + W * 1.45 - skew, H);
  ctx.lineTo(x, H);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Destello breve en los cortes. */
export function flashAt(ctx, t, times, strength = 0.22) {
  for (const c of times) {
    const d = Math.abs(t - c);
    if (d < 0.13) {
      ctx.fillStyle = `rgba(255,255,255,${(1 - d / 0.13) * strength})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
}

/** Escala de cámara con golpe en los cortes. */
export function punchAt(t, times, amount = 0.012) {
  let s = 1;
  for (const c of times) {
    const d = t - c;
    if (d >= 0 && d < 0.4) s += amount * Math.exp(-d * 14);
  }
  return s;
}
