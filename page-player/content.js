/*
 * Contribution Sonifier (content script).
 * Reads the contribution graph GitHub has already drawn on a profile page and plays it as music.
 * No network access, no storage, no permissions. Everything runs in this page.
 */
(function () {
/* PURE:START */
"use strict";
const SCALES = {
  'Minor pentatonic': [0,3,5,7,10],
  'Major pentatonic': [0,2,4,7,9],
  'Dorian': [0,2,3,5,7,9,10],
  'Lydian': [0,2,4,6,7,9,11]
};
const ROOT = 48;           // C3
const LEAD_OCTAVES = 3;
const MAX_DAYS = 400;
const MAX_COUNT = 100000;
const MAX_SEED = 999999999;
const DAY_MS = 86400000;
const LEVEL_FALLBACK = [0, 3, 12, 35, 70];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NOTE_NAMES = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DRUM_NOTES = { kick: 36, snare: 38, hat: 42, ohat: 46, crash: 49 };

function parseDate(s) {
  if (typeof s !== 'string') return null;
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 2000 || y > 2100) return null;
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return t;
}
function fmtDate(t) { return new Date(t).toISOString().slice(0, 10); }
function dayOfWeek(t) { return new Date(t).getUTCDay(); }
function midiToName(m) { return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function r3(x) { return Math.round(x * 1000) / 1000; }
function clamp01(v) { v = Number(v); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; }
function sanitizeSeed(v) { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(MAX_SEED, Math.max(0, n)) : 0; }

/* Small seeded generators. Used only for the optional randomise features, never for the base mapping. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash32(a, b) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (b | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/* Validates untrusted input and returns clean, consecutive days. Throws Error with a safe message. */
function validateDays(input) {
  let list = input;
  if (input && typeof input === 'object' && !Array.isArray(input) && Array.isArray(input.days)) list = input.days;
  if (!Array.isArray(list)) throw new Error('Expected {"days":[...]} or an array of days.');
  if (list.length === 0) throw new Error('No days found.');
  if (list.length > MAX_DAYS) throw new Error('Too many days. The limit is ' + MAX_DAYS + '.');
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Each day must be an object with a date.');
    const t = parseDate(item.date);
    if (t === null) throw new Error('A date is missing or not in YYYY-MM-DD form.');
    if (seen.has(t)) throw new Error('The same date appears twice.');
    seen.add(t);
    const lvl = (typeof item.level === 'number' && Number.isInteger(item.level)) ? Math.min(4, Math.max(0, item.level)) : null;
    let count;
    if (typeof item.count === 'number' && Number.isFinite(item.count)) count = Math.min(MAX_COUNT, Math.max(0, Math.round(item.count)));
    else if (lvl !== null) count = LEVEL_FALLBACK[lvl];
    else throw new Error('Each day needs a count or a level.');
    out.push({ t: t, date: fmtDate(t), count: count, level: lvl });
  }
  out.sort(function (a, b) { return a.t - b.t; });
  for (let i = 1; i < out.length; i++) {
    if (out[i].t - out[i - 1].t !== DAY_MS) throw new Error('Days must be consecutive with no gaps.');
  }
  let max = 0;
  for (const d of out) if (d.count > max) max = d.count;
  for (const d of out) {
    if (d.level === null) d.level = d.count === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(4 * d.count / max)));
    if (d.count === 0) d.level = 0;
    else if (d.level === 0) d.level = 1;
  }
  return out;
}

/*
 * Pure mapping: days -> note events on a timeline of steps. No audio, no Math.random.
 * opts: scale, pad, bell (default on), drums (default off), skipEmpty, limit (days to play),
 *       random ('off' | 'wander' | 'shuffle'), seed, humanise (0..1), weekdayOctave.
 * Randomness is seeded: same days + same options + same seed => identical events.
 */
