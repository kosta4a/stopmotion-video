#!/usr/bin/env node
// find-tempo.mjs: a song's tempo, its beat grid, and how well the grid holds,
// measured from its onsets. Dependency-free, Node 18 or later.
//
//   node find-tempo.mjs song.wav [--from 0] [--to 52.5] [--min 70] [--max 200] [--bar 4] [--bars]
//
// Input: a 16-bit PCM WAV (cut one from an MP3 with ffmpeg first; see
// references/song.md). --from and --to limit the stretch measured, in
// seconds. --min and --max bound the tempo searched, in BPM. --bar is the
// song's beats to a bar. --bars also lists every bar: where it starts, how
// hard its downbeat hits, and whether the drums are in.
//
// How:
// 1. Onset strength: spectral flux (the rise in log magnitude, bin by bin,
//    from one 23ms frame to the next, 5.8ms apart) in four bands, each band
//    scaled to its own average, so the kick, the snare's body and the hats
//    count alike.
// 2. Tempo: the autocorrelation of that strength between --min and --max,
//    then the octave: the faster of two tempos an octave apart when the
//    points half-way between its slower beats carry at least 0.6 of the
//    strength of the beats (a snare on 2 and 4 does; hats alone don't).
// 3. Grid fit: the attack of each strong hit near a grid line, from a 1ms
//    envelope of the high end (the flux's frames smear an attack over tens of
//    ms), then a least-squares line through the attacks: the beat's period
//    and the time of the first beat.
// 4. Drift: how far the hits sit off the fitted grid, the median and the
//    worst, and the worst two-bar stretch.
//
// It fails, rather than guess, when fewer than 8 beats in the stretch have a
// clear attack ("no clear beat"), or when the grid it fits falls outside
// --min and --max. --help or -h prints this.

import { readFileSync } from "node:fs";

// Arguments.
const args = process.argv.slice(2);
// This file's opening comment, as the help.
if (args.includes("--help") || args.includes("-h")) {
  const help = [];
  for (const line of readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1)) {
    if (!line.startsWith("//")) break;
    help.push(line.replace(/^\/\/ ?/, ""));
  }
  console.log(help.join("\n"));
  process.exit(0);
}
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = Number(args[i + 1]);
  if (!Number.isFinite(value)) fail(`--${name} needs a number`);
  return value;
};
const fail = (message) => {
  console.error(`find-tempo: ${message}`);
  console.error("usage: node find-tempo.mjs song.wav [--from s] [--to s] [--min 70] [--max 200] [--bar 4] [--bars]  (--help for more)");
  process.exit(1);
};
const file = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--bars"));
if (!file) fail("give a WAV file");
const MIN_BPM = flag("min", 70);
const MAX_BPM = flag("max", 200);
const BAR = flag("bar", 4);
const LIST_BARS = args.includes("--bars");
if (!(MIN_BPM > 0 && MAX_BPM > MIN_BPM)) fail("--min must be under --max");
if (!(Number.isInteger(BAR) && BAR >= 1)) fail("--bar is a whole number, 1 or more");

// A 16-bit PCM WAV, mixed to mono, -1 to 1.
const readWav = (path) => {
  let buf;
  try {
    buf = readFileSync(path);
  } catch (error) {
    fail(`can't read ${path}: ${error.code ?? error.message}`);
  }
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") fail(`${path} is not a WAV file`);
  let fmt = null;
  let data = null;
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "fmt ") fmt = { format: buf.readUInt16LE(at + 8), channels: buf.readUInt16LE(at + 10), rate: buf.readUInt32LE(at + 12), bits: buf.readUInt16LE(at + 22) };
    if (id === "data") data = { at: at + 8, size: Math.min(size, buf.length - at - 8) };
    at += 8 + size + (size % 2);
  }
  if (!fmt || !data) fail(`${path} has no fmt or data chunk`);
  if (!(fmt.format === 1 || fmt.format === 0xfffe) || fmt.bits !== 16) fail(`${path} is not 16-bit PCM (convert it: ffmpeg -i in -c:a pcm_s16le out.wav)`);
  const frames = Math.floor(data.size / (2 * fmt.channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) sum += buf.readInt16LE(data.at + (i * fmt.channels + c) * 2);
    mono[i] = sum / fmt.channels / 32768;
  }
  return { rate: fmt.rate, channels: fmt.channels, samples: mono };
};

