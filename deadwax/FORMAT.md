# The Pressing format — Dead Wax 1

A **Pressing** is a UTF-8 plain-text `.deadwax` file. It describes a repeating,
instrumental loop. Dead Wax reads it locally: no uploads, sample downloads,
external fonts, libraries, model calls or analytics. The optional Gist importer
contacts only `https://api.github.com/gists/{id}`.

Open [the player](index.html), select an example and press **Play**. It also
works as a standalone downloaded `index.html`, without a server or build step.
Browser storage availability for `file:` URLs varies; file export always works.

## A complete short example

```text
deadwax 1
title A quiet corner
tempo 76
meter 4/4
key C major
swing 0.16
bars 4
seed 104729

instrument chords epiano
instrument bass upright
instrument melody vibes
level chords 0.7
level bass 0.8
level melody 0.4
level drums 0.65

chords Dm9:4 G13:4 Cmaj7#11:4 Am9:4
bass auto root-fifth
melody -:2 A4:1 C5:1 B4:2 -:2 E5:4 -:4
kick X... ..g. x... ....
rim .... x... .... x..g
hats x.g. x.g. x.g. x.gg

texture vinyl 0.12
texture tape 0.05
texture rain 0.1

drift rate 0.35
drift tempo 60 96
drift swing 0 0.4
drift tone 0.15 0.85
drift busyness 0.1 0.8
drift vinyl 0 0.5
```

## Lines and diagnostics

- The first non-blank, non-comment line must be exactly `deadwax 1`.
- Keywords, notes, instruments and chord symbols are case-sensitive.
- One directive per line. Spaces/tabs separate tokens. Blank lines are ignored.
- `;` starts a full-line comment, or an inline comment when preceded by
  whitespace. `#` is **not** a comment character: it belongs to sharp notes and
  chord alterations.
- Required lines: `deadwax`, `title`, `tempo`, `meter`, `key`, `swing`, `bars`,
  `chords`. Other lines have defaults.
- Header and sequence lines cannot be duplicated. `instrument`, `level`,
  `dimension`, `texture` and `drift` may repeat for different settings; later
  settings for the same name win.
- Unknown directives, instruments and tokens are errors, not silent fallbacks.
- Errors identify a 1-based line and column. Token errors point to the token (or
  bad character); sequence-length/cross-field errors point to the line start.
  Missing required lines and invalid cross-field drift bounds point to line 1.
  Clicking an error focuses its location in the editor. Invalid input never
  replaces the last valid playing score.

## Header

| Line                         | Meaning                                                        |
| ---------------------------- | -------------------------------------------------------------- |
| `title Window seat, 1:17 am` | Unquoted title, remainder of the line                          |
| `tempo 72`                   | Quarter notes per minute, 45–130; decimals allowed             |
| `meter 4/4`                  | Numerator 1–12; denominator 4 or 8                             |
| `key C minor`                | Root plus `major`, `minor`, `dorian` or `mixolydian`           |
| `swing 0.18`                 | Odd sixteenths delayed by this fraction of a sixteenth, 0–0.48 |
| `bars 4`                     | Loop length, integer 1–64                                      |
| `seed 104729`                | Unsigned 32-bit integer, default 104729                        |

**Tempo always counts quarter notes**, including 6/8. A 6/8 bar is three quarter
notes, or twelve sixteenth-note steps. The key is descriptive metadata; explicit
chords and notes are authoritative. Changing the key does not transpose them.

## Chords and durations

```text
chords Dm9:4 G13:4 Cmaj7#11:4 F#m7b5:2 Bb7alt:2
```

`symbol:duration` means a chord for that many **quarter notes**. Durations must
be positive multiples of `0.25`; the total must equal the complete loop length.
Chords may span bars or change mid-bar. They are softly rearticulated at bar
boundaries. A 4-bar 4/4 loop totals 16 quarter notes; 4 bars of 3/4 total 12.

Roots: `A`–`G`, optionally `#` or `b`. Supported qualities:

```text
(no suffix)  m  6  m6  7  maj7  m7  mmaj7
9  maj9  m9  11  m11  13  maj13  m13
m7b5  dim  dim7  aug  sus2  sus4  7sus4  add9  7alt  alt
```

Append alterations `b5`, `#5`, `b9`, `#9`, `b11`, `#11`, `b13`, `#13`, including
several together, e.g. `G7b9#5`. Add a slash bass: `Cmaj9/E`, `Abmaj9/Eb`.
Automatic bass respects the slash root; keyboard voicings remain rootless.

The voicing engine searches rootless/extension, shell, drop-2, quartal and
upper-structure shapes and minimises motion from the previous chord. Density and
register influence the search; seeded variation avoids a completely mechanical
repetition. Explicit extensions are retained in the pitch pool. This is a
compact voicing engine, not a comprehensive jazz-theory or arbitrary
chord-symbol interpreter.

### Explicit voicings (used by Capture)

```text
chords Dm9:4 G13:4 Cmaj9:8
chord-notes F3+A3+C4+E4:4 F3+B3+E4+A4:4 E3+G3+B3+D4:8
```