function sonify(days, opts) {
  opts = opts || {};
  const scale = SCALES[opts.scale] || SCALES['Minor pentatonic'];
  const len = scale.length, N = len * LEAD_OCTAVES, n = days.length;
  const limit = (typeof opts.limit === 'number' && Number.isInteger(opts.limit)) ? Math.max(0, Math.min(n, opts.limit)) : n;
  const skipEmpty = opts.skipEmpty === true;
  const mode = (opts.random === 'wander' || opts.random === 'shuffle') ? opts.random : 'off';
  const seed = sanitizeSeed(opts.seed);
  const hum = clamp01(opts.humanise);
  const octaves = opts.weekdayOctave === true;
  let max = 1;
  for (const d of days) if (d.count > max) max = d.count;
  const lmax = Math.log1p(max);

  const timeline = [];
  const stepOf = new Array(n).fill(-1);
  for (let i = 0; i < limit; i++) {
    if (!skipEmpty || days[i].count > 0) { stepOf[i] = timeline.length; timeline.push(i); }
  }

  // Pitch index per day (0..N-1), before humanise. Peaks keep their pitch in 'wander'.
  const base = days.map(function (d) { return d.count > 0 ? Math.round(Math.log1p(d.count) / lmax * (N - 1)) : -1; });
  const idx = base.slice();
  if (mode === 'shuffle') {
    const rng = mulberry32(hash32(seed, 1));
    const perm = [];
    for (let k = 0; k < len; k++) perm.push(k);
    for (let k = len - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); const t = perm[k]; perm[k] = perm[j]; perm[j] = t; }
    for (let i = 0; i < n; i++) {
      const b = base[i];
      if (b >= 0) idx[i] = Math.min(N - 1, Math.floor(b / len) * len + perm[b % len]);
    }
  } else if (mode === 'wander') {
    const rng = mulberry32(hash32(seed, 2));
    let prev = null;
    for (let i = 0; i < n; i++) {
      const b = base[i];
      if (b < 0) continue;
      if (days[i].count >= 0.6 * max || prev === null) { idx[i] = b; prev = b; continue; }
      const lo = Math.max(0, b - 2), hi = Math.min(N - 1, b + 2);
      const w = [];
      let tot = 0;
      for (let c = lo; c <= hi; c++) { const wt = 1 / (1 + Math.abs(c - prev)) / (1 + 0.5 * Math.abs(c - b)); w.push(wt); tot += wt; }
      let r = rng() * tot, pick = hi;
      for (let c = lo; c <= hi; c++) { r -= w[c - lo]; if (r <= 0) { pick = c; break; } }
      idx[i] = pick; prev = pick;
    }
  }
  const wdShift = [0, 0, 0, 0, 0, 0, 0];
  if (octaves) {
    const rng = mulberry32(hash32(seed, 3));
    for (let k = 0; k < 7; k++) wdShift[k] = [-12, 0, 12][Math.floor(rng() * 3)];
  }

  const events = [];
  const info = [];
  let streak = 0;
  let lastMonth = '';
  days.forEach(function (d, i) {
    streak = d.count > 0 ? streak + 1 : 0;
    const x = lmax > 0 ? Math.log1p(d.count) / lmax : 0;
    const bell = d.count > 0 && d.count >= 0.6 * max;
    const step = stepOf[i];
    let midi = null, vel = 0, dt = 0;
    if (d.count > 0) {
      const rng = mulberry32(hash32(seed, 1000 + i));
      const q1 = rng(), q2 = rng(), q3 = rng(), q4 = rng();   // fixed draw order keeps each day stable
      let k = idx[i];
      if (hum > 0 && !bell && q1 < 0.2 * hum) k = Math.min(N - 1, Math.max(0, k + (q2 < 0.5 ? -1 : 1)));
      midi = ROOT + 12 + 12 * Math.floor(k / len) + scale[k % len];
      if (octaves) { midi += wdShift[dayOfWeek(d.t)]; while (midi > 100) midi -= 12; while (midi < 36) midi += 12; }
      vel = Math.min(1, Math.max(0.05, 0.28 + 0.55 * x + (Math.min(streak, 10) / 10) * 0.08 + (q4 - 0.5) * 0.24 * hum));
      dt = q3 * 0.15 * hum;
    }
    info.push({ index: i, date: d.date, count: d.count, level: d.level, midi: midi, streak: streak,
      isMax: d.count === max && max > 0, bell: bell, step: step, x: r3(x) });
    if (step < 0 || d.count === 0) return;

    events.push({ step: step, kind: 'lead', midi: midi, vel: r3(vel), dur: r3(1 + x * 1.5), dt: r3(dt) });
    if (opts.bell !== false && bell) {
      let bm = midi + 12;
      while (bm > 108) bm -= 12;
      events.push({ step: step, kind: 'bell', midi: bm, vel: r3(Math.min(1, 0.35 + 0.4 * x)), dur: 2.5, dt: r3(dt) });
    }
    if (opts.drums === true) {
      const dv = r3(Math.min(1, 0.35 + 0.5 * x));
      const mkey = d.date.slice(0, 7);
      events.push({ step: step, kind: 'drum', piece: 'kick', vel: dv, dt: 0 });
      if (d.level >= 3) events.push({ step: step, kind: 'drum', piece: 'snare', vel: dv, dt: 0 });
      if (d.level >= 4) events.push({ step: step, kind: 'drum', piece: 'ohat', vel: r3(dv * 0.7), dt: 0.5 });
      else if (d.level >= 2) events.push({ step: step, kind: 'drum', piece: 'hat', vel: r3(dv * 0.7), dt: 0.5 });
      if (mkey !== lastMonth || (max > 0 && d.count === max)) events.push({ step: step, kind: 'drum', piece: 'crash', vel: 0.8, dt: 0 });
      lastMonth = mkey;
    }
  });

  if (opts.pad !== false) {
    const weeks = [];
    let wk = null;
    for (let i = 0; i < limit; i++) {
      if (!wk || dayOfWeek(days[i].t) === 0) { wk = { total: 0, steps: [] }; weeks.push(wk); }
      wk.total += days[i].count;
      if (stepOf[i] >= 0) wk.steps.push(stepOf[i]);
    }
    let maxWeek = 1;
    for (const w of weeks) if (w.total > maxWeek) maxWeek = w.total;
    for (const w of weeks) {
      if (w.total === 0 || w.steps.length === 0) continue;
      const u = Math.log1p(w.total) / Math.log1p(maxWeek);
      const ix = Math.round(u * (len - 1));
      const root = ROOT - 12 + scale[ix];
      const third = ROOT + scale[(ix + 2) % len];
      events.push({ step: w.steps[0], kind: 'pad', midi: [root, root + 7, third], vel: r3(0.18 + 0.3 * u), dur: w.steps.length + 0.5, dt: 0 });
    }
  }
  return { events: events, info: info, timeline: timeline, stepOf: stepOf, steps: timeline.length };
}

function groupByStep(events, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = [];
  for (const e of events) if (e.step >= 0 && e.step < n) out[e.step].push(e);
  return out;
}

function computeStats(days) {
  let total = 0, active = 0, best = null, streak = 0, longest = 0;
  for (const d of days) {
    total += d.count;
    if (d.count > 0) { active++; streak++; if (streak > longest) longest = streak; } else streak = 0;
    if (!best || d.count > best.count) best = d;
  }
  return { total: total, active: active, best: best, longest: longest };
}

function volumeToGain(v) {
  const x = Math.min(100, Math.max(0, Number(v) || 0)) / 100;
  return x * x * 0.5;   // hard cap at 0.5
}

/*
 * Standard MIDI File (type 1) writer, no dependencies.
 * res: result of sonify(days, {pad:true, bell:true, drums:true, ...}).
 * cfg: { bpm, title, tracks: { melody, bells, chords, drums, cc } }
 * One timeline step = one eighth note (240 ticks at 480 PPQ). Returns { bytes: Uint8Array, notes: number }.
 */
