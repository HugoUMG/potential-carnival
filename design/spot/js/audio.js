/* Música y efectos del spot, sintetizados por código.
   Sin samples: todo sale de osciladores y ruido filtrado.
   120 BPM → un compás = 2 s. El spot dura 50 s = 25 compases. */

import { DURATION } from './util.js';

const SR = 48000;
const BPM = 120;
const BEAT = 60 / BPM; // 0.5 s
const BAR = BEAT * 4; // 2 s

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function noiseBuffer(ac, dur = 2) {
  const b = ac.createBuffer(1, Math.floor(SR * dur), SR);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function impulse(ac, dur = 2.4) {
  const len = Math.floor(SR * dur);
  const b = ac.createBuffer(2, len, SR);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.7);
    }
  }
  return b;
}

export async function renderMusic() {
  const ac = new OfflineAudioContext(2, SR * DURATION, SR);
  const noise = noiseBuffer(ac);

  const master = ac.createGain();
  master.gain.setValueAtTime(0.0001, 0);
  master.gain.exponentialRampToValueAtTime(0.9, 0.2);
  master.gain.setValueAtTime(0.9, 48.6);
  master.gain.exponentialRampToValueAtTime(0.0001, 49.95);

  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 18;
  comp.ratio.value = 3.5;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  master.connect(comp);
  comp.connect(ac.destination);

  const drums = ac.createGain();
  drums.gain.value = 0.85;
  drums.connect(master);

  const music = ac.createGain();
  music.gain.value = 0.8;
  music.connect(master);

  const sfx = ac.createGain();
  sfx.gain.value = 0.75;
  sfx.connect(master);

  // reverb
  const conv = ac.createConvolver();
  conv.buffer = impulse(ac, 2.6);
  const revHP = ac.createBiquadFilter();
  revHP.type = 'highpass';
  revHP.frequency.value = 320;
  const revGain = ac.createGain();
  revGain.gain.value = 0.34;
  conv.connect(revHP).connect(revGain).connect(master);

  // delay para los plucks
  const delay = ac.createDelay(1.5);
  delay.delayTime.value = BEAT * 0.75;
  const fb = ac.createGain();
  fb.gain.value = 0.24;
  const delayWet = ac.createGain();
  delayWet.gain.value = 0.16;
  delay.connect(fb).connect(delay);
  delay.connect(delayWet).connect(master);

  const revSend = (node, amount = 0.25) => {
    const g = ac.createGain();
    g.gain.value = amount;
    node.connect(g).connect(conv);
  };

  /* ── instrumentos ─────────────────────────────────────────────────── */

  function kick(t, peak = 0.85, dest = drums) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.36);

    const n = ac.createBufferSource();
    n.buffer = noise;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2400;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.18, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);
    n.connect(hp).connect(ng).connect(dest);
    n.start(t);
    n.stop(t + 0.04);
  }

  function clap(t, peak = 0.22, dest = drums) {
    for (let i = 0; i < 3; i++) {
      const n = ac.createBufferSource();
      n.buffer = noise;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 1.1;
      const g = ac.createGain();
      const tt = t + i * 0.011;
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(peak, tt + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.09 + i * 0.02);
      n.connect(bp).connect(g).connect(dest);
      n.start(tt);
      n.stop(tt + 0.14);
    }
  }

  function hat(t, peak = 0.07, open = false, dest = drums) {
    const n = ac.createBufferSource();
    n.buffer = noise;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7800;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (open ? 0.2 : 0.045));
    n.connect(hp).connect(g).connect(dest);
    n.start(t);
    n.stop(t + 0.22);
  }

  function shaker(t, peak = 0.045, dest = drums) {
    const n = ac.createBufferSource();
    n.buffer = noise;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 6200;
    bp.Q.value = 0.8;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    n.connect(bp).connect(g).connect(dest);
    n.start(t);
    n.stop(t + 0.09);
  }

  function bass(t, midi, dur = 0.24, peak = 0.13) {
    const o = ac.createOscillator();
    const o2 = ac.createOscillator();
    const f = ac.createBiquadFilter();
    const g = ac.createGain();
    o.type = 'sawtooth';
    o2.type = 'sine';
    o.frequency.value = mtof(midi);
    o2.frequency.value = mtof(midi - 12);
    f.type = 'lowpass';
    f.Q.value = 5;
    f.frequency.setValueAtTime(950, t);
    f.frequency.exponentialRampToValueAtTime(190, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f);
    o2.connect(f);
    f.connect(g).connect(music);
    o.start(t); o.stop(t + dur + 0.05);
    o2.start(t); o2.stop(t + dur + 0.05);
  }

  function pluck(t, midi, peak = 0.05, pan = 0) {
    const o = ac.createOscillator();
    const o2 = ac.createOscillator();
    const f = ac.createBiquadFilter();
    const g = ac.createGain();
    const p = ac.createStereoPanner();
    o.type = 'triangle';
    o2.type = 'sine';
    o.frequency.value = mtof(midi);
    o2.frequency.value = mtof(midi + 12);
    f.type = 'lowpass';
    f.frequency.value = 3400;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    p.pan.value = pan;
    o.connect(f);
    o2.connect(f);
    f.connect(g).connect(p);
    p.connect(music);
    p.connect(delay);
    revSend(p, 0.18);
    o.start(t); o.stop(t + 0.3);
    o2.start(t); o2.stop(t + 0.3);
  }

  function pad(t, notes, dur = BAR, peak = 0.026) {
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1400, t + dur * 0.6);
    f.frequency.linearRampToValueAtTime(700, t + dur);
    f.Q.value = 0.6;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.35);
    g.gain.setValueAtTime(peak, t + dur - 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(music);
    revSend(g, 0.4);
    for (const m of notes) {
      for (const det of [-6, 6]) {
        const o = ac.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  /* ── efectos ──────────────────────────────────────────────────────── */

  function whoosh(t, dur = 0.7, up = true, peak = 0.16) {
    const n = ac.createBufferSource();
    n.buffer = noise;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    const g = ac.createGain();
    bp.frequency.setValueAtTime(up ? 280 : 5200, t);
    bp.frequency.exponentialRampToValueAtTime(up ? 7200 : 260, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp).connect(g).connect(sfx);
    n.start(t);
    n.stop(t + dur + 0.05);
  }

  function impact(t, peak = 0.55) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(92, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.9);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    o.connect(g).connect(sfx);
    o.start(t); o.stop(t + 1.6);

    const n = ac.createBufferSource();
    n.buffer = noise;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.2, t + 0.008);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    n.connect(lp).connect(ng).connect(sfx);
    n.start(t); n.stop(t + 0.8);
    revSend(sfx, 0.08);
  }

  function click(t, peak = 0.05, freq = 2600) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    o.connect(g).connect(sfx);
    o.start(t); o.stop(t + 0.05);
  }

  function pop(t, peak = 0.1) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(980, t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(sfx);
    o.start(t); o.stop(t + 0.18);
  }

  function chime(t, notes = [84, 88, 91, 96], peak = 0.07, gap = 0.075) {
    notes.forEach((m, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      const tt = t + i * gap;
      o.type = 'sine';
      o.frequency.value = mtof(m);
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(peak, tt + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.9);
      o.connect(g).connect(sfx);
      revSend(g, 0.5);
      o.start(tt); o.stop(tt + 1);
    });
  }

  function tick(t, peak = 0.05) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'triangle';
    o.frequency.value = 1800;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(sfx);
    o.start(t); o.stop(t + 0.06);
  }

  /* ── arreglo ──────────────────────────────────────────────────────── */

  // drone de entrada
  {
    const o = ac.createOscillator();
    const o2 = ac.createOscillator();
    const f = ac.createBiquadFilter();
    const g = ac.createGain();
    o.type = 'sawtooth';
    o2.type = 'sine';
    o.frequency.value = mtof(33);
    o2.frequency.value = mtof(21);
    f.type = 'lowpass';
    f.frequency.value = 380;
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.exponentialRampToValueAtTime(0.09, 1.2);
    g.gain.setValueAtTime(0.09, 3.8);
    g.gain.exponentialRampToValueAtTime(0.0001, 4.7);
    o.connect(f); o2.connect(f);
    f.connect(g).connect(music);
    o.start(0); o.stop(4.8);
    o2.start(0); o2.stop(4.8);
  }

  // reloj de la intro
  for (let i = 0; i < 8; i++) tick(0.8 + i * 0.5, i % 2 ? 0.028 : 0.05);

  whoosh(0.55, 0.75, true, 0.1);      // papel
  whoosh(4.25, 0.7, true, 0.18);      // barrido al logo
  impact(4.95, 0.5);

  const CHORDS = [
    { root: 45, pad: [57, 60, 64], arp: [69, 72, 76, 79] }, // Am
    { root: 41, pad: [53, 57, 60], arp: [65, 69, 72, 77] }, // F
    { root: 48, pad: [55, 60, 64], arp: [72, 76, 79, 84] }, // C
    { root: 43, pad: [55, 59, 62], arp: [67, 71, 74, 79] }, // G
  ];

  const bars = 21;
  for (let b = 0; b < bars; b++) {
    const t0 = 5 + b * BAR;
    if (t0 >= 46.5) break;
    const ch = CHORDS[b % 4];
    const section = t0 < 18 ? 1 : t0 < 26 ? 2 : t0 < 33 ? 3 : t0 < 41 ? 4 : 5;

    pad(t0, ch.pad, BAR, 0.024);

    // bajo en corcheas
    const bassPat = [0, 0, 12, 0, 0, 12, 0, 7];
    bassPat.forEach((semi, i) => {
      if (section === 1 && i % 2) return;
      bass(t0 + i * BEAT * 0.5, ch.root + semi, 0.22, section >= 4 ? 0.15 : 0.12);
    });

    // arpegio
    const arpPat = [0, 1, 2, 3, 2, 1, 2, 3];
    arpPat.forEach((idx, i) => {
      const tt = t0 + i * BEAT * 0.5;
      if (section === 1 && i % 2) return;
      pluck(tt, ch.arp[idx], section >= 4 ? 0.055 : 0.042, i % 2 ? 0.35 : -0.35);
      if (section >= 4) pluck(tt + BEAT * 0.25, ch.arp[idx] + 12, 0.024, i % 2 ? -0.5 : 0.5);
    });

    // batería
    for (let beat = 0; beat < 4; beat++) {
      kick(t0 + beat * BEAT, beat === 0 ? 0.9 : 0.78);
      if (beat % 2 === 1) hat(t0 + beat * BEAT, 0.055, true);
    }
    hat(t0 + 0.25, 0.06);
    hat(t0 + 0.75, 0.06);
    hat(t0 + 1.25, 0.06);
    hat(t0 + 1.75, 0.06);
    if (section >= 2) {
      clap(t0 + BEAT, 0.2);
      clap(t0 + BEAT * 3, 0.2);
    }
    if (section >= 3) {
      for (let i = 0; i < 8; i++) hat(t0 + i * 0.25, 0.03);
    }
    if (section >= 4) {
      for (let i = 0; i < 16; i++) shaker(t0 + i * 0.125, 0.035);
    }
  }

  // transiciones de escena
  whoosh(9.85, 0.45, false, 0.12);
  whoosh(17.85, 0.5, false, 0.14);
  whoosh(25.85, 0.5, false, 0.13);
  whoosh(32.85, 0.5, false, 0.15);
  whoosh(40.85, 0.45, false, 0.14);
  whoosh(46.2, 0.5, true, 0.18);

  // UI
  click(10.75, 0.04);
  click(13.35, 0.04);
  click(15.95, 0.04);
  for (let t = 10.95; t < 17; t += 0.17) click(t, 0.012, 3200);

  // enlace + alumno
  click(27.15, 0.05);
  pop(27.5, 0.08);
  click(29.3, 0.055);
  click(30.35, 0.05);
  chime(30.72, [79, 84, 88], 0.05, 0.06);

  // nota
  chime(37.3, [84, 88, 91, 96], 0.075, 0.07);

  // final
  impact(46.5, 0.6);
  chime(46.55, [72, 76, 79, 84, 88], 0.06, 0.1);
  pad(46.5, [48, 55, 64, 67, 72], 3.4, 0.03);
  bass(46.5, 36, 2.4, 0.14);

  const buffer = await ac.startRendering();
  return buffer;
}
