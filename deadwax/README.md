# Dead Wax

A small lo-fi jazz studio in the browser. Write a **Pressing**, a short loop in
plain text, then let it drift and bring it home. Every sound is synthesised on
the page: there are no samples, uploads, external fonts, libraries or analytics.
The only network request is the optional Gist import, to
`https://api.github.com/gists/{id}`.

**Open:** https://vibes.atenni.com/deadwax/

**Format:** [The Pressing format](format.html) describes the `.deadwax` file.

## Playing

- **Choose a record** from the title menu, or tap one on the Shelf. The title
  menu lists everything on your shelf.
- **Desk, Score and Shelf** are kept in the address (`?view=score`), so a
  refresh comes back to the same view.
- **Tap the turntable**, or press Space, to play or pause. The sticker on the
  record shows ▶ or ❚❚. Playback always loops.
- **Pause** stops like tape: the pitch sags and the sound fades. The playhead,
  Drift and Hold are kept, and Play carries on from the same point, even
  mid-bar.
- **Tap a bar** to jump to it at the next bar line. Tap the current bar to
  cancel the jump. While paused, tapping a bar moves the playhead there.
- **Mixer** faders and mute keys change the Pressing. Master volume is your own
  setting and isn't saved in it.
- **Room** knobs set the surface textures, and show their live values while
  drifting.

On iOS, Dead Wax asks for media playback, so the Silent switch doesn't mute it.
Media volume and the selected audio output still apply.

## Drift

Drift slowly moves the music away from how it's written, within the bounds the
Pressing allows, then brings it back.

- **Drift** switches wandering on or off. Off keeps the music where it has got
  to; use Return home to go back.
- **Wander** sets how far and how fast it roams. At zero, it stays put.
- **Directions** (Darker, Brighter, Busier, Sparser, Looser, Tighter, Dreamier,
  Dustier) steer it gradually towards a mood. Select the active one again to
  wander freely.
- **Hold** freezes the music where it is; the loop keeps playing.
- **Return home** eases everything back to the written Pressing, which takes
  about two loops. While paused, it resets straight away.
- **Cut a take** saves the music as it sounds right now as a new Pressing,
  `<title> · take N`, with Drift off. The original stays on your shelf. A take
  is written notes, not an audio recording.

Changes happen at bar lines, so nothing jumps mid-phrase. The **seed**, next to
Apply in the Score view, makes Drift repeatable: the same seed, Pressing and
steering at the same bars give the same music.

## Score and shelf

- **Score** is the text editor. **Apply** checks the Pressing and swaps it in at
  the next bar. Errors point to the line and column, and invalid text never
  replaces what's playing.
- **Export** downloads the text exactly as written, including comments. Dead Wax
  only exports `.deadwax` text, never audio.
- **Bring a record in** by dropping a `.deadwax` file anywhere (up to 1 MB),
  choosing a file, or pasting a GitHub Gist URL or ID. Linking to `?gist=ID`
  imports it without starting playback.
- **The shelf** keeps named Pressings in this browser as record sleeves, each
  with its own colour. Tap a sleeve's record to play it (or pause it, if it's
  already playing); Rename, Duplicate, Export and Delete sit beside it. Your
  draft and settings are saved too. If the browser won't save, everything still
  works; export to keep your work.
- An **Edited** tag means the record has changed since you put it on.
  **Unsaved** means it isn't on your shelf, for example a file, Gist or New
  Pressing.

## House records

These five records are put on your shelf the first time Dead Wax opens. They're
ordinary shelf entries, so rename, edit or delete them freely. **Put the house
records back**, on the Shelf, restores any that are missing.

| Record                                                | Mood                                         | Tempo / length |
| ----------------------------------------------------- | -------------------------------------------- | -------------- |
| [Bus window, 7:40 am](examples/01-bus-window.deadwax) | Boom-bap head nod, Rhodes, written bass line | 88 / 4 bars    |
| [Rewind](examples/02-rewind.deadwax)                  | Cassette loop, bell call and answer, rain    | 72 / 4 bars    |
| [Corner store neon](examples/03-corner-store.deadwax) | Bouncy dorian vamp that opens up halfway     | 110 / 8 bars   |
| [Rain on a tin roof](examples/04-tin-roof.deadwax)    | Slow pads, heavy rain, a minute-long loop    | 64 / 16 bars   |
| [Spin cycle](examples/05-spin-cycle.deadwax)          | Crushed, drunk sample chop with a flip       | 80 / 4 bars    |

All are in 4/4, and each is a complete example of the format.

## Keyboard shortcuts

| Key          | Action                 |
| ------------ | ---------------------- |
| Space        | Play or pause          |
| D            | Drift on or off        |
| 1–8          | Directions             |
| [ and ]      | Wander down or up      |
| H            | Return home            |
| K            | Hold                   |
| C            | Cut a take             |
| N            | New Pressing           |
| P, E, L      | Desk, Score, Shelf     |
| Ctrl/⌘+Enter | Apply, from the editor |
| ?            | Show all keys          |

Shortcuts are ignored while typing. Space on a focused control presses that
control instead.

## Local development

Plain static files with no build step. Serve the folder over HTTP, because
JavaScript modules don't load from `file:` URLs.

| File                | Contents                                               |
| ------------------- | ------------------------------------------------------ |
| `index.html`        | Markup                                                 |
| `format.html`       | The Pressing format reference (static, no scripts)     |
| `tokens.css`        | Design tokens                                          |
| `components.css`    | Component styles                                       |
| `core.mjs`          | Parser, serialiser, seeded planner and Drift; no DOM   |
| `audio.mjs`         | `AudioRack`: every synthesised source and effect       |
| `transport.mjs`     | `Transport`: lookahead scheduling, pause, seek and cue |
| `house-records.mjs` | The house record list and loader for `examples/`       |
| `app.mjs`           | UI wiring, storage, shelf, editor and Gist import      |

Implementation notes:

- The seeded generator is 32-bit Mulberry-style, with separate streams for
  planning, timing and sound. Browser and sample-rate differences can still
  change the exact waveform.
- When a background tab is throttled, the scheduler resumes at a safe future
  time rather than playing a burst of late notes.
- The canonical serialiser (used by Cut a take) normalises spacing and numbers
  and drops comments. Parse → serialise → parse keeps the musical score.

## Tests

From the repository root, with no dependencies:

```sh
node --test deadwax/
```

Or open [tests.html](tests.html) for the parser and planner tests in a browser;
it never starts audio.

- **Core:** valid and invalid input, error positions, chord decoding, canonical
  round-trips, seeded planning, takes, drift bounds, Hold and Return home.
- **House records:** every file in `examples/` is listed and valid.
- **Audio:** the rack requests iOS media playback before opening its context,
  with fallbacks when the Audio Session API is missing or refuses.
- **Transport:** a silent rack and fixed clock cover mid-bar resume, scheduling
  rollback, generator state, seeking, cue cancellation, looping, interruption
  and quick pause/resume clean-up.
- **Format page:** the complete example in `format.html` parses, and every
  dimension and texture is documented.
