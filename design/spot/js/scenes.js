/* Guion visual del spot (50 s, 8 escenas). Cada escena recibe su tiempo local. */

import {
  W, H, DURATION, C, E, clamp, lerp, inv, anim, bump, rng, rr, fillRR, strokeRR, circle,
  txt, measure, wrapped, shadowed, glow, background, grain, vignette,
  wipe, flashAt, punchAt,
} from './util.js';
import { IMG } from './assets.js';

let ctx;
const CUTS = [5, 10, 18, 26, 33, 41, 46.5];

/* ── piezas reutilizables ───────────────────────────────────────────── */

function eyebrow(s, x, y, color = C.orange, alpha = 1, size = 21) {
  txt(ctx, s.toUpperCase(), x, y, {
    size, weight: 700, family: 'Inter', color, ls: 5, alpha,
  });
}

function wordmark(cx, baseline, size, p = 1, center = true) {
  const parts = [
    ['My', C.orange],
    ['Dino', C.cream],
    ['English', C.green],
  ];
  const o = { size, weight: 800, family: 'Poppins', ls: -size * 0.018 };
  const widths = parts.map(([s]) => measure(ctx, s, o));
  const total = widths.reduce((a, b) => a + b, 0);
  let x = center ? cx - total / 2 : cx;
  parts.forEach(([s, color], i) => {
    const e = E.outBack(clamp(p * 1.6 - i * 0.18));
    if (e > 0) {
      txt(ctx, s, x, baseline + (1 - e) * size * 0.35, {
        ...o, color, alpha: clamp(p * 2 - i * 0.2),
      });
    }
    x += widths[i];
  });
  return total;
}

function drawRex(key, cx, cy, size, scale = 1, t = 0, float = true) {
  const img = IMG[key];
  if (!img) return;
  const y = cy + (float ? Math.sin(t * 2.1) * 9 : 0);
  const rot = float ? Math.sin(t * 1.55) * 0.022 : 0;
  ctx.save();
  ctx.translate(cx, y);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
}

function pill(x, y, label, o = {}) {
  const {
    size = 24, padX = 26, h = 58, fill = 'rgba(255,255,255,0.05)',
    border = 'rgba(233,241,222,0.16)', color = C.cream, iconName = null,
    weight = 600, family = 'Inter', alpha = 1, ls = 0,
  } = o;
  const tw = measure(ctx, label, { size, weight, family, ls });
  const iw = iconName ? 30 : 0;
  const w = tw + padX * 2 + iw;
  ctx.save();
  ctx.globalAlpha *= alpha;
  fillRR(ctx, x, y - h / 2, w, h, h / 2, fill);
  strokeRR(ctx, x, y - h / 2, w, h, h / 2, border, 1.5);
  if (iconName) icon(ctx, iconName, x + padX + 10, y, 20, color);
  txt(ctx, label, x + padX + iw, y + 1, {
    size, weight, family, color, baseline: 'middle', ls,
  });
  ctx.restore();
  return w;
}

function icon(c, name, x, y, s, color = C.green) {
  c.save();
  c.translate(x, y);
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = Math.max(1.6, s * 0.1);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const p = new Path2D();
  switch (name) {
    case 'play':
      c.beginPath();
      c.moveTo(-s * 0.28, -s * 0.36);
      c.lineTo(s * 0.42, 0);
      c.lineTo(-s * 0.28, s * 0.36);
      c.closePath();
      c.fill();
      break;
    case 'check':
      c.beginPath();
      c.moveTo(-s * 0.34, 0);
      c.lineTo(-s * 0.08, s * 0.26);
      c.lineTo(s * 0.36, -s * 0.28);
      c.stroke();
      break;
    case 'arrow':
      c.beginPath();
      c.moveTo(-s * 0.4, 0);
      c.lineTo(s * 0.34, 0);
      c.moveTo(s * 0.06, -s * 0.28);
      c.lineTo(s * 0.36, 0);
      c.lineTo(s * 0.06, s * 0.28);
      c.stroke();
      break;
    case 'link':
      c.beginPath();
      c.arc(-s * 0.2, 0, s * 0.26, Math.PI * 0.35, Math.PI * 1.65);
      c.stroke();
      c.beginPath();
      c.arc(s * 0.2, 0, s * 0.26, Math.PI * 1.35, Math.PI * 0.65);
      c.stroke();
      c.beginPath();
      c.moveTo(-s * 0.06, 0);
      c.lineTo(s * 0.06, 0);
      c.stroke();
      break;
    case 'copy':
      c.strokeRect(-s * 0.26, -s * 0.2, s * 0.4, s * 0.46);
      c.beginPath();
      c.moveTo(-s * 0.08, -s * 0.34);
      c.lineTo(s * 0.3, -s * 0.34);
      c.lineTo(s * 0.3, s * 0.14);
      c.stroke();
      break;
    case 'spark':
      c.beginPath();
      c.moveTo(0, -s * 0.46);
      c.quadraticCurveTo(s * 0.08, -s * 0.08, s * 0.46, 0);
      c.quadraticCurveTo(s * 0.08, s * 0.08, 0, s * 0.46);
      c.quadraticCurveTo(-s * 0.08, s * 0.08, -s * 0.46, 0);
      c.quadraticCurveTo(-s * 0.08, -s * 0.08, 0, -s * 0.46);
      c.fill();
      break;
    case 'grid':
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          c.strokeRect(-s * 0.34 + i * s * 0.4, -s * 0.34 + j * s * 0.4, s * 0.26, s * 0.26);
        }
      }
      break;
    case 'code':
      c.beginPath();
      c.moveTo(-s * 0.16, -s * 0.28);
      c.lineTo(-s * 0.4, 0);
      c.lineTo(-s * 0.16, s * 0.28);
      c.moveTo(s * 0.16, -s * 0.28);
      c.lineTo(s * 0.4, 0);
      c.lineTo(s * 0.16, s * 0.28);
      c.stroke();
      break;
    case 'mic':
      c.beginPath();
      c.roundRect(-s * 0.16, -s * 0.44, s * 0.32, s * 0.5, s * 0.16);
      c.stroke();
      c.beginPath();
      c.arc(0, s * 0.02, s * 0.3, 0, Math.PI);
      c.stroke();
      c.beginPath();
      c.moveTo(0, s * 0.32);
      c.lineTo(0, s * 0.46);
      c.stroke();
      break;
    case 'headphones':
      c.beginPath();
      c.arc(0, 0, s * 0.36, Math.PI * 1.08, Math.PI * 1.92);
      c.stroke();
      c.beginPath();
      c.roundRect(-s * 0.44, -s * 0.02, s * 0.18, s * 0.32, s * 0.08);
      c.roundRect(s * 0.26, -s * 0.02, s * 0.18, s * 0.32, s * 0.08);
      c.stroke();
      break;
    case 'book':
      c.beginPath();
      c.moveTo(-s * 0.4, -s * 0.3);
      c.quadraticCurveTo(-s * 0.15, -s * 0.38, 0, -s * 0.22);
      c.quadraticCurveTo(s * 0.15, -s * 0.38, s * 0.4, -s * 0.3);
      c.lineTo(s * 0.4, s * 0.32);
      c.quadraticCurveTo(s * 0.15, s * 0.24, 0, s * 0.4);
      c.quadraticCurveTo(-s * 0.15, s * 0.24, -s * 0.4, s * 0.32);
      c.closePath();
      c.stroke();
      break;
    case 'drag':
      c.beginPath();
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) circle(c, i * s * 0.26, j * s * 0.26, s * 0.045, color);
      }
      break;
    default:
      c.beginPath();
      c.arc(0, 0, s * 0.3, 0, Math.PI * 2);
      c.stroke();
  }
  c.restore();
}