function buildMidi(res, days, cfg) {
  cfg = cfg || {};
  const PPQ = 480, STEP = 240;
  const bpm = Math.min(240, Math.max(40, Math.round(Number(cfg.bpm)) || 120));
  const sel = cfg.tracks || {};
  const ascii = function (s) { return String(s).replace(/[^\x20-\x7E]/g, '?').slice(0, 100); };
  const vlq = function (v) {
    v = Math.max(0, Math.floor(v));
    const b = [v & 0x7f];
    v = Math.floor(v / 128);
    while (v > 0) { b.unshift((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
    return b;
  };
  const u32 = function (v) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; };
  const chunk = function (tag, bytes) { return [tag.charCodeAt(0), tag.charCodeAt(1), tag.charCodeAt(2), tag.charCodeAt(3)].concat(u32(bytes.length), bytes); };
  const meta = function (type, bytes) { return [0xFF, type].concat(vlq(bytes.length), bytes); };
  const text = function (s) { const a = ascii(s); const b = []; for (let i = 0; i < a.length; i++) b.push(a.charCodeAt(i)); return b; };
  const v127 = function (v) { return Math.max(1, Math.min(127, Math.round(20 + v * 107))); };
  const m127 = function (m) { return Math.max(0, Math.min(127, Math.round(m))); };

  // evs: { tick, order, data } -> one MTrk chunk
  const trackChunk = function (name, evs) {
    evs.forEach(function (e, i) { e.i = i; });
    evs.sort(function (a, b) { return a.tick - b.tick || a.order - b.order || a.i - b.i; });
    const bytes = [0x00].concat(meta(0x03, text(name)));
    let last = 0;
    for (const e of evs) {
      const d = vlq(e.tick - last);
      for (let k = 0; k < d.length; k++) bytes.push(d[k]);
      for (let k = 0; k < e.data.length; k++) bytes.push(e.data[k]);
      last = e.tick;
    }
    bytes.push(0x00, 0xFF, 0x2F, 0x00);
    return chunk('MTrk', bytes);
  };
  // notes: { tick, dur, midi, vel }. Same-pitch overlaps are trimmed so every note-off matches its own note-on.
  const noteTrack = function (name, ch, program, notes, ccs) {
    const evs = [];
    if (program !== null) evs.push({ tick: 0, order: -1, data: [0xC0 | ch, program] });
    const byPitch = new Map();
    for (const nt of notes) { const m = m127(nt.midi); if (!byPitch.has(m)) byPitch.set(m, []); byPitch.get(m).push(nt); }
    byPitch.forEach(function (list, m) {
      list.sort(function (a, b) { return a.tick - b.tick; });
      list.forEach(function (nt, k) {
        let end = nt.tick + Math.max(30, Math.round(nt.dur));
        if (k + 1 < list.length && end > list[k + 1].tick) end = Math.max(nt.tick + 1, list[k + 1].tick);
        evs.push({ tick: nt.tick, order: 2, data: [0x90 | ch, m, v127(nt.vel)] });
        evs.push({ tick: end, order: 0, data: [0x80 | ch, m, 0] });
      });
    });
    for (const c of (ccs || [])) evs.push({ tick: c.tick, order: 1, data: [0xB0 | ch, c.cc, Math.max(0, Math.min(127, Math.round(c.value)))] });
    return trackChunk(name, evs);
  };
  const tickOf = function (e) { return e.step * STEP + Math.round((e.dt || 0) * STEP); };

  const chunks = [];
  // conductor track: title, tempo, time signature, month markers
  const cond = [{ tick: 0, order: -2, data: meta(0x51, (function () { const us = Math.round(60000000 / bpm); return [(us >>> 16) & 255, (us >>> 8) & 255, us & 255]; })()) },
                { tick: 0, order: -2, data: meta(0x58, [4, 2, 24, 8]) }];
  let lastKey = '';
  res.timeline.forEach(function (di, s) {
    const key = days[di].date.slice(0, 7);
    if (key !== lastKey) {
      lastKey = key;
      cond.push({ tick: s * STEP, order: 0, data: meta(0x06, text(MONTH_NAMES[Number(key.slice(5, 7)) - 1] + ' ' + key.slice(0, 4))) });
    }
  });
  chunks.push(trackChunk(cfg.title || 'Contribution Sonifier', cond));

  let notes = 0;
  const pick = function (kind) { return res.events.filter(function (e) { return e.kind === kind; }); };
  if (sel.melody) {
    const list = pick('lead').map(function (e) { return { tick: tickOf(e), dur: e.dur * STEP, midi: e.midi, vel: e.vel }; });
    notes += list.length; chunks.push(noteTrack('Melody', 0, 11, list));      // Vibraphone
  }
  if (sel.bells) {
    const list = pick('bell').map(function (e) { return { tick: tickOf(e), dur: e.dur * STEP, midi: e.midi, vel: e.vel }; });
    notes += list.length; chunks.push(noteTrack('Bells', 1, 9, list));        // Glockenspiel
  }
  if (sel.chords) {
    const list = [];
    pick('pad').forEach(function (e) { e.midi.forEach(function (m) { list.push({ tick: tickOf(e), dur: e.dur * STEP, midi: m, vel: e.vel }); }); });
    notes += list.length; chunks.push(noteTrack('Chords', 2, 89, list));      // Warm Pad
  }
  if (sel.drums) {
    const list = pick('drum').map(function (e) { return { tick: tickOf(e), dur: 60, midi: DRUM_NOTES[e.piece], vel: e.vel }; });
    notes += list.length; chunks.push(noteTrack('Drums', 9, null, list));
  }
  if (sel.cc) {
    const ccs = [];
    for (const f of res.info) if (f.step >= 0 && f.count > 0) ccs.push({ tick: f.step * STEP, cc: 74, value: 30 + 97 * f.x });
    chunks.push(noteTrack('Brightness CC74', 0, null, [], ccs));
  }
  const header = chunk('MThd', [0, 1, (chunks.length >> 8) & 255, chunks.length & 255, (PPQ >> 8) & 255, PPQ & 255]);
  let all = header;
  for (const c of chunks) all = all.concat(c);
  return { bytes: Uint8Array.from(all), notes: notes };
}
/* PURE:END */


/* ----- audio engine ----- */
const Engine = (function () {
  let ctx = null, master = null, comp = null, verb = null, verbGain = null, bus = null, noiseBuf = null;
  let volume = 70, muted = false;

  function lcgBuffer(c, seconds, shape) {
    const rate = c.sampleRate, n = Math.floor(rate * seconds);
    const buf = c.createBuffer(shape.channels, n, rate);
    let seed = shape.seed;
    for (let ch = 0; ch < shape.channels; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const noise = (seed / 4294967296) * 2 - 1;
        data[i] = shape.decay ? noise * Math.pow(1 - i / n, shape.decay) : noise;
      }
    }
    return buf;
  }
  function newBus() {
    const b = ctx.createGain();
    b.connect(master);
    const send = ctx.createGain();
    send.gain.value = 0.45;
    b.connect(send);
    send.connect(verb);
    bus = { b: b, send: send };
  }
  function applyGain() {
    if (!ctx) return;
    master.gain.setTargetAtTime(muted ? 0 : volumeToGain(volume), ctx.currentTime, 0.03);
  }
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('This browser does not support Web Audio.');
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volumeToGain(volume);
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
    verb = ctx.createConvolver();
    verb.buffer = lcgBuffer(ctx, 2.4, { channels: 2, seed: 1234567, decay: 2.6 });
    verbGain = ctx.createGain(); verbGain.gain.value = 0.4;
    verb.connect(verbGain); verbGain.connect(master);
    noiseBuf = lcgBuffer(ctx, 1.5, { channels: 1, seed: 7654321, decay: 0 });
    newBus();
    return ctx;
  }
  async function start() {
    const c = ensure();
    if (c.state === 'suspended') await c.resume();
    return c;
  }
  function cut() {
    if (!ctx || !bus) return;
    const old = bus, t = ctx.currentTime;
    old.b.gain.cancelScheduledValues(t);
    old.b.gain.setTargetAtTime(0, t, 0.02);
    setTimeout(function () { try { old.b.disconnect(); old.send.disconnect(); } catch (e) { /* already gone */ } }, 500);
    newBus();
  }
  function lead(t, ev, stepDur) {
    const dur = Math.max(0.25, ev.dur * stepDur), f = midiToFreq(ev.midi), out = bus.b;
    const g = ctx.createGain(), flt = ctx.createBiquadFilter(), g2 = ctx.createGain();
    flt.type = 'lowpass'; flt.Q.value = 1.1;
    flt.frequency.setValueAtTime(900 + 3200 * ev.vel, t);
    flt.frequency.exponentialRampToValueAtTime(450 + 700 * ev.vel, t + Math.min(0.6, dur));
    const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2; o2.detune.value = 3;
    g2.gain.value = 0.35;
    o1.connect(flt); o2.connect(g2); g2.connect(flt); flt.connect(g); g.connect(out);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3 * ev.vel, t + 0.006);
    g.gain.setTargetAtTime(0, t + 0.05, Math.max(0.08, dur * 0.35));
    const stop = t + dur + 0.9;
    o1.start(t); o2.start(t); o1.stop(stop); o2.stop(stop);
    o1.onended = function () { try { g.disconnect(); flt.disconnect(); g2.disconnect(); } catch (e) { /* ok */ } };
  }
  function bell(t, ev) {
    const f = midiToFreq(ev.midi), out = bus.b;
    const g = ctx.createGain();
    g.connect(out);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.14 * ev.vel, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.02, 0.45);
    [1, 2.76].forEach(function (ratio, k) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * ratio;
      const og = ctx.createGain(); og.gain.value = k === 0 ? 1 : 0.4;
      o.connect(og); og.connect(g);
      o.start(t); o.stop(t + 2.4);
      o.onended = function () { try { og.disconnect(); } catch (e) { /* ok */ } };
    });
    setTimeout(function () { try { g.disconnect(); } catch (e) { /* ok */ } }, Math.max(0, (t - ctx.currentTime + 2.6)) * 1000);
  }
  function pad(t, ev, stepDur) {
    const dur = ev.dur * stepDur, out = bus.b;
    const g = ctx.createGain(), flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 700; flt.Q.value = 0.5;
    flt.connect(g); g.connect(out);
    const peak = 0.16 * ev.vel, att = Math.min(0.5, dur * 0.3), rel = 0.9;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + att);
    g.gain.setValueAtTime(peak, t + Math.max(att, dur - 0.1));
    g.gain.linearRampToValueAtTime(0, t + dur + rel);
    let last = null;
    ev.midi.forEach(function (m) {
      [['sine', 0], ['triangle', 6]].forEach(function (cfg) {
        const o = ctx.createOscillator(); o.type = cfg[0]; o.frequency.value = midiToFreq(m); o.detune.value = cfg[1];
        const og = ctx.createGain(); og.gain.value = cfg[0] === 'sine' ? 0.6 : 0.25;
        o.connect(og); og.connect(flt);
        o.start(t); o.stop(t + dur + rel + 0.1);
        last = o;
      });
    });
    if (last) last.onended = function () { try { g.disconnect(); flt.disconnect(); } catch (e) { /* ok */ } };
  }
  function noiseHit(t, hp, peak, tau, len, out) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.004, tau);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, 0, len);
    s.onended = function () { try { g.disconnect(); f.disconnect(); } catch (e) { /* ok */ } };
  }
  function drum(t, ev) {
    const out = bus.b, v = ev.vel;
    if (ev.piece === 'kick') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.7 * v, t + 0.002);
      g.gain.setTargetAtTime(0, t + 0.01, 0.09);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.45);
      o.onended = function () { try { g.disconnect(); } catch (e) { /* ok */ } };
    } else if (ev.piece === 'snare') {
      noiseHit(t, 1200, 0.3 * v, 0.06, 0.3, out);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = 190;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22 * v, t + 0.002);
      g.gain.setTargetAtTime(0, t + 0.01, 0.04);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.2);
      o.onended = function () { try { g.disconnect(); } catch (e) { /* ok */ } };
    } else if (ev.piece === 'hat') noiseHit(t, 7500, 0.16 * v, 0.02, 0.1, out);
    else if (ev.piece === 'ohat') noiseHit(t, 7000, 0.16 * v, 0.09, 0.4, out);
    else if (ev.piece === 'crash') noiseHit(t, 4500, 0.22 * v, 0.5, 1.5, out);
  }
  function playStep(t, events, stepDur, layers) {
    if (!ctx) return;
    for (const ev of events) {
      const tt = t + (ev.dt || 0) * stepDur;
      if (ev.kind === 'lead') lead(tt, ev, stepDur);
      else if (ev.kind === 'bell' && layers.bell) bell(tt, ev);
      else if (ev.kind === 'pad' && layers.pad) pad(tt, ev, stepDur);
      else if (ev.kind === 'drum' && layers.drums) drum(tt, ev);
    }
  }
  return {
    start: start, cut: cut, playStep: playStep,
    now: function () { return ctx ? ctx.currentTime : 0; },
    ready: function () { return !!ctx; },
    setVolume: function (v) { volume = v; applyGain(); },
    setMuted: function (m) { muted = m; applyGain(); }
  };
})();

