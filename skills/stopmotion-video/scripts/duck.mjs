#!/usr/bin/env node
// duck.mjs: the music taken out, or lowered, round chosen clicks, so a click
// is heard. Dependency-free, Node 18 or later. Reads a 16-bit PCM WAV and
// writes a new one; the input is never changed.
//
//   node duck.mjs music.wav music-ducked.wav [--bpm 169.825 --offset 0.025 [--per-beat 2]] SPEC...
//
// Each SPEC names a click by the time of its hit (its tick, on the song's
// drum hit), in seconds; or, with --bpm, in poses (the song's eighth notes;
// --per-beat sets how many poses make one of the song's beats, 2 by default),
// counted from --offset, the time of pose 0's hit in the file (find-tempo.mjs
// reports it as the first beat; the film's was 0.025s). --offset and
// --per-beat need --bpm. A click outside the file is an error, as a forgotten
// --bpm reads poses as seconds and would duck nothing.
//
//   T      silent from 50ms before T to 120ms after it: the click alone in
//          place of the hit.
//   T-U    silent from 50ms before T until U, back in full 10ms before U's
//          hit: the click alone, and the beat coming back with what follows
//          (U is the next bar line, where the next page starts).
//   T:G    lowered to G (0 to 1) from 10ms before T to 160ms after it, let
//          back up over 60ms: room for the click's thump, as a mix makes room
//          for a kick (the film used 0.45).
//
// Every change in level is faded over 10ms (the release of T:G over 60ms),
// so nothing pops. These are the film's values (references/sound.md).
//
// The output must be a new file: never the input, by any path or link to it.
// --help or -h prints this.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const fail = (message) => {
  console.error(`duck: ${message}`);
  console.error("usage: node duck.mjs in.wav out.wav [--bpm 169.825 --offset 0.025 [--per-beat 2]] T | T-U | T:G ...  (--help for more)");
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
const flags = {};
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    const value = Number(args[i + 1]);
    if (!Number.isFinite(value)) fail(`${args[i]} needs a number`);
    flags[args[i].slice(2)] = value;
    i++;
  } else rest.push(args[i]);
}
const [input, output, ...specs] = rest;
if (!input || !output) fail("give an input and an output WAV");
// The same file under another spelling, or a link to it, is still the input.
const same = () => {
  if (resolve(input) === resolve(output)) return true;
  if (!existsSync(input) || !existsSync(output)) return false;
  const a = statSync(input);
  const b = statSync(output);
  return a.dev === b.dev && a.ino === b.ino;
};
if (same()) fail("write to a new file, so the music it was made from stays as it was");
if (!specs.length) fail("give at least one click");
for (const key of Object.keys(flags)) if (!["bpm", "offset", "per-beat"].includes(key)) fail(`unknown flag --${key}`);
if (flags.offset !== undefined && flags.bpm === undefined) fail("--offset needs --bpm");
if (flags["per-beat"] !== undefined && flags.bpm === undefined) fail("--per-beat needs --bpm");
if (flags.bpm !== undefined && !(flags.bpm > 0)) fail("--bpm must be over 0");
if (flags["per-beat"] !== undefined && !(flags["per-beat"] > 0)) fail("--per-beat must be over 0");

const BEFORE = 0.05;
const AFTER = 0.12;
const FADE = 0.01;
const DUCK_BEFORE = 0.01;
const DUCK_AFTER = 0.16;
const RELEASE = 0.06;

// A spec's time, in seconds in the file.
const POSE = flags.bpm ? 60 / flags.bpm / (flags["per-beat"] ?? 2) : 0;
const timeOf = (value) => (flags.bpm ? (flags.offset ?? 0) + value * POSE : value);
const ducks = specs.map((spec) => {
  const match = /^(-?[\d.]+)(?:([-:])([\d.]+))?$/.exec(spec);
  if (!match || !Number.isFinite(Number(match[1])) || (match[3] !== undefined && !Number.isFinite(Number(match[3]))))
    fail(`can't read "${spec}": write T, T-U or T:G`);
  const at = timeOf(Number(match[1]));
  if (match[2] === ":") {
    const share = Number(match[3]);
    if (!(share >= 0 && share <= 1)) fail(`"${spec}": the level is 0 to 1`);
    return { spec, at, share, from: at - DUCK_BEFORE, to: at + DUCK_AFTER, fadeIn: FADE, fadeOut: RELEASE };
  }
  const to = match[2] === "-" ? timeOf(Number(match[3])) - 2 * FADE : at + AFTER;
  if (to <= at - BEFORE) fail(`"${spec}": the music would come back before it went`);
  return { spec, at, share: 0, from: at - BEFORE, to, fadeIn: FADE, fadeOut: FADE };
});