function cursor(x, y, s = 1, press = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  if (press > 0) {
    ctx.beginPath();
    ctx.arc(0, 0, 12 + press * 26, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(199,240,138,${0.6 * (1 - press)})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 34);
  ctx.lineTo(8, 26);
  ctx.lineTo(14, 41);
  ctx.lineTo(21, 38);
  ctx.lineTo(15, 23);
  ctx.lineTo(26, 22);
  ctx.closePath();
  ctx.fillStyle = C.white;
  ctx.strokeStyle = 'rgba(10,13,8,0.9)';
  ctx.lineWidth = 2.4;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/* ── escena 1 · gancho ──────────────────────────────────────────────── */

function paper(x, y, w, h, marks = 0, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 26;
  fillRR(ctx, x, y, w, h, 10, C.paper);
  ctx.shadowColor = 'transparent';
  fillRR(ctx, x, y, w, 10, 10, C.greenMid);

  const s = w / 620;
  txt(ctx, 'MyDinoEnglish', x + 28 * s, y + 44 * s, {
    size: 15 * s, weight: 700, family: 'Inter', color: C.greenDeep, ls: 0.6,
  });
  txt(ctx, 'WORKSHEET', x + w - 28 * s, y + 44 * s, {
    size: 11 * s, weight: 700, family: 'Inter', color: 'rgba(43,42,38,0.4)',
    align: 'right', ls: 2,
  });
  txt(ctx, 'Past Simple — Unit 3', x + 28 * s, y + 96 * s, {
    size: 31 * s, weight: 800, color: C.ink,
  });
  txt(ctx, 'Regular and irregular verbs · A2', x + 28 * s, y + 124 * s, {
    size: 16 * s, weight: 500, family: 'Inter', color: 'rgba(43,42,38,0.55)',
  });
  ctx.strokeStyle = 'rgba(43,42,38,0.12)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x + 28 * s, y + 148 * s);
  ctx.lineTo(x + w - 28 * s, y + 148 * s);
  ctx.stroke();

  const items = [
    ['1', 'She ____ to school yesterday.', ['walked', 'walks', 'walking']],
    ['2', 'They ____ a movie last night.', ['watch', 'watched', 'watching']],
    ['3', '____ you finish your homework?', ['Do', 'Did', 'Are']],
  ];
  items.forEach(([n, text, opts], i) => {
    const iy = y + (185 + i * 168) * s;
    circle(ctx, x + 44 * s, iy + 2 * s, 15 * s, C.greenMid);
    txt(ctx, n, x + 44 * s, iy + 3 * s, {
      size: 15 * s, weight: 700, family: 'Inter', color: C.white, align: 'center', baseline: 'middle',
    });
    txt(ctx, text, x + 74 * s, iy + 8 * s, {
      size: 19 * s, weight: 600, family: 'Inter', color: C.ink,
    });
    opts.forEach((op, j) => {
      const oy = iy + (40 + j * 32) * s;
      ctx.beginPath();
      ctx.arc(x + 84 * s, oy, 7 * s, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(43,42,38,0.32)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      txt(ctx, op, x + 102 * s, oy + 1 * s, {
        size: 15 * s, weight: 500, family: 'Inter', color: 'rgba(43,42,38,0.7)',
        baseline: 'middle',
      });
    });
  });

  if (marks > 0) {
    ctx.save();
    ctx.strokeStyle = C.red;
    ctx.lineWidth = 4 * s;
    ctx.lineCap = 'round';
    const p = E.outCubic(marks);
    ctx.beginPath();
    ctx.moveTo(x + 60 * s, y + 235 * s);
    ctx.bezierCurveTo(
      x + 220 * s, y + 205 * s,
      x + 380 * s, y + 270 * s,
      x + 60 * s + 500 * s * p, y + 250 * s,
    );
    ctx.stroke();
    if (marks > 0.55) {
      ctx.beginPath();
      ctx.moveTo(x + 88 * s, y + 180 * s);
      ctx.lineTo(x + 78 * s, y + 300 * s);
      ctx.stroke();
    }
    if (marks > 0.8) {
      txt(ctx, '✗', x + 505 * s, y + 240 * s, {
        size: 54 * s, weight: 800, family: 'Inter', color: C.red, align: 'center',
      });
    }
    ctx.restore();
  }
  ctx.restore();
}

function sceneHook(t) {
  // hojas detrás
  if (t > 0.9) {
    const e = anim(t, 0.9, 0.6);
    ctx.save();
    ctx.globalAlpha = 0.4 * e;
    ctx.translate(470 + 70 * e, 590 - 55 * e);
    ctx.rotate(-0.1);
    paper(-310, -400, 620, 800, 0, 0.7);
    ctx.restore();
  }
  if (t > 1.4) {
    const e = anim(t, 1.4, 0.6);
    ctx.save();
    ctx.globalAlpha = 0.26 * e;
    ctx.translate(470 + 130 * e, 590 - 105 * e);
    ctx.rotate(-0.07);
    paper(-310, -400, 620, 800, 0, 0.6);
    ctx.restore();
  }

  const enter = E.outExpo(inv(t, 0.05, 0.85));
  ctx.save();
  ctx.translate(470, 600 + (1 - enter) * 90);
  ctx.rotate(-0.115 + Math.sin(t * 0.9) * 0.003);
  ctx.scale(lerp(0.94, 1, enter), lerp(0.94, 1, enter));
  paper(-310, -400, 620, 800, inv(t, 1.5, 2.8), enter);
  ctx.restore();

  // sello
  if (t > 3.0) {
    const sp = anim(t, 3.0, 0.4, E.outBack);
    const shake = t > 3.2 ? Math.sin((t - 3.2) * 70) * 5 * Math.exp(-(t - 3.2) * 9) : 0;
    ctx.save();
    ctx.translate(795 + shake, 300);
    ctx.rotate(-0.22);
    ctx.scale(sp, sp);
    strokeRR(ctx, -152, -56, 304, 112, 10, C.red, 6);
    strokeRR(ctx, -140, -44, 280, 88, 6, 'rgba(228,87,61,0.4)', 2);
    txt(ctx, 'OTRA VEZ', 0, 4, {
      size: 50, weight: 800, family: 'Inter', color: C.red, align: 'center', baseline: 'middle', ls: 2,
    });
    ctx.restore();
  }

  // texto
  const t1 = anim(t, 0.35, 0.7);
  const t2 = anim(t, 0.7, 0.7);
  const t3 = anim(t, 1.1, 0.7);
  eyebrow('Viernes · 11:47 p. m.', 1060, 292, C.orange, t1);
  txt(ctx, 'Todavía', 1060, 430 + (1 - t1) * 40, {
    size: 118, weight: 800, color: C.cream, alpha: t1,
  });
  txt(ctx, 'corrigiendo.', 1060, 552 + (1 - t2) * 40, {
    size: 118, weight: 800, color: C.cream, alpha: t2,
  });
  txt(ctx, '30 hojas. Una por una.', 1064, 648, {
    size: 40, weight: 600, family: 'Inter', color: C.muted, alpha: t2,
  });
  txt(ctx, 'Y mañana, otra vez.', 1064, 704, {
    size: 28, weight: 500, family: 'Inter', color: C.dim, alpha: t3,
  });
}

/* ── escena 2 · marca ───────────────────────────────────────────────── */

function sceneBrand(t) {
  glow(ctx, 1450, 560, 640, 'rgba(132,184,76,ALPHA)', 0.28);

  const rexIn = anim(t, 0.05, 0.85, E.outBack);
  if (rexIn > 0) {
    drawRex('wave', 1450, 570, 560, 0.72 + 0.28 * rexIn, t);
  }

  eyebrow('Plataforma educativa de inglés', 180, 300, C.orange, anim(t, 0.15, 0.5));
  wordmark(180, 452, 132, anim(t, 0.2, 0.9), false);

  const tag = anim(t, 0.95, 0.7);
  txt(ctx, 'Hojas de trabajo de inglés', 182, 576, {
    size: 52, weight: 600, family: 'Inter', color: C.cream, alpha: tag,
  });
  const a = 'que ';
  const b = 'se corrigen solas.';
  const wa = measure(ctx, a, { size: 52, weight: 600, family: 'Inter' });
  txt(ctx, a, 182, 638, { size: 52, weight: 600, family: 'Inter', color: C.cream, alpha: tag });
  txt(ctx, b, 182 + wa, 638, { size: 52, weight: 600, family: 'Inter', color: C.green, alpha: tag });

  const pills = [
    ['21 tipos de actividad', 'grid'],
    ['3 formas de crear', 'spark'],
    ['0 instalación', 'check'],
  ];
  let x = 182;
  pills.forEach(([label, ic], i) => {
    const p = anim(t, 1.35 + i * 0.13, 0.5, E.outBack);
    if (p > 0) {
      ctx.save();
      ctx.globalAlpha = p;
      const w = pill(x, 748 + (1 - p) * 24, label, {
        size: 24, iconName: ic, h: 60, fill: 'rgba(255,255,255,0.045)',
        border: 'rgba(199,240,138,0.22)', color: C.cream,
      });
      ctx.restore();
      x += w + 16;
    }
  });
}

/* ── escena 3 · crear ───────────────────────────────────────────────── */

const TABS = [
  { label: 'Generar con IA', icon: 'spark', img: 'ia', from: 60, to: 430, callout: 'Elige nivel, tema y listo' },
  { label: 'Constructor visual', icon: 'grid', img: 'visual', from: 50, to: 390, callout: 'Arrastra bloques, sin código' },
  { label: 'Script DSL', icon: 'code', img: 'dsl', from: 380, to: 780, callout: 'Control total, línea a línea' },
];
const TAB_TIMES = [0.6, 3.2, 5.8];

function shot(img, dx, dy, dw, dh, cropY) {
  if (!img) return;
  const cropH = img.width * (dh / dw);
  const maxY = Math.max(0, img.height - cropH);
  const sy = clamp(cropY, 0, maxY);
  ctx.drawImage(img, 0, sy, img.width, cropH, dx, dy, dw, dh);
}

function sceneCreate(t) {
  eyebrow('Crea', 150, 122, C.orange, anim(t, 0.05, 0.4));
  txt(ctx, 'Créala en 3 formas.', 150, 206, {
    size: 74, weight: 800, color: C.cream, alpha: anim(t, 0.1, 0.55),
  });
  txt(ctx, 'La misma hoja. El camino que prefieras.', 152, 254, {
    size: 27, weight: 500, family: 'Inter', color: C.muted, alpha: anim(t, 0.25, 0.55),
  });

  const wx = 180, wy = 312, ww = 1560, wh = 676;
  const e = anim(t, 0.15, 0.7, E.outExpo);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(0, (1 - e) * 60);

  shadowed(ctx, { blur: 70, y: 34, color: 'rgba(0,0,0,0.6)' }, () => {
    fillRR(ctx, wx, wy, ww, wh, 22, C.paper);
  });
  fillRR(ctx, wx, wy, ww, 58, 22, C.paper2);
  ctx.fillStyle = C.paper2;
  ctx.fillRect(wx, wy + 36, ww, 22);

  // puntos + url
  [C.red, C.orangeMid, C.greenMid].forEach((col, i) => {
    circle(ctx, wx + 30 + i * 24, wy + 29, 7, col);
  });
  fillRR(ctx, wx + 120, wy + 12, 780, 34, 17, 'rgba(43,42,38,0.07)');
  txt(ctx, 'mydinoenglish · editor de hojas', wx + 144, wy + 30, {
    size: 16, weight: 500, family: 'Inter', color: 'rgba(43,42,38,0.5)', baseline: 'middle',
  });

  // pestañas
  const idx = t < TAB_TIMES[1] ? 0 : t < TAB_TIMES[2] ? 1 : 2;
  let tx = wx + 26;
  TABS.forEach((tab, i) => {
    const active = i === idx;
    const pop = active ? 1 + 0.04 * bump(t, TAB_TIMES[i] ?? 0, 0.25) : 1;
    const tw = measure(ctx, tab.label, { size: 21, weight: 600, family: 'Inter' }) + 74;
    const th = 42;
    ctx.save();
    ctx.translate(tx + tw / 2, wy + 88);
    ctx.scale(pop, pop);
    fillRR(ctx, -tw / 2, -th / 2, tw, th, 21,
      active ? 'rgba(132,184,76,0.18)' : 'rgba(43,42,38,0.045)');
    if (active) strokeRR(ctx, -tw / 2, -th / 2, tw, th, 21, 'rgba(61,94,36,0.4)', 1.5);
    icon(ctx, tab.icon, -tw / 2 + 30, 0, 18, active ? C.greenDeep : 'rgba(43,42,38,0.5)');
    txt(ctx, tab.label, -tw / 2 + 48, 1, {
      size: 21, weight: 600, family: 'Inter', baseline: 'middle',
      color: active ? C.greenDeep : 'rgba(43,42,38,0.55)',
    });
    ctx.restore();
    tx += tw + 10;
  });

  // captura
  const sx = wx + 22, sy = wy + 116, sw = ww - 44, sh = wh - 132;
  ctx.save();
  rr(ctx, sx, sy, sw, sh, 12);
  ctx.clip();
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(sx, sy, sw, sh);

  const drawTab = (i, alpha) => {
    if (alpha <= 0) return;
    const tab = TABS[i];
    const start = TAB_TIMES[i] ?? 0;
    const end = TAB_TIMES[i + 1] ?? 9;
    const p = inv(t, start, end);
    const cropY = lerp(tab.from, tab.to, E.inOutCubic(p));
    ctx.globalAlpha = alpha;
    shot(IMG[tab.img], sx, sy, sw, sh, cropY);
  };

  if (idx === 0) drawTab(0, 1);
  else {
    const f = E.outCubic(inv(t, TAB_TIMES[idx], TAB_TIMES[idx] + 0.35));
    drawTab(idx - 1, 1 - f);
    drawTab(idx, f);
  }

  // difumina los cortes del paneo para que parezcan parte del diseño
  const ft = ctx.createLinearGradient(0, sy, 0, sy + 46);
  ft.addColorStop(0, 'rgba(252,250,242,0.95)');
  ft.addColorStop(1, 'rgba(252,250,242,0)');
  ctx.fillStyle = ft;
  ctx.fillRect(sx, sy, sw, 46);
  const fb = ctx.createLinearGradient(0, sy + sh - 34, 0, sy + sh);
  fb.addColorStop(0, 'rgba(252,250,242,0)');
  fb.addColorStop(1, 'rgba(252,250,242,0.9)');
  ctx.fillStyle = fb;
  ctx.fillRect(sx, sy + sh - 34, sw, 34);
  ctx.restore();
  ctx.globalAlpha = 1;

  // etiqueta de la pestaña activa, arriba a la derecha (no tapa la captura)
  const callT = TAB_TIMES[idx] + 0.35;
  const ca = anim(t, callT, 0.45, E.outBack);
  if (ca > 0) {
    const tab = TABS[idx];
    const label = tab.callout;
    const tw = measure(ctx, label, { size: 22, weight: 600, family: 'Inter' });
    const bx = wx + ww - tw - 100;
    const by = 150;
    ctx.save();
    ctx.globalAlpha = ca;
    ctx.translate(0, (1 - ca) * 18);
    fillRR(ctx, bx, by, tw + 62, 50, 25, 'rgba(10,13,8,0.72)');
    strokeRR(ctx, bx, by, tw + 62, 50, 25, 'rgba(199,240,138,0.42)', 1.3);
    circle(ctx, bx + 28, by + 25, 5.5, C.green);
    txt(ctx, label, bx + 46, by + 26, {
      size: 22, weight: 600, family: 'Inter', color: C.cream, baseline: 'middle',
    });
    ctx.restore();
  }

  // borde del marco
  strokeRR(ctx, wx, wy, ww, wh, 22, 'rgba(255,255,255,0.16)', 1.4);
  ctx.restore();

  txt(ctx, 'Describe, arrastra o escribe: tú eliges.', 152, 1034, {
    size: 25, weight: 500, family: 'Inter', color: C.muted, alpha: anim(t, 0.8, 0.5),
  });
}

/* ── escena 4 · actividades ─────────────────────────────────────────── */

const CHIPS = [
  'Fill in the blank', 'Multiple choice', 'Multi-select',
  'Poll', 'Drag & drop', 'Open writing',
  'Matching', 'Speaking', 'Reading',
  'Image question', 'Image choice', 'Image matching',
  'Listening', 'Listening fill', 'Listening MC',
  'Listening matching', 'Listening T/F', 'Listen & order',
  'Conversation', 'True / False', 'Reading T/F',
];

function activityCard(x, y, w, h, p, { iconName, title, sub, kind, time }) {
  if (p <= 0) return;
  ctx.save();
  ctx.globalAlpha = p;
  ctx.translate((1 - p) * -70, 0);
  fillRR(ctx, x, y, w, h, 22, 'rgba(255,255,255,0.045)');
  strokeRR(ctx, x, y, w, h, 22, 'rgba(199,240,138,0.2)', 1.3);

  fillRR(ctx, x + 26, y + 34, 64, 64, 18, 'rgba(199,240,138,0.14)');
  icon(ctx, iconName, x + 58, y + 66, 30, C.green);
  txt(ctx, title, x + 112, y + 62, { size: 33, weight: 700, family: 'Poppins', color: C.cream });
  txt(ctx, sub, x + 112, y + 94, { size: 19, weight: 500, family: 'Inter', color: C.muted });

  // mini visual
  const vx = x + 500, vy = y + h / 2;
  if (kind === 'wave') {
    for (let i = 0; i < 18; i++) {
      const hh = 12 + Math.abs(Math.sin(time * 3.2 + i * 0.6)) * 34;
      fillRR(ctx, vx + i * 12, vy - hh / 2, 5, hh, 3, i % 3 === 0 ? C.orange : C.green);
    }
    circle(ctx, vx - 34, vy, 24, C.green);
    icon(ctx, 'play', vx - 32, vy, 18, C.ink);
  } else if (kind === 'mic') {
    const pulse = (time * 0.8) % 1;
    ctx.beginPath();
    ctx.arc(vx + 60, vy, 26 + pulse * 34, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(199,240,138,${0.4 * (1 - pulse)})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    circle(ctx, vx + 60, vy, 32, 'rgba(199,240,138,0.16)');
    icon(ctx, 'mic', vx + 60, vy, 30, C.green);
  } else {
    const wordsA = ['She', 'They', 'Did'];
    const wordsB = ['is', 'watched', 'finish'];
    wordsA.forEach((wd, i) => {
      fillRR(ctx, vx - 6, vy - 54 + i * 34, 86, 26, 8, 'rgba(255,255,255,0.08)');
      txt(ctx, wd, vx + 8, vy - 36 + i * 34, { size: 17, weight: 600, family: 'Inter', color: C.cream });
    });
    wordsB.forEach((wd, i) => {
      fillRR(ctx, vx + 120, vy - 54 + i * 34, 108, 26, 8, 'rgba(255,255,255,0.08)');
      txt(ctx, wd, vx + 132, vy - 36 + i * 34, { size: 17, weight: 600, family: 'Inter', color: C.cream });
    });
    const lp = E.outCubic(clamp(time * 0.9 - 0.3));
    const pairs = [[0, 1], [1, 2], [2, 0]];
    ctx.strokeStyle = C.orange;
    ctx.lineWidth = 2.4;
    pairs.forEach(([a, b], i) => {
      const p = clamp(lp * 1.4 - i * 0.18);
      if (p <= 0) return;
      const x1 = vx + 84, y1 = vy - 41 + a * 34;
      const x2 = vx + 116, y2 = vy - 41 + b * 34;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2, lerp(x1, x2, p), lerp(y1, y2, p));
      ctx.stroke();
    });
  }
  ctx.restore();
}

function sceneActivities(t) {
  const count = Math.round(21 * E.outCubic(inv(t, 0.2, 1.5)));
  const cw = measure(ctx, String(count), { size: 74, weight: 800 });
  eyebrow('Todo en una hoja', 150, 122, C.orange, anim(t, 0.05, 0.4));
  txt(ctx, String(count).padStart(2, '0'), 150, 210, {
    size: 74, weight: 800, color: C.green, alpha: anim(t, 0.15, 0.4),
  });
  txt(ctx, ' tipos de actividad.', 150 + cw, 210, {
    size: 74, weight: 800, color: C.cream, alpha: anim(t, 0.15, 0.4),
  });
  txt(ctx, 'Gramática, lectura, escucha, habla y escritura.', 152, 256, {
    size: 26, weight: 500, family: 'Inter', color: C.muted, alpha: anim(t, 0.3, 0.5),
  });

  activityCard(150, 320, 800, 190, anim(t, 0.35, 0.55, E.outBack), {
    iconName: 'headphones', title: 'Listening', sub: 'Audio con voz sintética', kind: 'wave', time: t,
  });
  activityCard(150, 540, 800, 190, anim(t, 0.55, 0.55, E.outBack), {
    iconName: 'mic', title: 'Speaking', sub: 'El alumno habla al micrófono', kind: 'mic', time: t,
  });
  activityCard(150, 760, 800, 190, anim(t, 0.75, 0.55, E.outBack), {
    iconName: 'link', title: 'Matching', sub: 'Une con líneas', kind: 'match', time: t,
  });

  const gx = 1040, gy = 342, cwid = 244, ch = 58, gap = 12;
  CHIPS.forEach((label, i) => {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const p = anim(t, 0.7 + (row + col) * 0.05, 0.4, E.outBack);
    if (p <= 0) return;
    const x = gx + col * (cwid + gap);
    const y = gy + row * (ch + gap);
    const hot = [12, 7, 6].includes(i);
    ctx.save();
    ctx.globalAlpha = p * (hot ? 1 : 0.85);
    ctx.translate(x + cwid / 2, y + ch / 2);
    ctx.scale(lerp(0.8, 1, p), lerp(0.8, 1, p));
    fillRR(ctx, -cwid / 2, -ch / 2, cwid, ch, 14,
      hot ? 'rgba(199,240,138,0.12)' : 'rgba(255,255,255,0.04)');
    strokeRR(ctx, -cwid / 2, -ch / 2, cwid, ch, 14,
      hot ? 'rgba(199,240,138,0.5)' : 'rgba(255,255,255,0.1)', 1.2);
    circle(ctx, -cwid / 2 + 22, 0, 4, hot ? C.green : 'rgba(233,241,222,0.28)');
    txt(ctx, label, -cwid / 2 + 38, 1, {
      size: 19, weight: 600, family: 'Inter',
      color: hot ? C.green : 'rgba(233,241,222,0.78)', baseline: 'middle',
    });
    ctx.restore();
  });

  txt(ctx, 'Audio sintetizado · micrófono · arrastrar · unir con líneas.', 152, 1024, {
    size: 24, weight: 500, family: 'Inter', color: C.muted, alpha: anim(t, 1.1, 0.5),
  });
}

/* ── escena 5 · enlace ──────────────────────────────────────────────── */

function fakeQR(x, y, size, seed = 3) {
  const r = rng(seed);
  const n = 21;
  const m = size / n;
  ctx.save();
  ctx.fillStyle = 'rgba(233,241,222,0.85)';
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const finder = (i < 7 && j < 7) || (i < 7 && j > 13) || (i > 13 && j < 7);
      if (finder) continue;
      if (r() > 0.56) ctx.fillRect(x + i * m, y + j * m, m * 0.86, m * 0.86);
    }
  }
  for (const [fi, fj] of [[0, 0], [14, 0], [0, 14]]) {
    ctx.fillStyle = 'rgba(233,241,222,0.92)';
    ctx.fillRect(x + fi * m, y + fj * m, m * 7, m * 7);
    ctx.fillStyle = C.bg;
    ctx.fillRect(x + (fi + 1) * m, y + (fj + 1) * m, m * 5, m * 5);
    ctx.fillStyle = 'rgba(233,241,222,0.92)';
    ctx.fillRect(x + (fi + 2) * m, y + (fj + 2) * m, m * 3, m * 3);
  }
  ctx.restore();
}

function phone(x, y, s, t) {
  const w = 400, h = 800;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);

  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 30;
  fillRR(ctx, -w / 2, -h / 2, w, h, 46, '#171A12');
  ctx.shadowColor = 'transparent';
  strokeRR(ctx, -w / 2, -h / 2, w, h, 46, 'rgba(199,240,138,0.28)', 2);
  fillRR(ctx, -w / 2 + 11, -h / 2 + 11, w - 22, h - 22, 36, C.paper);

  // cámara
  fillRR(ctx, -40, -h / 2 + 20, 80, 18, 9, '#171A12');

  // cabecera
  txt(ctx, '9:41', -w / 2 + 30, -h / 2 + 54, {
    size: 13, weight: 700, family: 'Inter', color: C.ink,
  });
  txt(ctx, '▮▮▮', w / 2 - 30, -h / 2 + 54, {
    size: 12, weight: 700, family: 'Inter', color: C.ink, align: 'right',
  });
  txt(ctx, 'MyDinoEnglish', 0, -h / 2 + 92, {
    size: 16, weight: 800, color: C.greenDeep, align: 'center', ls: 0.2,
  });
  fillRR(ctx, -w / 2 + 20, -h / 2 + 108, w - 40, 2, 1, 'rgba(43,42,38,0.1)');

  txt(ctx, 'Past Simple — Unit 3', -w / 2 + 26, -h / 2 + 150, {
    size: 23, weight: 800, color: C.ink,
  });
  txt(ctx, 'A2 · 20 min · 3 actividades', -w / 2 + 26, -h / 2 + 174, {
    size: 13, weight: 500, family: 'Inter', color: 'rgba(43,42,38,0.55)',
  });

  // tarjeta de pregunta
  const qx = -w / 2 + 22, qy = -h / 2 + 196, qw = w - 44, qh = 300;
  fillRR(ctx, qx, qy, qw, qh, 18, C.white);
  strokeRR(ctx, qx, qy, qw, qh, 18, 'rgba(43,42,38,0.1)', 1);
  txt(ctx, '1', qx + 18, qy + 32, {
    size: 12, weight: 700, family: 'Inter', color: C.greenDeep,
  });
  txt(ctx, 'Fill in the blank', qx + 38, qy + 32, {
    size: 12, weight: 700, family: 'Inter', color: 'rgba(43,42,38,0.45)', ls: 0.6,
  });
  txt(ctx, 'She ____ reading now.', qx + 18, qy + 76, {
    size: 22, weight: 700, family: 'Inter', color: C.ink,
  });

  const opts = ['is', 'are', 'be'];
  const tapT = 3.3;
  const chosen = t > tapT + 0.12;
  opts.forEach((op, i) => {
    const oy = qy + 104 + i * 52;
    const isChosen = i === 0 && chosen;
    fillRR(ctx, qx + 14, oy, qw - 28, 42, 11,
      isChosen ? 'rgba(132,184,76,0.2)' : 'rgba(43,42,38,0.035)');
    if (isChosen) strokeRR(ctx, qx + 14, oy, qw - 28, 42, 11, C.greenMid, 1.6);
    ctx.beginPath();
    ctx.arc(qx + 36, oy + 21, 8, 0, Math.PI * 2);
    ctx.strokeStyle = isChosen ? C.greenMid : 'rgba(43,42,38,0.25)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    if (isChosen) circle(ctx, qx + 36, oy + 21, 4.5, C.greenMid);
    txt(ctx, op, qx + 54, oy + 22, {
      size: 18, weight: 600, family: 'Inter', color: C.ink, baseline: 'middle',
    });
  });

  // pulsación sobre "is"
  const pr = inv(t, tapT, tapT + 0.45);
  if (pr > 0 && pr < 1) {
    ctx.beginPath();
    ctx.arc(qx + 36, qy + 125, 8 + pr * 26, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(132,184,76,${0.7 * (1 - pr)})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // botón enviar
  const sendT = 4.35;
  const sendP = inv(t, sendT, sendT + 0.2);
  const pressed = sendP > 0 && sendP < 1;
  ctx.save();
  ctx.translate(0, pressed ? 2 : 0);
  fillRR(ctx, qx, -h / 2 + 536, qw, 58, 15, C.greenMid);
  txt(ctx, 'Enviar respuestas', 0, -h / 2 + 570, {
    size: 19, weight: 700, family: 'Inter', color: C.white, align: 'center', baseline: 'middle',
  });
  ctx.restore();

  txt(ctx, '2 · Multiple choice', qx + 2, -h / 2 + 640, {
    size: 12, weight: 600, family: 'Inter', color: 'rgba(43,42,38,0.35)',
  });
  txt(ctx, '3 · Listen and order', qx + 2, -h / 2 + 664, {
    size: 12, weight: 600, family: 'Inter', color: 'rgba(43,42,38,0.35)',
  });

  // éxito
  const ok = anim(t, sendT + 0.35, 0.5, E.outBack);
  if (ok > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(ok);
    ctx.translate(0, 0);
    fillRR(ctx, -w / 2 + 11, -h / 2 + 11, w - 22, h - 22, 36, 'rgba(10,13,8,0.975)');
    const ring = 58 * ok;
    circle(ctx, 0, -40, ring, C.greenMid);
    icon(ctx, 'check', 0, -40, 60, C.white);
    txt(ctx, '¡Enviado!', 0, 60, {
      size: 34, weight: 800, color: C.cream, align: 'center', baseline: 'middle',
    });
    txt(ctx, 'El profesor ya la tiene.', 0, 100, {
      size: 16, weight: 500, family: 'Inter', color: C.muted, align: 'center', baseline: 'middle',
    });
    ctx.restore();
  }
  ctx.restore();
}

function sceneShare(t) {
  eyebrow('Comparte', 150, 128, C.orange, anim(t, 0.05, 0.4));
  txt(ctx, 'Un enlace. Eso es todo.', 150, 216, {
    size: 74, weight: 800, color: C.cream, alpha: anim(t, 0.1, 0.55),
  });

  const e = anim(t, 0.25, 0.6, E.outBack);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.translate(0, (1 - e) * 24);
  fillRR(ctx, 150, 296, 1000, 112, 56, 'rgba(255,255,255,0.05)');
  strokeRR(ctx, 150, 296, 1000, 112, 56, 'rgba(199,240,138,0.35)', 1.6);
  circle(ctx, 206, 352, 26, 'rgba(199,240,138,0.14)');
  icon(ctx, 'link', 206, 352, 26, C.green);

  txt(ctx, 'constructor-hojas-web.onrender.com', 250, 340, {
    size: 21, weight: 500, family: 'Inter', color: C.dim,
  });
  txt(ctx, '/w/past-simple-a2', 250, 382, {
    size: 32, weight: 700, family: 'Inter', color: C.cream,
  });

  const copied = t > 1.55;
  fillRR(ctx, 926, 326, 190, 52, 26, copied ? 'rgba(199,240,138,0.22)' : C.green);
  if (copied) strokeRR(ctx, 926, 326, 190, 52, 26, C.green, 1.4);
  txt(ctx, copied ? 'Copiado ✓' : 'Copiar', 1021, 354, {
    size: 21, weight: 700, family: 'Inter', color: copied ? C.green : C.ink,
    align: 'center', baseline: 'middle',
  });
  ctx.restore();

  // toast
  const toast = anim(t, 1.6, 0.4, E.outBack);
  if (toast > 0) {
    ctx.save();
    ctx.globalAlpha = toast;
    ctx.translate(0, (1 - toast) * -20);
    fillRR(ctx, 640, 240, 260, 48, 24, 'rgba(199,240,138,0.16)');
    strokeRR(ctx, 640, 240, 260, 48, 24, 'rgba(199,240,138,0.5)', 1.2);
    txt(ctx, 'Enlace copiado', 770, 265, {
      size: 19, weight: 600, family: 'Inter', color: C.green, align: 'center', baseline: 'middle',
    });
    ctx.restore();
  }

  // cursor sobre copiar
  const cp = inv(t, 1.1, 1.5);
  if (cp > 0 && t < 2.1) {
    const cx = lerp(1180, 1060, E.outCubic(cp));
    const cy = lerp(560, 358, E.outCubic(cp));
    cursor(cx, cy, 1.1, t > 1.45 && t < 1.85 ? (t - 1.45) / 0.4 : 0);
  }

  // bullets
  const items = ['Sin cuenta', 'Sin instalar nada', 'Sin fricción'];
  items.forEach((label, i) => {
    const p = anim(t, 0.85 + i * 0.16, 0.5, E.outBack);
    if (p <= 0) return;
    ctx.save();
    ctx.globalAlpha = p;
    ctx.translate((1 - p) * -30, 0);
    circle(ctx, 186, 520 + i * 72, 19, 'rgba(199,240,138,0.14)');
    icon(ctx, 'check', 186, 520 + i * 72, 20, C.green);
    txt(ctx, label, 222, 530 + i * 72, {
      size: 31, weight: 600, family: 'Inter', color: C.cream,
    });
    ctx.restore();
  });

  const pe = anim(t, 1.6, 0.7, E.outBack);
  if (pe > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(pe);
    ctx.translate(0, (1 - pe) * 90);
    ctx.rotate((1 - pe) * 0.06);
    phone(1470, 610, 0.9, t);
    ctx.restore();
  }

  txt(ctx, 'El alumno solo abre el enlace y responde.', 152, 936, {
    size: 28, weight: 500, family: 'Inter', color: C.muted, alpha: anim(t, 1.2, 0.5),
  });
}

/* ── escena 6 · calificación ────────────────────────────────────────── */

const confettiP = (() => {
  const r = rng(42);
  return Array.from({ length: 90 }, () => ({
    a: r() * Math.PI * 2,
    v: 260 + r() * 640,
    s: 6 + r() * 12,
    spin: (r() - 0.5) * 14,
    life: 1.5 + r() * 1.3,
    col: [C.green, C.orange, C.cream, C.greenMid, C.orangeMid][Math.floor(r() * 5)],
  }));
})();

function confetti(cx, cy, t, start) {
  const p = t - start;
  if (p < 0) return;
  for (const c of confettiP) {
    if (p > c.life) continue;
    const x = cx + Math.cos(c.a) * c.v * p * 0.9;
    const y = cy + Math.sin(c.a) * c.v * p * 0.6 + 520 * p * p;
    const a = 1 - p / c.life;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(x, y);
    ctx.rotate(c.a + c.spin * p);
    ctx.fillStyle = c.col;
    ctx.fillRect(-c.s / 2, -c.s / 4, c.s, c.s / 2);
    ctx.restore();
  }
}

function sceneGrade(t) {
  eyebrow('Calificación', 150, 122, C.orange, anim(t, 0.05, 0.4));
  const hA = 'Se califica ';
  const hB = 'sola.';
  const hw = measure(ctx, hA, { size: 74, weight: 800 });
  const ha = anim(t, 0.1, 0.55);
  txt(ctx, hA, 150, 212, { size: 74, weight: 800, color: C.cream, alpha: ha });
  txt(ctx, hB, 150 + hw, 212, { size: 74, weight: 800, color: C.green, alpha: ha });

  const cx = 500, cy = 660, rad = 168;
  const ringIn = anim(t, 0.35, 0.6, E.outBack);
  if (ringIn > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(ringIn);
    ctx.translate(cx, cy);
    ctx.scale(ringIn, ringIn);

    // marcas
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
      const r1 = rad + 24, r2 = rad + (i % 5 === 0 ? 36 : 30);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      ctx.strokeStyle = i % 5 === 0 ? 'rgba(233,241,222,0.28)' : 'rgba(233,241,222,0.1)';
      ctx.lineWidth = i % 5 === 0 ? 2 : 1.2;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 30;
    ctx.stroke();

    const val = E.outCubic(inv(t, 1.0, 3.1));
    const ang = val * Math.PI * 2;
    const grad = ctx.createLinearGradient(-rad, -rad, rad, rad);
    grad.addColorStop(0, C.green);
    grad.addColorStop(0.7, C.greenMid);
    grad.addColorStop(1, C.orange);
    ctx.beginPath();
    ctx.arc(0, 0, rad, -Math.PI / 2, -Math.PI / 2 + ang);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 30;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(199,240,138,0.55)';
    ctx.shadowBlur = 34;
    ctx.stroke();
    ctx.shadowColor = 'transparent';

    const score = Math.round(92 * val);
    txt(ctx, String(score), 0, 22, {
      size: 132, weight: 800, color: C.cream, align: 'center', baseline: 'middle', ls: -4,
    });
    txt(ctx, '/ 100', 0, 102, {
      size: 30, weight: 600, family: 'Inter', color: C.muted, align: 'center', baseline: 'middle',
    });
    txt(ctx, 'NOTA FINAL', 0, -110, {
      size: 16, weight: 700, family: 'Inter', color: C.dim, align: 'center', baseline: 'middle', ls: 4,
    });
    ctx.restore();
  }

  const rows = [
    ['10 cerradas · al instante', 'check'],
    ['2 abiertas · con IA', 'spark'],
  ];
  rows.forEach(([label, ic], i) => {
    const p = anim(t, 2.0 + i * 0.2, 0.45, E.outBack);
    if (p <= 0) return;
    ctx.save();
    ctx.globalAlpha = p;
    circle(ctx, 190, 880 + i * 62, 18, 'rgba(199,240,138,0.12)');
    icon(ctx, ic, 190, 880 + i * 62, 19, i === 0 ? C.green : C.orange);
    txt(ctx, label, 224, 890 + i * 62, {
      size: 27, weight: 600, family: 'Inter', color: C.muted,
    });
    ctx.restore();
  });

  // tarjeta de corrección
  const ce = anim(t, 1.6, 0.7, E.outBack);
  if (ce > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(ce);
    ctx.translate(960 + (1 - ce) * 80, 300);
    ctx.rotate((1 - ce) * 0.03);
    shadowed(ctx, { blur: 50, y: 26, color: 'rgba(0,0,0,0.45)' }, () => {
      fillRR(ctx, 0, 0, 800, 500, 26, C.paper);
    });
    fillRR(ctx, 0, 0, 10, 500, 6, C.greenMid);

    drawRex('happy', 96, 92, 150, 1, t, false);
    txt(ctx, 'Corrección con IA', 186, 74, {
      size: 31, weight: 800, color: C.ink,
    });
    fillRR(ctx, 186, 92, 132, 32, 16, 'rgba(132,184,76,0.2)');
    txt(ctx, 'en español', 252, 109, {
      size: 16, weight: 700, family: 'Inter', color: C.greenDeep, align: 'center', baseline: 'middle',
    });

    ctx.strokeStyle = 'rgba(43,42,38,0.12)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(40, 178);
    ctx.lineTo(760, 178);
    ctx.stroke();

    wrapped(
      ctx,
      '«¡Muy bien! Casi perfecto. Recuerda que “She is reading” necesita el verbo to be.»',
      40, 240, 700,
      { size: 31, weight: 500, family: 'Inter', color: C.ink, lh: 46 },
    );

    // corrección concreta
    fillRR(ctx, 40, 320, 720, 86, 14, 'rgba(132,184,76,0.13)');
    txt(ctx, 'CORRECCIÓN', 64, 348, {
      size: 12, weight: 700, family: 'Inter', color: 'rgba(61,94,36,0.55)', ls: 2.2,
    });
    const wrong = 'She are reading';
    const wWrong = measure(ctx, wrong, { size: 25, weight: 500, family: 'Inter' });
    txt(ctx, wrong, 64, 382, {
      size: 25, weight: 500, family: 'Inter', color: 'rgba(43,42,38,0.55)',
    });
    ctx.strokeStyle = 'rgba(228,87,61,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(62, 374);
    ctx.lineTo(64 + wWrong, 374);
    ctx.stroke();
    txt(ctx, '→', 64 + wWrong + 18, 383, {
      size: 26, weight: 600, family: 'Inter', color: 'rgba(43,42,38,0.4)',
    });
    txt(ctx, 'She is reading', 64 + wWrong + 58, 382, {
      size: 25, weight: 700, family: 'Inter', color: C.greenDeep,
    });

    txt(ctx, 'Comentario para el alumno', 40, 456, {
      size: 16, weight: 600, family: 'Inter', color: 'rgba(43,42,38,0.45)', ls: 0.4,
    });
    circle(ctx, 726, 450, 16, 'rgba(132,184,76,0.18)');
    icon(ctx, 'check', 726, 450, 18, C.greenDeep);
    ctx.restore();
  }

  confetti(500, 660, t, 4.2);

  txt(ctx, 'Lo cerrado, exacto. Lo abierto, con IA.', 962, 880, {
    size: 27, weight: 500, family: 'Inter', color: C.muted, alpha: anim(t, 2.4, 0.5),
  });
}

/* ── escena 7 · en vivo y juegos ────────────────────────────────────── */

function sceneGames(t) {
  eyebrow('En clase', 150, 118, C.orange, anim(t, 0.05, 0.4));
  txt(ctx, 'Y en clase, todos juegan.', 150, 204, {
    size: 68, weight: 800, color: C.cream, alpha: anim(t, 0.1, 0.5),
  });

  const e = anim(t, 0.2, 0.6, E.outBack);
  if (e > 0) {
    ctx.save();
    ctx.globalAlpha = e;
    ctx.translate((1 - e) * -60, 0);
    fillRR(ctx, 150, 280, 700, 650, 26, 'rgba(255,255,255,0.045)');
    strokeRR(ctx, 150, 280, 700, 650, 26, 'rgba(199,240,138,0.25)', 1.4);

    fillRR(ctx, 190, 320, 148, 44, 22, 'rgba(228,87,61,0.16)');
    circle(ctx, 214, 342, 6, C.red);
    txt(ctx, 'EN VIVO', 230, 343, {
      size: 17, weight: 800, family: 'Inter', color: C.red, baseline: 'middle', ls: 1.4,
    });
    txt(ctx, 'Código de sala', 192, 424, {
      size: 19, weight: 600, family: 'Inter', color: C.dim,
    });

    const code = 'DINOS';
    [...code].forEach((ch, i) => {
      const p = anim(t, 0.55 + i * 0.07, 0.4, E.outBack);
      ctx.save();
      ctx.globalAlpha *= clamp(p);
      ctx.translate(0, (1 - p) * 18);
      fillRR(ctx, 190 + i * 96, 446, 84, 104, 16, 'rgba(199,240,138,0.1)');
      strokeRR(ctx, 190 + i * 96, 446, 84, 104, 16, 'rgba(199,240,138,0.4)', 1.4);
      txt(ctx, ch, 232 + i * 96, 500, {
        size: 56, weight: 800, color: C.cream, align: 'center', baseline: 'middle',
      });
      ctx.restore();
    });

    txt(ctx, '24 alumnos conectados', 192, 606, {
      size: 25, weight: 600, family: 'Inter', color: C.cream,
    });
    ctx.strokeStyle = 'rgba(233,241,222,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(190, 642);
    ctx.lineTo(810, 642);
    ctx.stroke();
    txt(ctx, 'Sesión sincronizada', 192, 690, {
      size: 23, weight: 700, color: C.green,
    });
    txt(ctx, 'Pregunta por pregunta, todos a la vez.', 192, 724, {
      size: 18, weight: 500, family: 'Inter', color: C.muted,
    });
    fakeQR(636, 676, 150, 11);
    txt(ctx, 'Escanea para entrar', 636, 858, {
      size: 14, weight: 500, family: 'Inter', color: C.dim,
    });
    ctx.restore();
  }

  const tiles = [
    { x: 920, y: 280, title: 'Carrera de dinos', sub: 'Por equipos', emoji: '🦖', bg: 'rgba(132,184,76,0.16)', br: 'rgba(199,240,138,0.4)' },
    { x: 1344, y: 280, title: 'Bingo', sub: 'Toda la clase', emoji: '🎲', bg: 'rgba(238,123,48,0.16)', br: 'rgba(255,176,122,0.4)' },
    { x: 920, y: 604, title: 'El corcho', sub: 'Tableros numerados', emoji: '📌', bg: 'rgba(255,255,255,0.06)', br: 'rgba(233,241,222,0.22)' },
    { x: 1344, y: 604, title: 'Speaking', sub: 'Por turnos', emoji: '🎤', bg: 'rgba(199,240,138,0.1)', br: 'rgba(199,240,138,0.3)' },
  ];
  tiles.forEach((tl, i) => {
    const p = anim(t, 0.7 + i * 0.11, 0.45, E.outBack);
    if (p <= 0) return;
    ctx.save();
    ctx.globalAlpha = clamp(p);
    ctx.translate(tl.x + 200, tl.y + 150);
    ctx.scale(lerp(0.86, 1, p), lerp(0.86, 1, p));
    ctx.rotate((i % 2 ? 1 : -1) * (1 - p) * 0.05);
    fillRR(ctx, -200, -150, 400, 300, 24, tl.bg);
    strokeRR(ctx, -200, -150, 400, 300, 24, tl.br, 1.5);
    txt(ctx, tl.emoji, -168, -62, {
      size: 66, weight: 400, family: '"Segoe UI Emoji"', color: C.cream, baseline: 'middle',
    });
    txt(ctx, tl.title, -168, 74, {
      size: 30, weight: 800, color: C.cream,
    });
    txt(ctx, tl.sub, -168, 106, {
      size: 18, weight: 500, family: 'Inter', color: C.muted,
    });
    ctx.restore();
  });

  txt(ctx, 'Sesión en vivo · 29 juegos por enlace.', 152, 1006, {
    size: 24, weight: 500, family: 'Inter', color: C.muted, alpha: anim(t, 1.2, 0.5),
  });
}

/* ── escena 8 · cierre ──────────────────────────────────────────────── */

function sceneEnd(t) {
  glow(ctx, 960, 360, 620, 'rgba(132,184,76,ALPHA)', 0.3);

  const rexIn = anim(t, 0.05, 0.7, E.outBack);
  drawRex('hero', 960, 330, 300, 0.8 + 0.2 * rexIn, t);

  const wm = anim(t, 0.25, 0.9);
  wordmark(960, 574, 108, wm, true);

  const tag = anim(t, 0.65, 0.7);
  const line1 = 'Hojas de trabajo de inglés ';
  const line2 = 'que se corrigen solas.';
  const w1 = measure(ctx, line1, { size: 37, weight: 600, family: 'Inter' });
  const w2 = measure(ctx, line2, { size: 37, weight: 600, family: 'Inter' });
  const total = w1 + w2;
  txt(ctx, line1, 960 - total / 2, 648, {
    size: 37, weight: 600, family: 'Inter', color: C.cream, alpha: tag,
  });
  txt(ctx, line2, 960 - total / 2 + w1, 648, {
    size: 37, weight: 600, family: 'Inter', color: C.green, alpha: tag,
  });

  const stats = anim(t, 0.95, 0.5);
  txt(ctx, '21 tipos de actividad · 29 juegos · 0 instalación', 960, 700, {
    size: 21, weight: 600, family: 'Inter', color: C.dim, align: 'center', alpha: stats, ls: 0.6,
  });

  const cta = anim(t, 1.15, 0.6, E.outBack);
  if (cta > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(cta);
    ctx.translate(960, 790);
    ctx.scale(lerp(0.9, 1, cta), lerp(0.9, 1, cta));
    ctx.shadowColor = 'rgba(199,240,138,0.4)';
    ctx.shadowBlur = 40;
    fillRR(ctx, -222, -43, 444, 86, 43, C.green);
    ctx.shadowColor = 'transparent';
    txt(ctx, 'Empieza gratis', -18, 2, {
      size: 29, weight: 800, family: 'Inter', color: C.ink, align: 'center', baseline: 'middle',
    });
    icon(ctx, 'arrow', 150, 1, 24, C.ink);
    ctx.restore();
  }

  const url = anim(t, 1.5, 0.5);
  txt(ctx, 'constructor-hojas-web.onrender.com', 960, 888, {
    size: 26, weight: 600, family: 'Inter', color: C.muted, align: 'center', alpha: url, ls: 0.4,
  });
  txt(ctx, 'HECHO PARA PROFESORES DE INGLÉS', 960, 948, {
    size: 16, weight: 700, family: 'Inter', color: C.dim, align: 'center', alpha: anim(t, 1.8, 0.5), ls: 4,
  });
}

/* ── montaje ────────────────────────────────────────────────────────── */

const SCENES = [
  { start: 0, end: 5, draw: sceneHook },
  { start: 5, end: 10, draw: sceneBrand },
  { start: 10, end: 18, draw: sceneCreate },
  { start: 18, end: 26, draw: sceneActivities },
  { start: 26, end: 33, draw: sceneShare },
  { start: 33, end: 41, draw: sceneGrade },
  { start: 41, end: 46.5, draw: sceneGames },
  { start: 46.5, end: DURATION + 1, draw: sceneEnd },
];

export function drawFrame(c, time) {
  ctx = c;
  const t = clamp(time, 0, DURATION - 0.0001);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  background(ctx, t);

  const scene = SCENES.find((s) => t >= s.start && t < s.end) ?? SCENES[SCENES.length - 1];
  ctx.save();
  const punch = punchAt(t, CUTS, 0.01);
  if (punch !== 1) {
    ctx.translate(W / 2, H / 2);
    ctx.scale(punch, punch);
    ctx.translate(-W / 2, -H / 2);
  }
  scene.draw(t - scene.start, t);
  ctx.restore();

  // barridos de transición
  if (t >= 4.55 && t <= 5.45) wipe(ctx, inv(t, 4.55, 5.45), C.green, C.orangeMid);
  if (t >= 17.65 && t <= 18.35) wipe(ctx, inv(t, 17.65, 18.35), C.orangeMid, C.green);
  if (t >= 32.65 && t <= 33.35) wipe(ctx, inv(t, 32.65, 33.35), C.green, C.orangeMid);

  flashAt(ctx, t, CUTS, 0.18);
  grain(ctx, t);
  vignette(ctx);
}