/* ---------- content-script UI (runs on the GitHub profile page) ---------- */
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CSS = [
  '.wrap{box-sizing:border-box;margin:12px 0 4px;padding:12px 14px;border:1px solid var(--borderColor-default,#d0d7de);border-radius:6px;background:var(--bgColor-muted,#f6f8fa);color:var(--fgColor-default,#1f2328);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;display:flex;flex-direction:column;gap:10px;text-align:left}',
  '.head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 16px;align-items:baseline}',
  '.title{font-weight:600}',
  '.meta{color:var(--fgColor-muted,#59636e);font-size:12px}',
  '.group{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding-top:8px;border-top:1px solid var(--borderColor-muted,#d8dee4)}',
  '.group.first{border-top:0;padding-top:0}',
  '.glabel{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--fgColor-muted,#59636e);min-width:76px}',
  '.btn{font:inherit;font-weight:500;padding:5px 12px;border:1px solid var(--button-default-borderColor-rest,#d0d7de);border-radius:6px;background:var(--button-default-bgColor-rest,#f6f8fa);color:inherit;cursor:pointer}',
  '.btn:hover{background:var(--button-default-bgColor-hover,#eff2f5)}',
  '.btn.primary{background:var(--button-primary-bgColor-rest,#1f883d);border-color:rgba(31,35,40,.15);color:var(--button-primary-fgColor-rest,#fff);min-width:84px}',
  '.btn.primary:hover{background:var(--button-primary-bgColor-hover,#1c8139)}',
  '.btn:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--focus-outlineColor,#0969da);outline-offset:2px}',
  'label{display:inline-flex;align-items:center;gap:6px;color:var(--fgColor-muted,#59636e);font-size:13px}',
  'input[type=range]{width:96px;accent-color:var(--bgColor-accent-emphasis,#0969da)}',
  'input[type=number]{width:14ch;font:inherit;font-size:13px;padding:3px 6px;border:1px solid var(--borderColor-default,#d0d7de);border-radius:6px;background:var(--bgColor-default,#fff);color:inherit}',
  'input[type=number].short{width:8ch}',
  'output{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:var(--fgColor-default,#1f2328);min-width:7ch}',
  'select{font:inherit;font-size:13px;padding:3px 6px;border:1px solid var(--borderColor-default,#d0d7de);border-radius:6px;background:var(--bgColor-default,#fff);color:inherit}',
  '.now{border:1px solid var(--borderColor-default,#d0d7de);border-radius:6px;background:var(--bgColor-default,#fff);padding:6px 10px;min-height:3.4em}',
  '.l1{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}',
  '.l2{font-size:13px;color:var(--fgColor-muted,#59636e)}',
  '.status{font-size:12px;color:var(--fgColor-muted,#59636e);min-height:1.4em}',
  '.status.err{color:var(--fgColor-danger,#d1242f)}'
].join('\n');

