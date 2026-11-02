// transitions.tsx: page changes that step on the beat, for Remotion 4's
// @remotion/transitions (TransitionSeries). See references/hits.md.
//
// Timings: onTheBeat (a transition of a few poses on a curve), inSteps (its
// count of poses, for a presentation that places each pose itself),
// onQuarters (stepping on the song's beats). Presentations: slideOver (laid
// over like a sheet), pixels (blocks spreading from a click), throughShape
// (the next page seen through growing openings). Nothing here fades.

import type { FC } from "react";
import { AbsoluteFill, random, useVideoConfig } from "remotion";
import type { TransitionPresentation, TransitionPresentationComponentProps, TransitionTiming } from "@remotion/transitions";
import { beatFrame, easeOutSine, grow, stepAt, useSmooth } from "./beat";

// A transition on the beat: `poses` poses from the video's pose `from`, each
// held a pose, spaced on `curve` (easeOutSine by default: 38, 70, 92% over
// three). Its poses sit at 1 / (poses + 1) to poses / (poses + 1) of the
// curve, so none of them is the old page alone or the new one alone: those
// are the poses either side of it. Smooth: every frame on the curve.
export const onTheBeat = (poses: number, from: number, curve: (t: number) => number = easeOutSine, smooth = false): TransitionTiming => ({
  getDurationInFrames: ({ fps }) => beatFrame(from + poses, fps) - beatFrame(from, fps),
  getProgress: ({ frame, fps }) => {
    if (smooth) return curve(Math.min(1, frame / (beatFrame(from + poses, fps) - beatFrame(from, fps))));
    const pose = Math.min(poses - 1, Math.max(0, stepAt(frame, fps, 0, beatFrame(from, fps))));
    return curve((pose + 1) / (poses + 1));
  },
});

// A transition's progress as its count of poses: k / poses on its k-th (1 on
// its first), so a presentation can place each pose itself. Smooth: its share
// of the transition, to the frame.
export const inSteps = (poses: number, from: number, smooth = false): TransitionTiming => ({
  getDurationInFrames: ({ fps }) => beatFrame(from + poses, fps) - beatFrame(from, fps),
  getProgress: ({ frame, fps }) =>
    smooth
      ? Math.min(1, frame / (beatFrame(from + poses, fps) - beatFrame(from, fps)))
      : (Math.min(poses - 1, Math.max(0, stepAt(frame, fps, 0, beatFrame(from, fps)))) + 1) / poses,
});

// A transition stepping on the song's beats (two poses each, the metronome's
// clicks): a step on each, whole on its `steps`th (by default the page's own
// start). `from` must be one of the song's beats (an even pose). The film's
// unveil: onQuarters(4, from, smooth, 3), a third, two thirds, whole.
export const onQuarters = (poses: number, from: number, smooth = false, steps = poses / 2 + 1): TransitionTiming => ({
  getDurationInFrames: ({ fps }) => beatFrame(from + poses, fps) - beatFrame(from, fps),
  getProgress: ({ frame, fps }) =>
    smooth
      ? Math.min(1, frame / (beatFrame(from + 2 * (steps - 1), fps) - beatFrame(from, fps)))
      : Math.min(1, (Math.floor(Math.min(poses - 1, Math.max(0, stepAt(frame, fps, 0, beatFrame(from, fps)))) / 2) + 1) / steps),
});

// The next page slid over the last as a sheet of paper is laid on another,
// which stays put under it: a hand's, so a little askew as it comes and
// squared up as it lands (TILT degrees at its start), its edge casting the
// faintest shadow on the page it covers. Use with onTheBeat(3, from).
type Direction = "from-left" | "from-right" | "from-top" | "from-bottom";
type SlideOverProps = { direction: Direction };
const SHEET_SHADOW = "0 0 22px rgba(0, 0, 0, 0.16)";
const TILT = 3;

const SlideOver: FC<TransitionPresentationComponentProps<SlideOverProps>> = ({
  children,
  presentationProgress,
  presentationDirection,
  passedProps: { direction },
}) => {
  if (presentationDirection === "exiting") return <AbsoluteFill>{children}</AbsoluteFill>;
  const off = (1 - presentationProgress) * 100;
  const turn = (1 - presentationProgress) * TILT;
  const transform = {
    "from-left": `translateX(${-off}%) rotate(${-turn}deg)`,
    "from-right": `translateX(${off}%) rotate(${turn}deg)`,
    "from-top": `translateY(${-off}%) rotate(${turn}deg)`,
    "from-bottom": `translateY(${off}%) rotate(${-turn}deg)`,
  }[direction];
  return <AbsoluteFill style={{ transform, boxShadow: SHEET_SHADOW }}>{children}</AbsoluteFill>;
};