`chord-notes` overrides the voicing search. It must have exactly the same number
of events and durations as `chords`. `-:4` means a silent chord event. This lets
Capture preserve chosen notes and arrangement gaps without requiring the PRNG to
rediscover them.

## Bass and melody

```text
bass auto roots
bass auto root-fifth
bass auto walking
```

Choose one. Roots plays half-note pulses; root-fifth alternates at quarter
notes; walking uses roots/thirds/fifths and chromatic approaches to the next
bar. Notes stay in a bass register. Default: `auto roots`.

Or write explicit notes:

```text
bass C2:2 G2:2 A1:2 E2:2
melody E4:1 G4:0.5 A4:0.5 -:2
```

Notes are `A`–`G`, optional `#`/`b`, octave 0–8 (C4 is middle C). `-` is a rest.
Use `+` for simultaneous pitches, e.g. `C4+Eb4:1`. Each explicit sequence must
have a total duration that divides the complete loop exactly. Shorter sequences
repeat. Omit `melody` for no motif; Drift can add chord-tone fragments if
embellishment rises. Explicit sequences can sustain across bar lines.

## Drums

One line per voice: `kick`, `snare`, `rim`, `hats`, `brushes`, `perc`.

```text
kick X... ..g. x... .... | X... .... x..g ..g.
rim .... x... .... x..g
hats x.g. x.g. x.g. x.gg
```

Each character is one sixteenth note. Spaces are cosmetic. `|` separates bars;
there are no leading/trailing pipes. Each grid bar must contain exactly the
meter's number of sixteenths (16 for 4/4, 12 for 3/4 or 6/8).

| Mark | Meaning    | Velocity |
| ---- | ---------- | -------- |
| `.`  | Rest       | 0        |
| `x`  | Normal hit | 0.68     |
| `X`  | Accent     | 1        |
| `g`  | Ghost note | 0.24     |

The number of written grid bars must divide the loop length. A single bar
repeats throughout. Missing voices are silent (but Drift can introduce ghost
hits).

## Instruments, mix and muting

```text
instrument chords epiano
instrument bass upright
instrument melody vibes
level chords 0.7
level bass 0.8
level melody 0.4
level drums 0.65
mute melody drums
```

Melodic instruments: `epiano` (FM tine), `felt` (muted additive piano),
`upright` (plucked triangle/body), `vibes` (inharmonic metallic partial), `pad`
(detuned, filtered soft triangles). Any melodic instrument can be used on any
melodic part. Defaults are as above, except the default melody level is 0.45.

The drum kit is procedural too: pitched envelopes, filtered noise and resonant
clicks. `perc` is a soft falling wood-like tone. Mix levels are 0–1. Omit `mute`
for no mutes. Master volume is a listener setting, not part of the Pressing.

The master chain has kick ducking, low-pass tone, tape-like saturation, optional
bit-depth quantisation (`dimension crush`), dual-rate modulated delay for wow
and flutter, and a seeded stereo convolution reverb. Everything is generated in
the browser, including the reverb impulse.

## Textures

```text
texture vinyl 0.12
texture surface 0.04
texture tape 0.05
texture rumble 0.06
texture rain 0.2
texture room 0.03
texture hum 0.02
```

All levels are 0–1. `vinyl` combines seeded short pops with density proportional
to level. `surface` and `tape` are differently filtered hiss; `rumble` is a pair
of sub-bass tones; `rain` is filtered noise plus occasional drops; `room` is
dark noise; `hum` uses 50 Hz and harmonics. Defaults: vinyl 0.12, tape 0.05, all
others zero. The examples explicitly set their own surface levels.

Starting playback adds a needle-drop transient. **Stop** bends active pitches
down and fades the session like stopping tape. With **Loop** off, the loop plays
once, then enters a repeating run-out click until Stop. These transport effects
are not part of a captured score.

## Drift

Every dimension has an origin from the Pressing, a current value, momentum and a
target. Only explicitly permitted dimensions move. Add a bound per dimension:

```text
drift rate 0.35
drift tempo 58 100
drift tone 0.1 0.9
drift reverb 0.1 0.75
drift rain 0 0.5
```

Origins must lie inside the bounds. Limits must be inside the absolute range.
Omitting a dimension from `drift` locks it at home. Set initial non-header,
non-texture dimensions with `dimension NAME VALUE`:

| Dimension         | Absolute range | Default   | Effect                                                        |
| ----------------- | -------------- | --------- | ------------------------------------------------------------- |
| tempo             | 45–130         | header    | Quarter-note rate, smoothed each step                         |
| swing             | 0–0.48         | header    | Sixteenth-note swing                                          |
| humanise          | 0–1            | 0.18      | Small seeded timing offsets                                   |
| busyness          | 0–1            | 0.35      | Add ghost hits or thin normal hits relative to origin         |
| embellish         | 0–1            | 0.1       | Add motif neighbours/chord tones relative to origin           |
| density           | 0–1            | 0.55      | Keyboard voicing size                                         |
| register          | 0–1            | 0.45      | Keyboard pitch centre                                         |
| substitution      | 0–1            | 0         | Chance of dominant tritone substitution                       |
| rhythm            | 0–1            | 0         | Mid-bar chord rearticulation above 0.25                       |
| timbre            | 0–1            | 0         | Chord instrument: score below 0.35, felt, then pad above 0.72 |
| tone              | 0–1            | 0.48      | Master low-pass brightness                                    |
| saturation        | 0–1            | 0.25      | Soft tape drive                                               |
| wow               | 0–1            | 0.2       | Wow/flutter delay depth                                       |
| crush             | 0–1            | 0         | Optional bit-depth reduction (16 down to 5 bits)              |
| reverb            | 0–0.85         | 0.24      | Wet room/reverb level                                         |
| balance           | 0–1            | 0.5       | Bass versus melody emphasis                                   |
| arrangement       | 0–1            | 0         | Probability of resting chords/melody for a bar                |
| each texture name | 0–1            | see above | Texture level, also a drift dimension                         |

The bounded walk updates once per bar, with damped momentum and attraction to
the target. Discrete notes, patterns and instrument changes happen at bar
boundaries; filter, mix, effects and tempo glide. Background-tab throttling can
interrupt browser audio: the scheduler resumes at a safe future time rather than
playing a burst of late notes.

- **Wander** controls stochastic speed/spread. At zero, unsteered Drift stops
  moving. The file's `drift rate` sets its initial position.
- **Directions** are named offsets from home, clamped to permitted bounds:
  Darker, Brighter, Busier, Sparser, Looser, Tighter, Dreamier, Dustier.
  Clicking a direction turns Drift on; it never jumps directly to the
  destination.
- **Return home** removes randomness and eases all dimensions back. It also
  releases Hold. With a normal four-bar Pressing this takes about two loops.
- **Hold** freezes the dimensions, not the transport or every random note
  choice.
- Switching **Drift** off pauses wandering at the present state. Return home
  explicitly to restore the score.
- **Capture** generates one complete loop using the current dimensions and a
  copy of the current PRNG state. It writes explicit voicings, bass, motif,
  grids, current instruments, mix and textures into a new Pressing, with drift
  permissions removed. It is a quantised snapshot of the present musical
  character, not an audio recording or a transcript of the preceding loop.
  Subsequent playback does not need to recreate the original drift history.

The PRNG is a seeded 32-bit Mulberry-style generator. Score planning, timing and
sound/noise generation use separate derived streams. The seed is shown and
saved. The same seed, Pressing and **same bar-timed steering actions** reproduce
the compositional session. A seed alone cannot encode arbitrary user actions;
those actions are not recorded as a replay log. Browser/sample-rate differences
can still change the exact waveform. Play restarts at home; reload restores the
source and listener settings, not a running session.

## Files, shelf and Gists

- **Apply** validates the editor and queues a valid score for the next bar.
- **Export** downloads the editor text unchanged. Reimport restores the same
  notation (including comments). Canonical parse → serialise → parse preserves
  the musical score, but canonical serialisation normalises spacing/numbers and
  does not retain comments.
- **Upload** and drag/drop read a local file, with a 1 MB limit.
- **Your shelf** is a named in-browser library. Replacing a saved name asks for
  confirmation. The current editor and listener settings autosave separately.
  Every storage read/write is guarded. If storage fails or is full, the app
  remains usable; export to keep your work. An unfinished invalid draft also
  survives a reload when storage is available.
- **Gist import** accepts an ID or HTTPS `gist.github.com` URL. It selects a
  sole `.deadwax` file automatically, otherwise offers a file chooser (or loads
  a sole non-`.deadwax` file). `?gist=ID` automatically imports but does **not**
  start audio. Imports handle 404, 403/429 rate limits and timeouts. Truncated
  files are not fetched from raw URLs; download and upload those manually.
- Audio starts only with Play. Nothing is fetched for examples: their text is
  embedded in `index.html` and mirrored in `examples/`.

WAV rendering is not implemented; `.deadwax` is the lossless notation export.

## Included Pressings

| File                                                 | Mood                            | Tempo / meter |
| ---------------------------------------------------- | ------------------------------- | ------------- |
| [Window seat](examples/01-window-seat.deadwax)       | Late-night rain, minor ii–V     | 72 / 4/4      |
| [Sunday paper](examples/02-sunday-paper.deadwax)     | Warm felt keys, walking bass    | 86 / 4/4      |
| [The last table](examples/03-last-table.deadwax)     | Smoky, swung minor changes      | 80 / 4/4      |
| [Empty platform](examples/04-empty-platform.deadwax) | Sparse ambient pad, long chords | 60 / 4/4      |
| [Three cups left](examples/05-three-cups.deadwax)    | Vibraphone jazz waltz           | 78 / 3/4      |

Each is a complete format example with editable chords, grids and drift bounds.

## Tests

Run from the repository root (no dependencies):

```sh
node deadwax/test.cjs
```

Or open [tests.html](tests.html). The same assertions cover valid examples,
invalid input, source positions, chord decoding, stable canonical round-trips,
embedded/file parity (Node), seeded planning, captures, drift bounds, Hold and
Return home. The browser test page embeds the actual app but never starts audio.