// An in-place radix-2 FFT.
const makeFFT = (n) => {
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  return (re, im) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = im[l] * cos[k] - re[l] * sin[k];
          re[l] = re[j] - tre;
          im[l] = im[j] - tim;
          re[j] += tre;
          im[j] += tim;
        }
      }
    }
  };
};

const median = (values) => {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentile = (values, p) => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

// The song, and the stretch measured.
const wav = readWav(file);
const RATE = wav.rate;
const total = wav.samples.length / RATE;
const FROM = Math.max(0, flag("from", 0));
const TO = Math.min(total, flag("to", total));
if (TO - FROM < 10) fail("measure at least 10 seconds");
const x = wav.samples.subarray(Math.round(FROM * RATE), Math.round(TO * RATE));

// 1. Onset strength: spectral flux in four bands.
const N = 1024;
const HOP = 256;
const HOP_S = HOP / RATE;
const BANDS = [
  [30, 150],
  [150, 500],
  [500, 2500],
  [2500, 10000],
];
const fft = makeFFT(N);
const hann = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
const frames = Math.floor((x.length - N) / HOP) + 1;
const binsOf = ([lo, hi]) => [Math.max(1, Math.ceil((lo * N) / RATE)), Math.min(N / 2, Math.floor((hi * N) / RATE))];
const bandBins = BANDS.map(binsOf);
const flux = BANDS.map(() => new Float64Array(frames));
{
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let last = new Float64Array(N / 2 + 1);
  let now = new Float64Array(N / 2 + 1);
  for (let f = 0; f < frames; f++) {
    const at = f * HOP;
    for (let i = 0; i < N; i++) {
      re[i] = x[at + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k <= N / 2; k++) now[k] = Math.log1p(10 * Math.hypot(re[k], im[k]));
    if (f > 0) {
      bandBins.forEach(([lo, hi], b) => {
        let sum = 0;
        for (let k = lo; k <= hi; k++) sum += Math.max(0, now[k] - last[k]);
        flux[b][f] = sum;
      });
    }
    [last, now] = [now, last];
  }
}
// A frame's time: the middle of its window, from the stretch's start.
const frameTime = (f) => (f * HOP + N / 2) / RATE;
// Each band to its own average, summed; less a running average (0.25s each
// side), so a loud stretch doesn't outweigh a quiet one.
const onset = new Float64Array(frames);
for (const band of flux) {
  const level = mean(band) || 1;
  for (let f = 0; f < frames; f++) onset[f] += band[f] / level;
}
const strength = new Float64Array(frames);
{
  const side = Math.round(0.25 / HOP_S);
  let sum = 0;
  let count = 0;
  for (let f = 0; f < Math.min(frames, side); f++) {
    sum += onset[f];
    count++;
  }
  for (let f = 0; f < frames; f++) {
    if (f + side < frames) {
      sum += onset[f + side];
      count++;
    }
    if (f - side - 1 >= 0) {
      sum -= onset[f - side - 1];
      count--;
    }
    strength[f] = Math.max(0, onset[f] - sum / count);
  }
}
const kick = (() => {
  const level = mean(flux[0]) || 1;
  return flux[0].map((v) => v / level);
})();

// 2. Tempo by autocorrelation, then the octave. The lags searched stay
// inside --min and --max.
const lagOf = (bpm) => 60 / bpm / HOP_S;
const minLag = Math.ceil(lagOf(MAX_BPM));
const maxLag = Math.floor(lagOf(MIN_BPM));
if (minLag > maxLag) fail("--min and --max are too close to search between; widen them");
const centred = (() => {
  const m = mean(strength);
  return strength.map((v) => v - m);
})();
const ac = new Float64Array(4 * maxLag + 2);
for (let lag = 1; lag < ac.length && lag < frames; lag++) {
  let sum = 0;
  for (let f = 0; f + lag < frames; f++) sum += centred[f] * centred[f + lag];
  ac[lag] = sum / (frames - lag);
}
// A comb: the lag, and its multiples, a little less each.
const comb = (lag) => {
  let score = 0;
  for (let m = 1; m <= 4; m++) {
    const l = m * lag;
    const i = Math.floor(l);
    if (i + 1 >= ac.length) break;
    score += (ac[i] + (ac[i + 1] - ac[i]) * (l - i)) / m;
  }
  return score;
};
let bestLag = minLag;
for (let lag = minLag; lag <= maxLag; lag += 0.05) if (comb(lag) > comb(bestLag)) bestLag = lag;
const acBpm = 60 / (bestLag * HOP_S);

// The strength folded onto one beat of period `p` (s), in 16 slices.
const fold = (p) => {
  const slices = new Float64Array(16);
  const counts = new Float64Array(16);
  for (let f = 0; f < frames; f++) {
    const phase = (frameTime(f) / p) % 1;
    const s = Math.floor(phase * 16) % 16;
    slices[s] += strength[f];
    counts[s]++;
  }
  return slices.map((v, i) => v / (counts[i] || 1));
};
// How strong the half-way points are against the beats, at period `p`.
const halfWay = (p) => {
  const slices = fold(p);
  let on = 0;
  for (let i = 1; i < 16; i++) if (slices[i] > slices[on]) on = i;
  const around = (i) => Math.max(slices[(i + 15) % 16], slices[i % 16], slices[(i + 1) % 16]);
  return around(on + 8) / around(on);
};
let period = 60 / acBpm;
let octave = "";
if (60 / (period / 2) <= MAX_BPM) {
  const ratio = halfWay(period);
  if (ratio >= 0.6) {
    octave = `autocorrelation found ${acBpm.toFixed(2)}; the points half-way between its beats carry ${ratio.toFixed(2)} of their strength, so the beat is twice as fast`;
    period /= 2;
  } else {
    octave = `the points half-way between beats carry ${ratio.toFixed(2)} of their strength (under 0.6), so the beat stays at ${acBpm.toFixed(2)}`;
  }
} else {
  octave = `twice ${acBpm.toFixed(2)} is over --max ${MAX_BPM}`;
}

// A finer period and phase: where the strength lines up best with a grid.
const coherence = (p) => {
  let re = 0;
  let im = 0;
  for (let f = 0; f < frames; f++) {
    if (!strength[f]) continue;
    const a = (2 * Math.PI * frameTime(f)) / p;
    re += strength[f] * Math.cos(a);
    im += strength[f] * Math.sin(a);
  }
  return { size: Math.hypot(re, im), angle: Math.atan2(im, re) };
};
{
  let best = period;
  let bestSize = -1;
  for (let k = -200; k <= 200; k++) {
    const p = period * (1 + k * 1e-4);
    const { size } = coherence(p);
    if (size > bestSize) {
      bestSize = size;
      best = p;
    }
  }
  period = best;
}
let first = (((coherence(period).angle / (2 * Math.PI)) * period) % period + period) % period;

// 3. Attacks: a 1ms envelope of the high end (the first difference of the
// signal), its rise taken across two bins either side, so it isn't late.
const BIN = Math.max(1, Math.round(RATE / 1000));
const BIN_S = BIN / RATE;
const bins = Math.floor(x.length / BIN);
const envelope = new Float64Array(bins);
for (let b = 0; b < bins; b++) {
  let sum = 0;
  for (let i = b * BIN; i < (b + 1) * BIN; i++) {
    const d = i > 0 ? x[i] - x[i - 1] : 0;
    sum += d * d;
  }
  envelope[b] = Math.sqrt(sum / BIN);
}
const smoothed = envelope.map((_, b) => (envelope[Math.max(0, b - 1)] + envelope[b] + envelope[Math.min(bins - 1, b + 1)]) / 3);
const rise = new Float64Array(bins);
for (let b = 2; b < bins - 2; b++) rise[b] = Math.max(0, smoothed[b + 2] - smoothed[b - 2]);
const binTime = (b) => (b + 0.5) * BIN_S;

// The strongest attack within a sixth of a beat of each grid line.
const pick = (p, t0) => {
  const hits = [];
  const kFirst = Math.ceil((p / 6 - t0) / p);
  const kLast = Math.floor((x.length / RATE - p / 6 - t0) / p);
  for (let k = kFirst; k <= kLast; k++) {
    const at = t0 + k * p;
    const lo = Math.max(2, Math.floor((at - p / 6) / BIN_S));
    const hi = Math.min(bins - 3, Math.ceil((at + p / 6) / BIN_S));
    let best = lo;
    for (let b = lo; b <= hi; b++) if (rise[b] > rise[best]) best = b;
    // Between bins: the peak of a parabola through the three.
    const [a, c, e] = [rise[best - 1], rise[best], rise[best + 1]];
    const shift = a - 2 * c + e ? (0.5 * (a - e)) / (a - 2 * c + e) : 0;
    hits.push({ k, time: binTime(best + Math.max(-0.5, Math.min(0.5, shift))), value: c });
  }
  return hits;
};
// A straight line through the hits' times by their beat numbers.
const fit = (hits) => {
  const mk = mean(hits.map((h) => h.k));
  const mt = mean(hits.map((h) => h.time));
  let num = 0;
  let den = 0;
  for (const h of hits) {
    num += (h.k - mk) * (h.time - mt);
    den += (h.k - mk) ** 2;
  }
  const p = num / den;
  return { p, t0: mt - p * mk };
};
// A hit only counts as strong with a real attack: over 0.4 of the loudest
// tenth, and over nothing, so silence can't line up as a perfect grid.
const TINY = 1e-6;
const FEWEST = 8;
const noBeat = () => fail(`no clear beat in this stretch (fewer than ${FEWEST} beats with a sharp attack); measure a stretch with drums in it`);
let strong = [];
let dropped = 0;
let all = [];
for (let round = 0; round < 4; round++) {
  all = pick(period, first);
  const floor = Math.max(TINY, 0.4 * percentile(all.map((h) => h.value), 0.9));
  strong = all.filter((h) => h.value >= floor);
  if (strong.length < FEWEST) noBeat();
  let line = fit(strong);
  // Leave out hits far off the line (a fill, a flam), then fit again.
  const off = strong.map((h) => h.time - (line.t0 + h.k * line.p));
  const spread = 1.4826 * median(off.map((o) => Math.abs(o - median(off))));
  const kept = strong.filter((_, i) => Math.abs(off[i] - median(off)) <= Math.max(0.003, 4 * spread));
  dropped = strong.length - kept.length;
  strong = kept;
  if (strong.length < FEWEST) noBeat();
  line = fit(strong);
  period = line.p;
  first = ((line.t0 % period) + period) % period;
}
// The grid fitted must be a tempo that was asked for.
if (!(60 / period >= MIN_BPM && 60 / period <= MAX_BPM))
  fail(`the grid fitted runs at ${(60 / period).toFixed(2)} BPM, outside --min ${MIN_BPM} and --max ${MAX_BPM}; widen them if that's the song's tempo, or measure a longer stretch`);

// 4. How far the hits sit off the grid.
const offsets = strong.map((h) => h.time - (first + h.k * period));
const absMs = offsets.map((o) => Math.abs(o) * 1000);
const windowBeats = 2 * BAR;
const windows = new Map();
strong.forEach((h, i) => {
  const w = Math.floor(h.k / windowBeats);
  if (!windows.has(w)) windows.set(w, []);
  windows.get(w).push(offsets[i]);
});
const windowMs = [...windows.values()].filter((o) => o.length >= 3).map((o) => Math.abs(median(o)) * 1000);

// The downbeat: the beat of the bar where the low band hits hardest.
const kickAt = (t) => {
  const f0 = Math.max(0, Math.floor((t - period / 8 - N / 2 / RATE) / HOP_S));
  const f1 = Math.min(frames - 1, Math.ceil((t + period / 8 - N / 2 / RATE) / HOP_S));
  let v = 0;
  for (let f = f0; f <= f1; f++) v = Math.max(v, kick[f]);
  return v;
};
const beatsIn = Math.floor((x.length / RATE - first) / period);
const positions = Array.from({ length: BAR }, (_, j) => {
  const values = [];
  for (let k = j; k < beatsIn; k += BAR) values.push(kickAt(first + k * period));
  return values.length ? mean(values) : 0;
});
const downbeat = positions.indexOf(Math.max(...positions));

// Report.
const bpm = 60 / period;
const s = (t) => (FROM + t).toFixed(3);
const pose = period / 2;
console.log(`${file}: ${total.toFixed(2)}s, ${RATE} Hz, ${wav.channels} ch; measured ${FROM.toFixed(2)} to ${TO.toFixed(2)}s`);
console.log(`tempo     ${bpm.toFixed(2)} BPM (${bpm.toFixed(3)}); ${octave}`);
console.log(`feel      half-time ${(bpm / 2).toFixed(2)} BPM; double-time ${(bpm * 2).toFixed(2)} BPM`);
console.log(`grid      first beat at ${s(first)}s; a beat every ${(period * 1000).toFixed(2)}ms; a bar of ${BAR} every ${(period * BAR).toFixed(4)}s`);
console.log(`pose      the eighth note: ${(pose * 1000).toFixed(2)}ms, ${(pose * 30).toFixed(4)} frames at 30fps, ${(1 / pose).toFixed(2)} poses a second; SPEED = TEMPO / 150 = ${(bpm / 150).toFixed(5)}`);
console.log(`downbeat  likely beat ${downbeat + 1} of the bar (the low band hits hardest there): first downbeat at ${s(first + downbeat * period)}s`);
console.log(
  `drift     ${strong.length} strong hits of ${all.length} beats: median ${median(absMs).toFixed(1)}ms off the grid, worst ${Math.max(...absMs).toFixed(1)}ms` +
    `${dropped ? ` (${dropped} off-grid hits left out)` : ""}; worst ${windowBeats}-beat stretch ${windowMs.length ? Math.max(...windowMs).toFixed(1) : "-"}ms off`,
);

if (LIST_BARS) {
  // Each bar: its start; how hard its downbeat hits in the low band, against
  // the median bar's (a big kick stands well over it); and how sharp the
  // attacks on its beats are, each half of the bar against the median half
  // (the drums dropping out shows as a half well under it). Pointers to
  // listen for, not a verdict: a pad or a sample with sharp attacks can read
  // as drums.
  const hits = pick(period, first);
  const halves = new Map();
  for (const h of hits) {
    const half = Math.floor((h.k - downbeat) / (BAR / 2));
    if (!halves.has(half)) halves.set(half, []);
    halves.get(half).push(h.value);
  }
  const attackMid = median([...halves.values()].map(mean)) || 1;
  const attacks = (half) => (halves.has(half) ? mean(halves.get(half)) / attackMid : NaN);
  const bars = [];
  for (let k = downbeat, n = 0; k + BAR <= beatsIn + 1; k += BAR, n++) {
    const t = first + k * period;
    bars.push({ t, kick: kickAt(t), halves: [attacks(2 * n), attacks(2 * n + 1)] });
  }
  const kickMid = median(bars.map((b) => b.kick)) || 1;
  console.log("");
  console.log("bar  start (s)  downbeat  attacks 1st half, 2nd half");
  bars.forEach((b, i) => {
    const notes = [];
    if (b.kick / kickMid >= 1.6) notes.push("big kick");
    b.halves.forEach((v, h) => {
      if (v < 0.5) notes.push(`quiet ${h ? "2nd" : "1st"} half`);
    });
    const cells = b.halves.map((v) => (Number.isFinite(v) ? v.toFixed(2) : "-").padStart(6)).join("");
    console.log(`${String(i + 1).padStart(3)}  ${s(b.t).padStart(9)}  ${(b.kick / kickMid).toFixed(2).padStart(8)}  ${cells}   ${notes.join(", ")}`);
  });
  console.log("(against the median bar; bars counted from the first downbeat measured; listen to confirm)");
}