const state = {
  container: null, table: null, host: null, sig: '',
  days: [], info: [], byStep: [], timeline: [], stepOf: [], steps: 0, limit: 0, cells: [], cellIndex: null, approx: 0, label: '',
  pos: 0, cur: -1, playing: false, timer: 0, nextTime: 0, queue: [], raf: 0, clickHandler: null
};
let ui = null;
const failed = new WeakMap();

function h(tag, props, kids) {
  const e = document.createElement(tag);
  if (props) for (const k of Object.keys(props)) {
    const v = props[k];
    if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else e.setAttribute(k, String(v));
  }
  if (kids) for (const c of kids) e.appendChild(c);
  return e;
}
function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
function fmtLong(d) {
  const dt = new Date(parseDate(d.date));
  return WD[dt.getUTCDay()] + ' ' + dt.getUTCDate() + ' ' + MON[dt.getUTCMonth()] + ' ' + dt.getUTCFullYear();
}
function setStatus(msg, isErr) { if (!ui) return; ui.status.textContent = msg || ''; ui.status.classList.toggle('err', !!isErr); }

/* ----- read the graph that GitHub already rendered ----- */
function tableSig(table) {
  const all = table.querySelectorAll('td.ContributionCalendar-day[data-date]');
  return (all.length ? all[0].getAttribute('data-date') : '') + '|' + all.length;
}
function readCalendar(container) {
  const table = container.querySelector('table.ContributionCalendar-grid');
  if (!table) return null;
  const tds = Array.prototype.slice.call(table.querySelectorAll('td.ContributionCalendar-day[data-date]'));
  if (tds.length < 28 || tds.length > MAX_DAYS) return null;
  const tipsFor = new Map(), tipsId = new Map();
  container.querySelectorAll('tool-tip').forEach(function (t) {
    const text = (t.textContent || '').replace(/\s+/g, ' ').trim();
    const f = t.getAttribute('for'), id = t.getAttribute('id');
    if (f) tipsFor.set(f, text);
    if (id) tipsId.set(id, text);
  });
  const rows = [], byDate = new Map();
  for (const td of tds) {
    const tip = tipsFor.get(td.id) || tipsId.get(td.getAttribute('aria-labelledby') || '') || '';
    const m = /(No|\d+)\s+contributions?\s+on/i.exec(tip);
    const lvl = Number(td.getAttribute('data-level'));
    rows.push({ date: td.getAttribute('data-date'), level: Number.isInteger(lvl) ? lvl : 0, count: m ? (/^no$/i.test(m[1]) ? 0 : Number(m[1])) : null });
    byDate.set(td.getAttribute('data-date'), td);
  }
  const days = validateDays(rows);
  const cells = days.map(function (d) { return byDate.get(d.date); });
  let approx = 0;
  for (const r of rows) if (r.count === null) approx++;
  return { table: table, days: days, cells: cells, approx: approx, sig: tableSig(table) };
}