export const slideOver = (direction: Direction): TransitionPresentation<SlideOverProps> => ({
  component: SlideOver,
  props: { direction },
});

// The next page unveiled in blocks: the frame as a grid of `cell` px squares,
// each showing the next page from its turn on, the turns spreading out from
// `origin` (frame px: where the click was) to the farthest corner, give or
// take a little (0.8 of its distance, 0.2 a seeded random), so the edge is
// ragged as a fill of pixels is. The page under it stays put; the next page
// is whole under the blocks, words and all. The film used 120px blocks timed
// by onQuarters.
type PixelsProps = { cell: number; origin: { x: number; y: number } };

const Pixels: FC<TransitionPresentationComponentProps<PixelsProps>> = ({
  children,
  presentationProgress,
  presentationDirection,
  passedProps: { cell, origin },
}) => {
  const { width, height } = useVideoConfig();
  if (presentationDirection === "exiting") return <AbsoluteFill>{children}</AbsoluteFill>;
  const across = Math.ceil(width / cell);
  const down = Math.ceil(height / cell);
  const far = Math.max(...[0, width].flatMap((x) => [0, height].map((y) => Math.hypot(x - origin.x, y - origin.y))));
  let d = "";
  for (let j = 0; j < down; j++) {
    for (let i = 0; i < across; i++) {
      const x = i * cell;
      const y = j * cell;
      const out = Math.hypot(x + cell / 2 - origin.x, y + cell / 2 - origin.y) / far;
      const turn = 0.8 * out + 0.2 * random(`pixel-${i}-${j}`);
      // A hair over each block's edges, so neighbours meet without a seam.
      if (turn < presentationProgress) d += `M${x - 0.5} ${y - 0.5}h${cell + 1}v${cell + 1}h${-(cell + 1)}Z`;
    }
  }
  if (!d) return null;
  return <AbsoluteFill style={{ clipPath: presentationProgress >= 1 ? undefined : `path("${d}")` }}>{children}</AbsoluteFill>;
};

export const pixels = (cell: number, origin: { x: number; y: number }): TransitionPresentation<PixelsProps> => ({
  component: Pixels,
  props: { cell, origin },
});

// The next page seen through openings shaped like something on the last page
// (the film's were a pair of eyes that had just shut), growing from where
// they were: on its k-th pose of `poses` (time it with inSteps), each opening
// `from` × (to / from)^((k − 1) / (poses − 1)) times its size, growing as a
// zoom does, till they've run together over the frame. The page under them
// stays put. `shape(x, y, scale)` returns an SVG path for one opening centred
// on (x, y); draw every opening the same way round, so where two overlap is
// open too. The film's ran from 1.25 to 15 times over four poses, the next
// page already playing under them (a `live` page: references/clock.md).
// Generalised from the film's eye-shaped version.
type ThroughShapeProps = {
  at: { x: number; y: number }[];
  shape: (x: number, y: number, scale: number) => string;
  from: number;
  to: number;
  poses: number;
};

const ThroughShape: FC<TransitionPresentationComponentProps<ThroughShapeProps>> = ({
  children,
  presentationProgress,
  presentationDirection,
  passedProps: { at, shape, from, to, poses },
}) => {
  const smooth = useSmooth();
  if (presentationDirection === "exiting") return <AbsoluteFill>{children}</AbsoluteFill>;
  const k = Math.round(presentationProgress * poses);
  if (smooth ? presentationProgress <= 0 : k < 1) return null;
  const scale = smooth ? grow(presentationProgress, from, to) : grow((k - 1) / Math.max(1, poses - 1), from, to);
  const d = at.map(({ x, y }) => shape(x, y, scale)).join("");
  return <AbsoluteFill style={{ clipPath: `path("${d}")` }}>{children}</AbsoluteFill>;
};

export const throughShape = (props: ThroughShapeProps): TransitionPresentation<ThroughShapeProps> => ({
  component: ThroughShape,
  props,
});
