#!/usr/bin/env node
// make-metronome.mjs: a click track for checking picture against a song.
// Dependency-free, Node 18 or later. Writes a 16-bit stereo WAV.
//
//   node make-metronome.mjs --bpm 169.825 (--beats 134 | --seconds 47.4) [--lag-ms 25] [--subdivision 1] [--bar 4] [--out metronome.wav]
//
// A click on every beat of the song (what its BPM counts), on its drum hits:
// --lag-ms after the grid, where the song's hits land in your cut (the film's
// landed 25ms after its poses; find-tempo.mjs reports the first beat's time).
// The first click of each bar is higher (2kHz to the others' 1kHz) and a
// little louder (0.75 to 0.6), as the film's metronome was. Each click is a
// sine burst: a 1ms rise and a 9ms fall away, 40ms in all.
//
// --beats: how many of the song's beats to click (a video of N poses, each
// the song's eighth note, is N / 2 beats). --seconds: or how long the track
// is. --subdivision 2 adds a quieter click half-way between beats, on every
// pose (1kHz at 0.4: a choice made for this script, not the film's).
// --bar: the song's beats to a bar. The track runs 0.5s past its last beat,
// so the last click rings out.
//
// Play it over the music at 20% (the clicks then sit about 10dB over it), in
// a composition of its own. Never in the export. --help or -h prints this.

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const fail = (message) => {
  console.error(`make-metronome: ${message}`);
  console.error("usage: node make-metronome.mjs --bpm 169.825 (--beats 134 | --seconds 47.4) [--lag-ms 25] [--subdivision 1] [--bar 4] [--out metronome.wav]  (--help for more)");
  process.exit(1);
};
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
  const value = name === "out" ? args[i + 1] : Number(args[i + 1]);
  if (value === undefined || (name !== "out" && !Number.isFinite(value))) fail(`--${name} needs a ${name === "out" ? "path" : "number"}`);
  return value;
};

const BPM = flag("bpm");
const BEATS = flag("beats");
const SECONDS = flag("seconds");
const LAG = flag("lag-ms", 0) / 1000;
const SUB = flag("subdivision", 1);
const BAR = flag("bar", 4);
const OUT = flag("out", "metronome.wav");
if (!(BPM > 0)) fail("give the song's tempo with --bpm");
if ((BEATS === undefined) === (SECONDS === undefined)) fail("give one of --beats or --seconds");
if (!(Number.isInteger(SUB) && SUB >= 1)) fail("--subdivision is a whole number, 1 or more");
if (!(Number.isInteger(BAR) && BAR >= 1)) fail("--bar is a whole number, 1 or more");

const RATE = 44100;
const BEAT = 60 / BPM;
const length = BEATS !== undefined ? BEATS * BEAT + 0.5 : SECONDS;
if (!(length > 0)) fail("nothing to write");
const samples = new Float32Array(Math.ceil(length * RATE));

const CLICK_S = 0.04;
const click = (at, hz, gain) => {
  const start = Math.round(at * RATE);
  for (let i = 0; i < Math.round(CLICK_S * RATE) && start + i < samples.length; i++) {
    if (start + i < 0) continue;
    const t = i / RATE;
    const envelope = Math.min(1, t / 0.001) * Math.exp(-t / 0.009);
    samples[start + i] += gain * envelope * Math.sin(2 * Math.PI * hz * t);
  }
};

let clicks = 0;
const lastBeat = BEATS !== undefined ? BEATS : Infinity;
for (let n = 0; ; n++) {
  const beat = n / SUB;
  const at = beat * BEAT + LAG;
  if (beat >= lastBeat || at >= length) break;
  if (n % SUB !== 0) click(at, 1000, 0.4);
  else if (beat % BAR === 0) click(at, 2000, 0.75);
  else click(at, 1000, 0.6);
  clicks++;
}

// 16-bit stereo WAV.
const data = Buffer.alloc(samples.length * 4);
samples.forEach((v, i) => {
  const s = Math.round(Math.max(-1, Math.min(1, v)) * 32767);
  data.writeInt16LE(s, i * 4);
  data.writeInt16LE(s, i * 4 + 2);
});
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);
try {
  writeFileSync(OUT, Buffer.concat([header, data]));
} catch (error) {
  fail(`can't write ${OUT}: ${error.code ?? error.message}`);
}
console.log(`${clicks} clicks at ${BPM} BPM (${SUB} a beat, the first of each ${BAR}-beat bar higher), ${LAG * 1000}ms after the grid, over ${length.toFixed(3)}s to ${OUT}`);