/* ----- options read from the controls ----- */
function readSeed() { return sanitizeSeed(ui.seed.value); }
function currentOpts() {
  return {
    scale: ui.scale.value, pad: ui.pad.checked, bell: ui.bell.checked, drums: ui.drums.checked,
    skipEmpty: ui.skip.checked, limit: state.limit,
    random: ui.rmode.value, seed: readSeed(), humanise: Number(ui.hum.value) / 100, weekdayOctave: ui.wdoct.checked
  };
}
function layers() { return { pad: ui.pad.checked, bell: ui.bell.checked, drums: ui.drums.checked }; }
function stepDur() { return 1 / Number(ui.speed.value); }
function rebuild() {
  const res = sonify(state.days, currentOpts());
  state.info = res.info; state.timeline = res.timeline; state.stepOf = res.stepOf; state.steps = res.steps;
  state.byStep = groupByStep(res.events, res.steps);
}
function stepForDay(d) {
  for (let s = 0; s < state.steps; s++) if (state.timeline[s] >= d) return s;
  return state.steps - 1;
}
function updateSpeedOut() {
  const s = Number(ui.speed.value);
  ui.speedOut.textContent = s + ' days/s';
  ui.speedOut.title = 'The whole year plays in about ' + Math.round(state.steps / s) + ' seconds';
  ui.humOut.textContent = ui.hum.value + '%';
}
function updateButton() {
  let label = 'Play';
  if (state.playing) label = 'Pause';
  else if (state.steps > 0 && state.cur >= state.steps - 1) label = 'Play again';
  ui.play.textContent = label;
}
function showCaption(di) {
  if (di < 0 || di >= state.info.length) {
    ui.l1.textContent = 'Press play, or click any square in the graph to hear that day.';
    ui.l2.textContent = '';
    return;
  }
  const d = state.info[di];
  ui.l1.textContent = fmtLong(d) + ' · ' + (d.count === 0 ? 'no contributions' : plural(d.count, 'contribution'));
  const parts = [d.midi === null ? 'Rest' : 'Note ' + midiToName(d.midi)];
  if (d.streak >= 3) parts.push(d.streak + '-day streak');
  if (d.isMax) parts.push('busiest day of the year'); else if (d.bell) parts.push('bell');
  ui.l2.textContent = parts.join(' · ');
}
function paint(di) {
  const started = di >= 0;
  state.table.classList.toggle('sonify-started', started);
  for (let k = 0; k < state.cells.length; k++) {
    const c = state.cells[k];
    c.classList.toggle('sonify-ahead', started && k > di);
    c.classList.toggle('sonify-cur', k === di);
  }
}
function clearPaint() {
  if (state.table) state.table.classList.remove('sonify-started');
  for (const c of state.cells) { c.classList.remove('sonify-ahead'); c.classList.remove('sonify-cur'); }
}
function show(i) {
  state.cur = i;
  const di = i >= 0 ? state.timeline[i] : -1;
  paint(di);
  showCaption(di);
}

/* ----- scheduler (positions are timeline steps) ----- */
function pump() {
  if (!state.playing) return;
  const horizon = Engine.now() + 0.15;
  while (state.nextTime < horizon && state.pos < state.steps) {
    const sd = stepDur();
    Engine.playStep(state.nextTime, state.byStep[state.pos], sd, layers());
    state.queue.push({ time: state.nextTime, step: state.pos });
    state.pos++;
    state.nextTime += sd;
  }
  state.timer = setTimeout(pump, 25);
}
function frame() {
  if (!state.playing) { state.raf = 0; return; }
  const now = Engine.now();
  let shown = -1;
  while (state.queue.length && state.queue[0].time <= now) shown = state.queue.shift().step;
  if (shown >= 0) show(shown);
  if (state.pos >= state.steps && state.queue.length === 0 && now >= state.nextTime) { finish(); return; }
  state.raf = requestAnimationFrame(frame);
}
function stopTimers() {
  clearTimeout(state.timer); state.timer = 0;
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
}
async function play() {
  if (state.playing) return;
  if (state.steps === 0) { setStatus('There are no contributions to play in this graph.', true); return; }
  try { await Engine.start(); } catch (e) { setStatus(e.message || 'Could not start audio.', true); return; }
  if (!ui || !state.table) return;
  setStatus('');
  if (state.pos >= state.steps) state.pos = 0;
  state.playing = true;
  state.queue = [];
  state.nextTime = Engine.now() + 0.08;
  updateButton();
  pump();
  state.raf = requestAnimationFrame(frame);
}
function pause() {
  if (!state.playing) return;
  state.playing = false;
  stopTimers();
  Engine.cut();
  state.queue = [];
  state.pos = Math.max(0, state.cur + 1);
  updateButton();
  setStatus('Paused on ' + (state.cur >= 0 ? fmtLong(state.info[state.timeline[state.cur]]) : 'the first day') + '.');
}
function finish() {
  state.playing = false;
  stopTimers();
  state.queue = [];
  state.pos = state.steps;
  updateButton();
  setStatus('Finished: ' + plural(state.steps, 'step') + ' played.');
}
function seek(i, audition) {
  if (state.steps === 0) return;
  if (i < 0) i = 0;
  if (i > state.steps - 1) i = state.steps - 1;
  Engine.cut();
  state.queue = [];
  state.pos = i;
  if (state.playing) { state.nextTime = Engine.now() + 0.05; show(i); }
  else { show(i); if (audition && Engine.ready()) Engine.playStep(Engine.now() + 0.02, state.byStep[i], stepDur(), layers()); }
}
async function onCell(di) {
  try { await Engine.start(); } catch (e) { setStatus(e.message || 'Could not start audio.', true); return; }
  if (!ui || !state.table || state.steps === 0) return;
  const s = stepForDay(di);
  seek(s, true);
  if (state.stepOf[di] < 0) setStatus('That day has no contributions, so it is skipped. Jumped to the next day with activity.');
  else setStatus('');
}
function restart() {
  const was = state.playing;
  if (was) { state.playing = false; stopTimers(); }
  Engine.cut();
  state.queue = [];
  state.pos = 0;
  show(-1);
  setStatus('');
  updateButton();
  if (was) play();
}
/* Called when any sound option changes: rebuild the notes and keep the current day. */
function applyRebuild() {
  if (!ui) return;
  const curDay = state.cur >= 0 ? state.timeline[state.cur] : -1;
  rebuild();
  updateSpeedOut();
  Engine.cut();
  state.queue = [];
  const newCur = (curDay >= 0 && state.steps > 0) ? stepForDay(curDay) : -1;
  state.cur = newCur;
  if (state.playing) {
    state.pos = Math.max(0, newCur + 1);
    state.nextTime = Engine.now() + 0.05;
  } else {
    state.pos = Math.max(0, newCur);
  }
  show(newCur);
  updateButton();
}

