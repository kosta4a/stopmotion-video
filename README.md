# stopmotion-video

A motion skill for agents and people. It teaches how to make **stop-motion style video cut to music**, and how to make the decisions behind it.

The frame rate stays low on purpose. Each pose holds for one eighth note of the song, and everything changes together on the beat. Pages come on at bar lines, every click sounds on a kick or a snare, and the big changes land on the big kicks. When a move looks rough, its poses are spaced better; the beat is never smoothed away.

The skill also covers knowing when to break the grid: dropping the music so one click is heard alone, holding a result for a beat, cutting whole bars instead of part bars, and ending on a song beat. It was distilled from making a 47-second launch film cut to a drum and bass track at 169.825 BPM, over a few hundred rounds of notes. It records the rules with their exact values and the reasons for them, so an agent can apply them to a new song instead of copying an old video.

## What it covers

- **Decision order**: measure the song, set the clock, lay pages on bars, place the hits, space the poses, change pages, set the type, make the sound, decide where to skip, check, and play it live if it's for a web page.
- **The song**: tempo from onsets, checking that the grid holds, bars, phrases, drops and big kicks, cutting the excerpt exact to the sample, half-time feel.
- **The clock**: a pose as the song's eighth note, authoring on a 200ms pose, one clock for the whole video, pages on bar lines, changing lengths by whole bars, Remotion wiring, a 60fps smooth variant.
- **Poses**: picking curves by their poses, a move's first step, hand-placed jitter and landing, zooms that grow by the same factor each pose, and rules for clicks, carets, spinners, rolled marks, counters, cursors and typing.
- **Hits and transitions**: what lands on which drum, and seven kinds of page change, none of which fades.
- **When to skip a beat**: drops, ducks, holds, snapping notes, cutting whole bars, and the ending.
- **Sound**: clicks placed to the sample, one baked click track, a click tuned to the song's bass, ducking, a metronome.
- **Type in the frame**: tracking that tightens as size grows, leading, contrast at every pose, tabular figures, typed titles.
- **Checking**: contact sheets one pose per still, measured sync, notes given as timestamps, the review loop.
- **Playing it live**: the same rules in a browser against a metronome: one clock on the page's time, the picture just ahead of the sound, sound scheduled ahead on the audio clock, starting and pausing the sound, every change on a click when there is no song, reduced motion and type on screen.
- **Tools**: Remotion beat helpers and transitions in TypeScript, and dependency-free Node scripts that measure a song's tempo, duck music round clicks and write a metronome.

## Layout

```
stopmotion-video/
├── README.md
├── LICENSE
└── skills/
    └── stopmotion-video/
        ├── SKILL.md                    # posture, decision order, rules at a glance, when to skip a beat, never-ship list
        ├── references/
        │   ├── song.md                 # measuring the track, cutting the excerpt, mapping it to poses and bars
        │   ├── clock.md                # one clock, frames per pose, bar lines, page lengths, Remotion wiring
        │   ├── poses.md                # stop-motion spacing and the rules for each kind of thing
        │   ├── hits.md                 # what lands where, and the transitions
        │   ├── skipping.md             # when to skip, hold, drop or duck a beat, and why
        │   ├── sound.md                # clicks to the sample, ducking, the metronome
        │   ├── type.md                 # tracking by size, leading, contrast, typing
        │   ├── checking.md             # contact sheets, measured sync, notes as timestamps
        │   └── live.md                 # playing it live in a browser, against a metronome
        ├── assets/
        │   └── remotion/
        │       ├── beat.ts             # TEMPO, SPEED, the beat clock and helpers, the curves
        │       └── transitions.tsx     # onTheBeat, inSteps, onQuarters, slideOver, pixels, throughShape
        └── scripts/
            ├── find-tempo.mjs          # tempo, beat grid, drift and bars from a WAV
            ├── duck.mjs                # music silenced or lowered round clicks
            └── make-metronome.mjs      # a click track for checking
```

## Install

### Claude Code

Clone the repository, then copy or symlink the skill folder into your skills directory.

```sh
git clone https://github.com/kosta4a/stopmotion-video.git
cd stopmotion-video
mkdir -p ~/.claude/skills

# copy, to ~/.claude/skills/stopmotion-video
cp -R skills/stopmotion-video ~/.claude/skills/

# or symlink, so a git pull updates it
ln -s "$(pwd)/skills/stopmotion-video" ~/.claude/skills/stopmotion-video
```

Keep the `mkdir -p`: without an existing `~/.claude/skills`, `cp -R` copies the skill's files straight into a new folder of that name, and the skill isn't found. Run again, the copy replaces the old files in place. For a single project, run the same lines with `<project>/.claude/skills` in place of `~/.claude/skills`.

With the [skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add kosta4a/stopmotion-video
```

Claude loads the skill when a task matches its description: stop-motion or low frame rate video, cutting a video to a song, Remotion timed to a BPM, scenes played live to a metronome. You can also ask for it by name: "Use stopmotion-video to cut this launch film to the track" or "Check this cut against stopmotion-video".

### Other agents

The skill is plain Markdown with a few files of code. Point your agent at `skills/stopmotion-video/SKILL.md` and let it open the reference files as needed.

## Using the tools

The scripts need Node 18 or later and nothing else. Each prints its options with `--help`. They read and write 16-bit PCM WAV, so convert a song first:

```sh
ffmpeg -i song.mp3 -ac 2 -ar 44100 -c:a pcm_s16le song.wav
node skills/stopmotion-video/scripts/find-tempo.mjs song.wav --bars
node skills/stopmotion-video/scripts/make-metronome.mjs --bpm 169.825 --beats 134 --lag-ms 25 --out metronome.wav
node skills/stopmotion-video/scripts/duck.mjs song.wav song-ducked.wav --bpm 169.825 --offset 0.025 70-72 150:0.45
```

Copy `assets/remotion/beat.ts` and `transitions.tsx` into a Remotion 4 project's `src/` and set `TEMPO` to your song's tempo. They need `remotion`, `@remotion/transitions` and React, and TypeScript 5.x.

## Not included

No music, no samples and no fonts. Bring your own track and clear its rights, along with any sound you sample from it. The examples use Geist and Geist Mono, which you install yourself.

## Credits

- Distilled from making a 47-second launch film cut to a drum and bass track, including the designer's own notes and the reasons recorded next to each decision.
- The curves `easeInOutSine`, `easeOutSine` and `easeInOutCubic` are from [easings.net](https://easings.net).
- The type and contrast rules follow the designer's product skill, [tactile-design](https://github.com/kosta4a/tactile-design).

## Contributions

This repository doesn't take pull requests or issues. Fork it and adapt it freely under the licence.

## Licence

MIT. See [LICENSE](LICENSE).