// The WAV: 16-bit PCM, any number of channels; its other chunks kept.
let wav;
try {
  wav = readFileSync(input);
} catch (error) {
  fail(`can't read ${input}: ${error.code ?? error.message}`);
}
if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") fail(`${input} is not a WAV file`);
let fmt = null;
let data = null;
for (let at = 12; at + 8 <= wav.length; ) {
  const id = wav.toString("ascii", at, at + 4);
  const size = wav.readUInt32LE(at + 4);
  if (id === "fmt ") fmt = { format: wav.readUInt16LE(at + 8), channels: wav.readUInt16LE(at + 10), rate: wav.readUInt32LE(at + 12), bits: wav.readUInt16LE(at + 22) };
  if (id === "data") data = { at: at + 8, size: Math.min(size, wav.length - at - 8) };
  at += 8 + size + (size % 2);
}
if (!fmt || !data) fail(`${input} has no fmt or data chunk`);
if (!(fmt.format === 1 || fmt.format === 0xfffe) || fmt.bits !== 16) fail(`${input} is not 16-bit PCM (convert it: ffmpeg -i in -c:a pcm_s16le out.wav)`);
const RATE = fmt.rate;
const CH = fmt.channels;
const frames = Math.floor(data.size / (2 * CH));
const out = Buffer.from(wav);

// Every click inside the file, or nothing is ducked where it was meant to be.
const length = frames / RATE;
const unit = flags.bpm ? "poses" : "seconds (did you mean --bpm?)";
for (const d of ducks) {
  if (d.from - d.fadeIn >= length) fail(`"${d.spec}" falls at ${d.at.toFixed(3)}s, past the end of ${input} (${length.toFixed(3)}s); the times are ${unit}`);
  if (d.to + d.fadeOut <= 0) fail(`"${d.spec}" ends before ${input} starts; the times are ${unit}`);
}

// How loud the music is at `t`: 1, or less round a click.
const level = (t, d) => {
  if (t < d.from - d.fadeIn || t > d.to + d.fadeOut) return 1;
  const k = t < d.from ? (d.from - t) / d.fadeIn : t > d.to ? (t - d.to) / d.fadeOut : 0;
  return d.share + (1 - d.share) * k;
};
// Each duck's stretch of sample frames, overlapping ones merged, so every
// frame is written, and counted, once.
const spans = ducks
  .map((d) => [Math.max(0, Math.floor((d.from - d.fadeIn) * RATE)), Math.min(frames - 1, Math.ceil((d.to + d.fadeOut) * RATE))])
  .sort((a, b) => a[0] - b[0]);
const merged = [];
for (const [first, last] of spans) {
  const previous = merged[merged.length - 1];
  if (previous && first <= previous[1] + 1) previous[1] = Math.max(previous[1], last);
  else merged.push([first, last]);
}
let touched = 0;
let silent = 0;
for (const [first, last] of merged) {
  for (let i = first; i <= last; i++) {
    const t = i / RATE;
    let g = 1;
    for (const other of ducks) g = Math.min(g, level(t, other));
    if (g === 1) continue;
    for (let c = 0; c < CH; c++) {
      const at = data.at + (i * CH + c) * 2;
      out.writeInt16LE(Math.round(wav.readInt16LE(at) * g), at);
    }
    touched++;
    if (g === 0) silent++;
  }
}
try {
  writeFileSync(output, out);
} catch (error) {
  fail(`can't write ${output}: ${error.code ?? error.message}`);
}
const s = (t) => t.toFixed(3);
for (const d of ducks) {
  console.log(
    d.share === 0
      ? `${d.spec}: silent ${s(d.from)} to ${s(d.to)}s (fading out from ${s(d.from - d.fadeIn)}, back in full at ${s(d.to + d.fadeOut)})`
      : `${d.spec}: at ${d.share} from ${s(d.from)} to ${s(d.to)}s (down from ${s(d.from - d.fadeIn)}, back up by ${s(d.to + d.fadeOut)})`,
  );
}
console.log(`${ducks.length} ducks, ${(silent / RATE).toFixed(3)}s silent, to ${output}`);