/* ----- MIDI export ----- */
function exportMidi() {
  const t = { melody: ui.xMelody.checked, bells: ui.xBells.checked, chords: ui.xChords.checked, drums: ui.xDrums.checked, cc: ui.xCc.checked };
  if (!t.melody && !t.bells && !t.chords && !t.drums && !t.cc) { setStatus('Choose at least one MIDI track.', true); return; }
  const opts = currentOpts();
  opts.pad = true; opts.bell = true; opts.drums = true;
  const res = sonify(state.days, opts);
  if (res.steps === 0) { setStatus('There are no contributions to export.', true); return; }
  const bpm = Math.min(240, Math.max(40, Math.round(Number(ui.bpm.value)) || 120));
  ui.bpm.value = String(bpm);
  const out = buildMidi(res, state.days, { bpm: bpm, title: state.label, tracks: t });
  const first = state.days[0].date.slice(0, 4);
  const name = 'sonifier-' + first + '-seed' + opts.seed + '.mid';
  try {
    const blob = new Blob([out.bytes], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    ui.root.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 15000);
    setStatus('Saved ' + name + ' (' + plural(out.notes, 'note') + ', ' + bpm + ' BPM).');
  } catch (e) { setStatus('The browser blocked the download.', true); }
}

/* ----- mounting ----- */
function chk(id, text, checked) {
  const input = h('input', { id: id, type: 'checkbox' });
  input.checked = !!checked;
  return { input: input, label: h('label', { for: id }, [input, document.createTextNode(text)]) };
}
function buildUi(stats) {
  const host = document.createElement('div');
  host.id = 'sonify-host';
  host.style.display = 'block';
  const root = host.attachShadow({ mode: 'closed' });
  try { const sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); root.adoptedStyleSheets = [sheet]; }
  catch (e) { const st = document.createElement('style'); st.textContent = CSS; root.appendChild(st); }

  const u = { root: root };
  u.play = h('button', { class: 'btn primary', type: 'button', text: 'Play' });
  u.restart = h('button', { class: 'btn', type: 'button', text: 'Restart' });
  u.speed = h('input', { id: 'sp', type: 'range', min: '3', max: '24', step: '1', value: '9' });
  u.speedOut = h('output', { for: 'sp' });
  u.vol = h('input', { id: 'vo', type: 'range', min: '0', max: '100', step: '1', value: '70' });
  u.mute = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', text: 'Mute' });
  u.scale = h('select', { id: 'sc' });
  Object.keys(SCALES).forEach(function (n) { u.scale.appendChild(h('option', { value: n, text: n })); });
  const cPad = chk('pd', 'Weekly chords', true), cBell = chk('bl', 'Bells on peak days', true),
        cDrums = chk('dr', 'Drums', false), cSkip = chk('sk', 'Skip empty days', true);
  u.pad = cPad.input; u.bell = cBell.input; u.drums = cDrums.input; u.skip = cSkip.input;

  u.rmode = h('select', { id: 'rm' });
  [['off', 'Off'], ['wander', 'Wander (stays near the count)'], ['shuffle', 'Shuffle scale degrees']].forEach(function (o) {
    u.rmode.appendChild(h('option', { value: o[0], text: o[1] }));
  });
  u.seed = h('input', { id: 'sd', type: 'number', min: '0', max: String(MAX_SEED), step: '1', value: '1' });
  u.reroll = h('button', { class: 'btn', type: 'button', text: 'Re-roll' });
  u.hum = h('input', { id: 'hu', type: 'range', min: '0', max: '100', step: '5', value: '0' });
  u.humOut = h('output', { for: 'hu' });
  const cOct = chk('wo', 'Octave per weekday', false);
  u.wdoct = cOct.input;

  u.bpm = h('input', { id: 'bp', type: 'number', class: 'short', min: '40', max: '240', step: '1', value: '120' });
  const xM = chk('xm', 'Melody', true), xB = chk('xb', 'Bells', true), xC = chk('xc', 'Chords', true), xD = chk('xd', 'Drums', true), xK = chk('xk', 'Brightness (CC74)', false);
  u.xMelody = xM.input; u.xBells = xB.input; u.xChords = xC.input; u.xDrums = xD.input; u.xCc = xK.input;
  u.export = h('button', { class: 'btn primary', type: 'button', text: 'Export MIDI' });

  u.l1 = h('div', { class: 'l1' });
  u.l2 = h('div', { class: 'l2' });
  u.status = h('div', { class: 'status', role: 'status' });

  const metaText = stats.total.toLocaleString('en-US') + ' contributions · ' + stats.active + ' active days' +
    (stats.best && stats.best.count > 0 ? ' · busiest ' + stats.best.count + ' on ' + fmtLong(stats.best) : '');
  const g = function (label, kids, first) {
    return h('div', { class: 'group' + (first ? ' first' : '') }, [h('span', { class: 'glabel', text: label })].concat(kids));
  };
  const wrap = h('div', { class: 'wrap', role: 'group', 'aria-label': 'Contribution Sonifier' }, [
    h('div', { class: 'head' }, [h('span', { class: 'title', text: 'Contribution Sonifier' }), h('span', { class: 'meta', text: metaText })]),
    g('Playback', [
      u.play, u.restart,
      h('label', { for: 'sp' }, [document.createTextNode('Speed'), u.speed, u.speedOut]),
      h('label', { for: 'vo' }, [document.createTextNode('Volume'), u.vol]),
      u.mute
    ], true),
    g('Sound', [
      h('label', { for: 'sc' }, [document.createTextNode('Scale'), u.scale]),
      cSkip.label, cPad.label, cBell.label, cDrums.label
    ]),
    g('Randomise', [
      h('label', { for: 'rm' }, [document.createTextNode('Mode'), u.rmode]),
      h('label', { for: 'sd' }, [document.createTextNode('Seed'), u.seed]),
      u.reroll,
      h('label', { for: 'hu' }, [document.createTextNode('Humanise'), u.hum, u.humOut]),
      cOct.label
    ]),
    g('Export', [
      h('label', { for: 'bp' }, [document.createTextNode('Tempo'), u.bpm, document.createTextNode('BPM')]),
      xM.label, xB.label, xC.label, xD.label, xK.label, u.export
    ]),
    h('div', { class: 'now' }, [u.l1, u.l2]),
    u.status
  ]);
  root.appendChild(wrap);

  u.play.addEventListener('click', function () { if (state.playing) pause(); else play(); });
  u.restart.addEventListener('click', restart);
  u.speed.addEventListener('input', updateSpeedOut);
  u.vol.addEventListener('input', function () { Engine.setVolume(Number(u.vol.value)); });
  u.mute.addEventListener('click', function () {
    const m = u.mute.getAttribute('aria-pressed') !== 'true';
    u.mute.setAttribute('aria-pressed', String(m));
    u.mute.textContent = m ? 'Unmute' : 'Mute';
    Engine.setMuted(m);
  });
  [u.scale, u.pad, u.bell, u.drums, u.skip, u.rmode, u.wdoct].forEach(function (c) { c.addEventListener('change', applyRebuild); });
  u.hum.addEventListener('input', function () { u.humOut.textContent = u.hum.value + '%'; });
  u.hum.addEventListener('change', applyRebuild);
  u.seed.addEventListener('change', function () { u.seed.value = String(sanitizeSeed(u.seed.value)); applyRebuild(); });
  u.reroll.addEventListener('click', function () {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    u.seed.value = String(a[0] % (MAX_SEED + 1));
    if (u.rmode.value === 'off') u.rmode.value = 'wander';
    applyRebuild();
    setStatus('Seed ' + u.seed.value + '. Use the same seed to get this tune again.');
  });
  u.export.addEventListener('click', exportMidi);
  return { host: host, ui: u };
}

