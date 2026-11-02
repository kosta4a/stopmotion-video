// beat.ts: one clock for a stop-motion video cut to a song, for Remotion 4.
//
// A pose is the song's eighth note. Every time in the code is authored on a
// 200ms pose (STEP_MS) and plays SPEED times faster, so the authored pose
// plays as the song's eighth. A pose isn't a whole number of frames, so poses
// are counted on the whole video's frames (BeatClock), never on a scene's
// own. See references/clock.md.
//
// Copy this file into your project's src/ and set TEMPO to your song's
// measured tempo (scripts/find-tempo.mjs).

import { createContext, useContext } from "react";
import { Easing, useCurrentFrame, useVideoConfig } from "remotion";

// The curves, picked for their poses: sampled a few times a second, a curve's
// moves are only as even as its poses (references/poses.md).

// The strong ease-out. Leaps, then closes in: for a counter going a figure a
// pose, and for anything coming in from off the frame over a longer move,
// which would otherwise spend its slow start out of sight. Over three poses it
// gives 78, 97, 100% as a transition (onTheBeat: sampled at 1/4, 1/2, 3/4)
// and 88, 99, 100% as a move (moved(): 1/3, 2/3, 1), so a short move on it
// lands on its first pose and then hardly moves.
export const easeOut = Easing.bezier(0.23, 1, 0.32, 1);
// easeInOutSine (easings.net), for in-out moves stepped on the pose: the most
// even of the in-outs (7, 18, 25, 25, 18, 7% of the move over six poses,
// where cubic's are 3, 12, 35, 35, 12, 3 and the strong in-out's 2, 10, 48,
// 31, 8, 2), so no pose creeps at the ends or leaps in the middle.
export const easeInOutSine = Easing.bezier(0.37, 0, 0.63, 1);
// easeOutSine (easings.net), for a page laid over another, a mark rolled in,
// a card dropped into place: slowing as it lands, gently enough that none of
// so few poses creeps (38, 70, 92% over a three-pose transition).
export const easeOutSine = Easing.bezier(0.61, 1, 0.88, 1);
// easeInOutCubic (easings.net): a gentler in-out for the smooth cut's zooms.
export const easeInOutCubic = Easing.bezier(0.65, 0, 0.35, 1);

// The song's tempo, measured from its onsets (scripts/find-tempo.mjs). The
// film's track ran at 169.825 BPM; set yours.
export const TEMPO = 169.825;
// How much faster than authored the video plays: the authored 200ms pose
// plays as the song's eighth note (60 / TEMPO / 2 s; 176.65ms at 169.825).
export const SPEED = TEMPO / 150;
// The authored pose, ms, and the poses to a bar (four of the song's beats).
// The snares fall on poses 2 and 6 of each bar, counted from 0.
export const STEP_MS = 200;
export const BAR = 8;

// Authored ms to frames. Returns a fractional frame, which interpolate()
// accepts; round only where Remotion needs a whole number.
export const ms = (value: number, fps: number) => ((value / 1000) * fps) / SPEED;
// How far into a scene a frame is, in authored seconds: for anything that
// runs on its own clock (an embed, a baked animation). Never frame / fps.
export const seconds = (frame: number, fps: number) => (frame / fps) * SPEED;

// The video's frame a scene's own frame 0 lies on: always the first frame of
// one of the video's poses. Give each page its own (references/clock.md).
export const BeatClock = createContext(0);
// The way the video moves: a pose held per eighth note (the stop-motion cut),
// or smooth, every frame (the 60fps cut). The composition says which.
export const Smooth = createContext(false);
export const useSmooth = () => useContext(Smooth);

// The pose a frame is on, counted from 0 at `atMs` (negative before it); with
// `clock`, the scene's frame 0 on the video's frames.
export const stepAt = (frame: number, fps: number, atMs = 0, clock = 0) => {
  const pose = ms(STEP_MS, fps);
  return Math.floor((clock + frame - ms(atMs, fps)) / pose + 1e-9) - Math.round(clock / pose);
};
// The first frame of the video's pose `n`.
export const beatFrame = (n: number, fps: number) => Math.ceil(n * ms(STEP_MS, fps) - 1e-9);

// In a scene: the pose it's on now, on the video's poses; smooth, to the
// frame (a fraction of the way into it). Never stepAt(useCurrentFrame()),
// which counts from the scene's own first frame and runs up to a frame late.
export const useBeat = (atMs = 0) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const clock = useContext(BeatClock);
  if (useContext(Smooth)) {
    const pose = ms(STEP_MS, fps);
    return (clock + frame - ms(atMs, fps)) / pose - Math.round(clock / pose);
  }
  return stepAt(frame, fps, atMs, clock);
};
// In a scene: the scene's own frame its pose `n` starts on, on the video's
// poses.
export const useBeatFrame = () => {
  const { fps } = useVideoConfig();
  const clock = useContext(BeatClock);
  const first = Math.round(clock / ms(STEP_MS, fps));
  return (n: number) => beatFrame(first + n, fps) - clock;
};

// How far (0 to 1) a move of `poses` poses setting off on pose `from` has
// come on pose `beat`. On the beat, a step a pose, its first pose its first
// step (never a pose identical to the one it leaves), whole on its last;
// smooth, from nothing at `from`. Use it for anything that moves, then put
// the result through a curve.
export const moved = (beat: number, from: number, poses: number, smooth: boolean) =>
  Math.min(1, Math.max(0, (beat - from + (smooth ? 0 : 1)) / poses));

// The first pose at or after `atMs`: where something timed between poses
// first shows.
export const onBeat = (atMs: number) => Math.ceil(atMs / STEP_MS) * STEP_MS;
// `n` poses, in authored ms.
export const beats = (n: number) => n * STEP_MS;

// A click, on the beat, as stop motion shoots one: the pose it falls in
// pressed, the next one up (`now`: authored ms, on the beat). A web press
// (160ms down, held 140ms, 160ms up: 460ms) mostly falls between poses.
export const clicked = (now: number, atMs: number) => (now >= onBeat(atMs) && now < onBeat(atMs) + STEP_MS ? 1 : 0);
// A click as the cut moves (0 to 1): on the beat, the pose it falls in;
// smooth, pressed in the 50ms before it, so it's down as its sound is, and
// back up over 150ms (authored).
const PRESS_DOWN_MS = 50;
const PRESS_UP_MS = 150;
export const press = (now: number, atMs: number, smooth: boolean) => {
  if (!smooth) return clicked(now, atMs);
  const t = now - onBeat(atMs);
  if (t < -PRESS_DOWN_MS) return 0;
  return t < 0 ? (t + PRESS_DOWN_MS) / PRESS_DOWN_MS : Math.max(0, 1 - t / PRESS_UP_MS);
};
// A caret's blink, on the beat: on for two poses, off for two, from `since`.
// Solid while typing; blinking once the typing stops.
export const blink = (now: number, since: number) => Math.floor((now - since) / (2 * STEP_MS)) % 2 === 0;

// Zooms, thickening lines and openings grow as a zoom does: by the same
// factor each pose, so each pose reads as the same step. `t` 0 to 1, from
// `from` to `to` times.
export const grow = (t: number, from: number, to: number) => from * (to / from) ** t;