function unmount() {
  if (state.playing) { state.playing = false; stopTimers(); }
  Engine.cut();
  if (state.table && state.clickHandler) state.table.removeEventListener('click', state.clickHandler);
  clearPaint();
  if (state.host) state.host.remove();
  state.container = null; state.table = null; state.host = null; state.sig = '';
  state.days = []; state.info = []; state.byStep = []; state.timeline = []; state.stepOf = []; state.steps = 0;
  state.cells = []; state.cellIndex = null; state.pos = 0; state.cur = -1; state.queue = []; state.clickHandler = null;
  ui = null;
}

function tryMount() {
  const c = document.querySelector('.js-calendar-graph');
  if (!c) { if (state.container) unmount(); return; }
  const table = c.querySelector('table.ContributionCalendar-grid');
  if (!table) return;
  if (state.container === c && state.host && state.host.isConnected) {
    if (tableSig(table) === state.sig) return;
  }
  const sigNow = tableSig(table);
  if (failed.get(c) === sigNow) return;
  if (state.container) unmount();
  let cal;
  try { cal = readCalendar(c); } catch (e) { failed.set(c, sigNow); return; }
  if (!cal) { failed.set(c, sigNow); return; }

  const todayD = new Date();
  const todayT = Date.UTC(todayD.getFullYear(), todayD.getMonth(), todayD.getDate());
  let limit = 0;
  for (const d of cal.days) if (d.t <= todayT) limit++;
  if (limit === 0) limit = cal.days.length;

  const built = buildUi(computeStats(cal.days));
  ui = built.ui;
  state.container = c; state.table = cal.table; state.host = built.host; state.sig = cal.sig;
  state.days = cal.days; state.cells = cal.cells; state.limit = limit; state.approx = cal.approx;
  state.label = 'GitHub contributions ' + cal.days[0].date + ' to ' + cal.days[cal.days.length - 1].date;
  state.cellIndex = new Map();
  cal.cells.forEach(function (td, i) { state.cellIndex.set(td, i); });
  state.clickHandler = function (e) {
    const t = e.target && e.target.closest ? e.target.closest('td.ContributionCalendar-day') : null;
    const i = t ? state.cellIndex.get(t) : undefined;
    if (i !== undefined && i < state.limit) onCell(i);
  };
  state.table.addEventListener('click', state.clickHandler);
  rebuild(); updateSpeedOut(); show(-1); updateButton();
  if (cal.approx > 0) setStatus(cal.approx + ' days had no exact count on the page, so their notes come from the shade level.');
  c.insertAdjacentElement('afterend', built.host);
}

let debounce = 0;
function schedule() { clearTimeout(debounce); debounce = setTimeout(tryMount, 300); }
new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
['turbo:load', 'turbo:render', 'pjax:end', 'pageshow'].forEach(function (ev) { document.addEventListener(ev, schedule); window.addEventListener(ev, schedule); });
document.addEventListener('visibilitychange', function () { if (document.hidden && state.playing) pause(); });
tryMount();

})();
