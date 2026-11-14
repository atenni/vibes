# Dead Wax components: developer handoff

Direction **C, "After hours"**: a dark console with VU meters, amber lamps and
matte hardware.

- **Dark theme only.** There is no light theme and no `prefers-color-scheme`
  switch. Set `color-scheme: dark` and
  `<meta name="theme-color" content="#0c1011">`.
- **System fonts only.** There are no network requests and the CSP is unchanged.
  The 60s/70s character comes from Futura and Avenir Next Condensed on Apple
  devices, with Bahnschrift, Century Gothic and Roboto Condensed elsewhere.
  Everything still reads well with plain `system-ui`.
- **Export is `.deadwax` text only.** Don't add WAV or audio-render controls.
- **Loops of 1–64 bars** are supported, with no 16-bar cap, laid out in musical
  rows of 4 or 8 bars. See
  [Position display](#position-display-bars-clock-status).
- **Loop is the only mode.** There is one **Play/Pause** key; Stop, the Loop
  toggle and the run-out groove are removed from the UI. See
  [Transport changes](#transport-changes-play-pause-only).
- **Safari and iOS are first-class targets.** iOS is the primary device. The
  layout was checked in WebKit (desktop and iPhone emulation).

## Integration (read first)

- **`design/` never goes into `feat/deadwax-poc` or `main`.** GitHub Pages
  publishes `main` from the repository root, so this folder would become a
  public page. `style/initial-design` is a reference-only branch and is never
  merged.
- **Port, don't copy:** the deliverable is the CSS and markup inside
  `deadwax/index.html`. The CSP (`style-src 'unsafe-inline'`) blocks external
  stylesheets, so inlining is required anyway. Read files without checking them
  out, for example `git show style/initial-design:design/components.css`.
- **Fence the pasted CSS** in the inline `<style>`, so later updates can replace
  whole blocks:
  `/* ==== design: tokens.css @ <commit> ==== */ … /* ==== end tokens.css ==== */`,
  and the same for `components.css`. Each design update then comes with a commit
  ID: replace the fenced blocks with that commit's files, and apply the markup
  and wiring changes listed in the message. `git diff <old>..<new> -- design/`
  shows exactly what changed.

## Files

| File                    | What it is                                                           | Copy into `index.html`?             |
| ----------------------- | -------------------------------------------------------------------- | ----------------------------------- |
| `design/tokens.css`     | Colours, type, space, radii, depth and motion as custom properties   | Yes: first, in the inline `<style>` |
| `design/components.css` | Every component class                                                | Yes: after the tokens               |
| `design/prototype.html` | A clickable prototype with fake data. Markup is the source of truth. | Copy the markup, **not** its script |
| `design/DIRECTIONS.md`  | The step-1 proposals (historical)                                    | No                                  |
| `design/mockups/`       | Rough step-1 mockups, **not** for production.                        | No                                  |

Paste `tokens.css` and then `components.css` into the single inline `<style>`.
Neither file uses `@import` or external URLs; the only `url()`s are inline
`data:` SVGs, which the existing CSP (`img-src data:`) allows.

The prototype's `<script>` is throwaway simulation code. Its helpers
(`deviation()`, `distance()`, keyboard handling, the editor tint) are written to
be lifted, but the engine wiring in `deadwax-ui` remains yours.

**Browser features used:** `:has()`, `color-mix()`, `@property`, container
queries, vertical `writing-mode` on range inputs and `<dialog>`. All are
supported in current Safari (iOS 17 and later), Chrome and Firefox.

**Safari pitfall (already handled):** don't use `<fieldset>` as a grid or flex
container. WebKit collapses the children to almost zero width, and an earlier
version of this design lost every meter that way. Groups are
`<div role="group" aria-labelledby="…">` instead.

## ID compatibility

All POC control IDs keep their meaning, except `#library`/`#load` and the
removed `#stop` and `#repeat`. The script IDs (`deadwax-core`,
`deadwax-examples`, `deadwax-audio` and `deadwax-ui`) are untouched; the
prototype simply doesn't include those scripts.

| POC ID                                                                      | New markup                                                      | Change for the UI script                                                                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `play`                                                                      | One Play/Pause key                                              | Toggles; never disabled while a Pressing is loaded. See [Transport changes](#transport-changes-play-pause-only).        |
| `stop` `repeat`                                                             | **Removed**                                                     | Remove the bindings. Treat `settings.repeat` as always `true`.                                                          |
| `volume` `seed` `examples` `title` `clock` `status`                         | Same element types                                              | None. Also set `body[data-audio]` (see [Global state hooks](#global-state-hooks)).                                      |
| `bars`                                                                      | `<ol class="bars">` of `<li class="bar">`                       | Build `li.bar` children (see [Position display](#position-display-bars-clock-status)). Use `.is-active`, not `.active`. |
| `drift`                                                                     | Checkbox with `role="switch"` inside `.toggle`                  | None                                                                                                                    |
| `wander` `wander-value`                                                     | Range inside a `.knob`                                          | Set `--v` on the `.knob` (see [Knob](#knob-knob)).                                                                      |
| `directions`                                                                | Static markup: four `.rocker` pairs with `data-direction`       | **Don't generate the buttons.** Bind clicks on `[data-direction]`.                                                      |
| `home` `hold` `capture`                                                     | `.key` buttons                                                  | None (Hold already uses `aria-pressed`)                                                                                 |
| `dimensions`                                                                | `.bridge` of grouped `.vu` meters, IDs `dim-<name>`             | Replace the track markup (see [VU meter](#vu-meter-vu)).                                                                |
| `mutes`                                                                     | `.strips`, holding static channel strips                        | **Don't generate.** `mute-<part>` IDs are kept. New `level-<part>` faders are an engine feature to add.                 |
| `textures`, `texture-<k>`, `texture-value-<k>`                              | Static `.knob--sm` knobs                                        | **Don't generate.** Same IDs; set `--v`.                                                                                |
| `editor` `errors` `apply` `download`                                        | Inside `.editor` and `.score`                                   | Error buttons get `class="error"` and two spans; add tinting (optional).                                                |
| `upload` `file` `gist` `import-gist` `gist-files` `gist-choice` `gist-load` | Inside `.import` and `.gist`                                    | Set `#gist-panel[data-state]` and `#gist-message`.                                                                      |
| `save-name` `save`                                                          | Inside `form#save-form`                                         | Bind `submit` (or keep `#save` click and `preventDefault`).                                                             |
| `library` + `load`                                                          | `#library` is now a `<ul class="sleeves">`; **`#load` is gone** | Render `.sleeve` items. Each one's Load button replaces `#load`.                                                        |
| `storage-status`                                                            | `<p class="notice">`, hidden when empty                         | None. It hides itself via `:empty`.                                                                                     |
| `drift-status`                                                              | `<p class="drift__status">`                                     | None                                                                                                                    |

New IDs: `new` (New Pressing), `power-text`, `meta-tempo`, `meta-key`,
`meta-meter`, `meta-bars`, `bars-legend`, `loopmap`, `distance`,
`distance-value`, `level-<part>`, `level-value-<part>`, `volume-value`,
`editor-frame`, `editor-tint`, `editor-gutter`, `editor-chip`, `gist-panel`,
`gist-message`, `shelf-count`, `shelf-empty`, `save-form`, `dropzone`,
`shortcuts` and `shortcuts-open`.

## Features the engine doesn't have yet

These are designed and shown in the prototype, but need engine or UI support.
Each one degrades cleanly if you postpone it.

1. **Per-part level faders** (`#level-chords`, `#level-bass`, `#level-drums` and
   `#level-melody`). The Pressing format already has `level <part>`; the UI
   needs to patch that directive the way texture knobs do. If you postpone this,
   render the strips without the fader and keep the mute button.
2. **Library rename, duplicate, delete and per-item export.** These are plain
   localStorage operations on `deadwax.library.v1`.
3. **Locked meters.** Dimensions with no `drift` bound get `.is-locked`. This is
   UI-only; the data is already in `song.drift.limits`.
4. **Distance from home** (`#distance`), computed in the UI from the current,
   origin and limit values. A formula is given below.
5. **Keyboard shortcuts** and the `?` dialog. UI-only.
6. **Pause that keeps the drift** (rather than Stop resetting it). See
   [Transport changes](#transport-changes-play-pause-only).
7. **New Pressing** (`#new`): loads a starter template into the Score view. It
   isn't saved until the listener saves it.
8. **The view switcher** (Desk, Score and Shelf). UI-only.

## Global state hooks

Set these on `<body>`. The CSS does the rest.

| Attribute             | Values                     | Set when                                                                                            |
| --------------------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| `data-audio`          | `off` · `on`               | `off` initially and while paused. `on` after `transport.start()` resolves.                          |
| `data-view`           | `desk` · `score` · `shelf` | View switcher. Default `desk`.                                                                      |
| `data-first-run`      | present or absent          | Present until the first successful Play. It makes Play "breathe" and shows the click-to-start note. |
| `data-pressing`       | `none` or absent           | No valid Pressing to play. This is rare, because the POC always falls back to an example.           |
| `class="is-dragging"` | present or absent          | A file is dragged over the window (replaces the POC's `body.drop`).                                 |

`data-audio` drives `--lamp`, a registered custom property that animates from 0
to 1. Lamps, meter-face backlight and needle colour all follow it. The lamps
**warm up over 1.2 seconds** on Play, matching the needle drop. They **fade over
2.6 seconds** on Pause, matching the tape stop. Paused needles **hold their
position**, because the drift is kept. `prefers-reduced-motion` sets every
duration to 0.

Replace `document.body.classList.add("playing")` with
`document.body.dataset.audio = "on"`.

## Page shell

```html
<body data-view="desk" data-audio="off" data-first-run>
  <a class="skip-link" href="#main">Skip to the controls</a>
  <div class="page">
    <header class="masthead">
      <a class="wordmark">…inline SVG…</a>
      <nav class="tabs" aria-label="Views">
        <button class="tab" data-view="desk" aria-current="page">Desk</button>
        …
      </nav>
      <div class="masthead__end">
        <span class="power legend"
          ><span class="lamp"></span><span id="power-text">Standby</span></span
        >
        <button class="icon-btn" id="shortcuts-open">?</button>
      </div>
    </header>
    <p id="storage-status" class="notice" role="status"></p>
    <main id="main" class="views">
      <div class="view view--desk">…</div>
      <div class="view view--score">…</div>
      <div class="view view--shelf">…</div>
    </main>
    <footer class="foot">…</footer>
  </div>
  <div class="drop-veil" aria-hidden="true">…</div>
  <dialog id="shortcuts" class="sheet">…</dialog>
</body>
```

- **Views:** only one `.view` shows at a time. At **1440px and wider**, Score
  shows the Desk **beside** the editor, so musicians can edit while watching the
  meters. Switching view should update `aria-current` on the tab. The POC's
  `showErrors()` opened `<details>`; replace that with `setView("score")`.
- **`#power-text`:** "Standby" (before the first Play), "On air" or "Paused".
  It's the text twin of the lamp, so state never relies on colour.
- **Wordmark and favicon:** both are inline SVG in `prototype.html`. The
  wordmark draws its letters as strokes, so it needs no font; the "D" is a VU
  arc with an amber needle. The favicon is the same meter on a rounded square.
  Its `data:` URI replaces the POC's favicon.

## Transport rack

```html
<section class="rack transport">
  <div class="transport__keys">
    <button
      id="play"
      class="key key--transport key--play"
      aria-keyshortcuts="Space"
    >
      <span class="lamp"></span>
      <svg class="icon-play" />
      <svg class="icon-pause" />
      <span class="when-off">Play</span><span class="when-on">Pause</span>
    </button>
  </div>
  <div class="transport__record">
    <select id="examples" class="select select--compact">
      …
    </select>
    <h1 id="title" class="title">…</h1>
    <dl class="meta">
      …
      <dd id="meta-tempo">…<input id="seed" class="inline-input" /></dd>
    </dl>
  </div>
  <div class="transport__display display">…</div>
</section>
```

- **Play/Pause** swaps its icon and label from `body[data-audio]` in CSS, so the
  script only sets `data-audio`. Its accessible name is its visible text ("Play"
  or "Pause"). Don't add `aria-pressed` as well, because the label already
  changes.
- **Seed** is an inline number input styled as a display value. It shows a
  dashed underline when editable, none when disabled (playing), and a red
  underline when `:invalid`.
- **Meta:** fill `#meta-tempo` (the written tempo; the live tempo is in
  `#clock`), `#meta-key` (`song.key`), `#meta-meter` and `#meta-bars`.

### Transport changes (Play/Pause only)

Loop is the only mode, so the UI has one key.

| Action                   | Behaviour                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| First Play               | Needle drop. A fresh session at home, as now.                                                                                                                                                    |
| Pause                    | Tape stop (the existing stop effect). **The playhead, drift state, hold and direction are kept.** `#clock` shows "Paused · bar 3/8". The seed is editable again.                                 |
| Play (resume)            | Needle drop. Resume **from the playhead**, mid-bar if that's where it paused, with the drift state carried over.                                                                                 |
| Tap a bar                | While playing: **cue** it; it starts at the next bar line. Tapping another bar re-cues; tapping the current bar cancels the cue. While paused: move the playhead there; Play starts at that bar. |
| Return home              | While playing, eases home as now. **While paused, it snaps home at once, and the next Play is a fresh session.**                                                                                 |
| Seed or Pressing changes | The next Play is fresh.                                                                                                                                                                          |

Engine changes:

- **Pause keeps state.** On pause, keep `transport.drift` (or copy it out)
  instead of discarding it, and seed the next transport from it. Keep the PRNG
  state too, so the session stays reproducible.
- **Seekable start.** `start({ bar, offset })`, where `offset` is the 0–1
  fraction of the bar. The planner already works bar by bar, so plan the bar
  from its start and schedule only the events at or after the offset. Notes that
  started before the offset can be dropped; the needle drop covers the seam.
- **Cue (`jumpTo(bar)`) while playing.** Store the cued bar; when the scheduler
  plans the next bar, plan the cued bar instead of `bar + 1`, then clear the
  cue. No mid-bar seeking is needed for this. The drift step runs as normal. A
  jump doesn't count as a new loop; wrapping past the last bar does. Mind the
  scheduler's look-ahead: if the next bar is already planned, either re-plan it
  or let the cue apply one bar later (and keep "◂ next" lit until it does).
- **UI state:** keep `bar` and the bar's start time (`ctx.currentTime` at beat
  1), so the UI can work out the sweep fraction (`--from`) on pause and resume.
- Remove the run-out callback from the UI. The run-out _sound_ can stay in the
  engine, unused.

### Position display (`#bars`, `#clock`, `#status`)

```html
<div class="loopmap" id="loopmap" aria-hidden="true"><i></i>… one per bar</div>
<ol id="bars" class="bars" data-row="4" aria-label="Chords in the loop">
  <li class="bar is-active">
    <button
      type="button"
      class="bar__btn"
      data-bar="1"
      tabindex="0"
      aria-current="true"
      aria-label="Bar 2, G7alt"
    >
      <span class="bar__n">2</span>
      <span class="bar__chord"><span>G7alt</span></span>
      <span class="bar__sweep" style="--from: 0"></span>
    </button>
  </li>
</ol>
```

- **Musical rows.** Bars sit in rows of **4**. When the loop length is a
  multiple of 8 **and** the display is at least 620px wide, rows hold **8**,
  with a wider gap between the two halves. The width check is a container query
  on `.display`, not a media query. Loops shorter than 4 bars use one row of
  that length. Set these attributes from `song.bars`:
  - `data-row="1|2|3"` when the loop is shorter than 4 bars (omit or use `4`
    otherwise)
  - `data-eight` when `bars % 8 === 0`
  - `data-long` when `bars > 8` Loops that aren't a multiple of 4 (for example 6
    bars) still use rows of 4, with a short last row. That's the honest picture.
- **Tap to jump.** Each bar is a `<button class="bar__btn" data-bar="i">`. Bind
  one delegated `click` on `#bars`. The cued bar gets `.is-cued`, which is
  hatched and labelled "◂ next", until it starts.
- **Keyboard:** the bars are **one tab stop**, using a roving `tabindex`. Arrow
  keys move by one bar or one row, and Home/End go to the first or last bar.
  Enter or Space jumps. The global Space shortcut ignores focused buttons, so
  Space on a bar jumps rather than pausing.
- **Sweep position.** Set `--from` (a 0–1 fraction) on the active bar's
  `.bar__sweep` when resuming or pausing mid-bar. While playing, the sweep
  animates from `--from` to the end of the bar. While paused, it holds there.
- **Scrolling.** The list shows two rows, which is 8 or 16 bars. Longer loops
  scroll inside it. When the active bar leaves the window, scroll it into view
  with `box.scrollTo({ top: … })`. Don't use `scrollIntoView`, which also
  scrolls the page. The prototype's `setActive()` shows how.
- **Loop map.** With `data-long`, `.loopmap` appears automatically (CSS `:has`).
  Add one `<i>` per bar, and set `.is-active` on the current bar and `.is-past`
  on earlier ones. Segments are grouped in fours by spacing. It's decorative;
  `#clock` carries the same information as text.
- **Desktop width.** Without Stop and Loop, the display takes about two-thirds
  of the transport rack at 1080px and wider.
- **Several chords in a bar:** separate them with
  `<span class="sep" aria-hidden="true">/</span>`. For a chord **held over**
  from the previous bar, use `<span class="is-held">`, which shows "↦ Fmaj7" in
  muted text. That's more honest than repeating the symbol.
- **Chord symbols:** the prototype's `pretty()` turns `b` and `#` into `♭` and
  `♯` for display only.
- **Sweep:** on every bar callback, set `--bar-dur` on `#bars` to
  `60 / tempo × song.beats` seconds and `--beats` to `song.beats`. Then restart
  the sweep animation on the active cell (toggle `display`, as in the
  prototype). The sweep shows beat divisions and fills in time with the bar. The
  bar callback runs at schedule time, not audible time. If that looks early,
  delay the visual update by `(eventTime - ctx.currentTime) * 1000` ms.
- **`#clock`** is an `<output>`, so screen readers can read it on demand. It
  isn't announced live, which would be chatty every bar. Keep the POC text:
  "72.0 BPM · bar 2/4 · loop 3".
- **`#status`** stays `role="status"`. The `›` prompt is decorative CSS.
- **First run:** `.first-run` shows while `body[data-first-run]` is set.
- **Empty:** `.display__empty` shows while `body[data-pressing="none"]` is set.

## Keys (`.key`)

Variants are `.key--primary` (amber; one per view at most), `.key--quiet`,
`.key--danger`, `.key--transport` and `.key--play`. The minimum height is 44px.

- **Pressed:** `aria-pressed="true"` sinks the key by 1px and darkens it.
- A `<span class="lamp">` inside a key lights when the key is
  `aria-pressed="true"`. That's how **Hold** and the **direction rockers** show
  they're engaged: a lamp plus a sunk key, so state never relies on colour.
- **Disabled** keys get a dashed border, so they're distinguishable without
  colour.

## Knob (`.knob`)

```html
<div class="knob knob--lg" style="--v: 0.35">
  <div class="knob__dial" aria-hidden="true"></div>
  <span class="knob__cap" aria-hidden="true"></span>
  <input
    id="wander"
    class="knob__input"
    type="range"
    min="0"
    max="1"
    step="0.01"
  />
  <label class="knob__name legend" for="wander">Wander</label>
  <output id="wander-value" class="knob__value" for="wander">35%</output>
</div>
```

- A transparent native range input sits over the dial. Arrow keys, Page Up/Down,
  Home/End, screen readers and touch all work with no JS.
- **JS:** on `input`, set `knob.style.setProperty("--v", normalised)`, where
  `normalised` is `(value − min) / (max − min)`. Do the same when restoring
  settings (`renderSong()`).
- **Optional drag enhancement** (in the prototype): on `pointerdown`, capture
  the pointer and map upward or rightward movement to value, 180px per full
  range. This avoids a horizontal slider's "jump to click" on a round control.
  Dispatch `input` events so your existing handlers run.
- Sizes are `.knob--lg` (Wander), the default, and `.knob--sm` (textures).

## Fader (`.fader`) and mixer strips

```html
<div id="mutes" class="strips">
  <div class="strip" role="group" aria-labelledby="strip-chords">
    <span id="strip-chords" class="legend">Keys</span>
    <input
      id="level-chords"
      class="fader"
      type="range"
      min="0"
      max="1"
      step="0.01"
      aria-label="Keys level"
    />
    <output id="level-value-chords" class="strip__value" for="level-chords"
      >70</output
    >
    <button
      id="mute-chords"
      class="mute"
      aria-pressed="false"
      aria-label="Mute keys"
    >
      Mute
    </button>
  </div>
  … bass, drums, melody, then .strip--master holding #volume and #volume-value
</div>
```

- A vertical native range (`writing-mode: vertical-lr; direction: rtl`), so up
  means louder.
- **Muted** (`aria-pressed="true"`): the button turns amber, and the fader and
  value dim with "· muted" appended, so the state is shown by colour, opacity
  and text.
- The part is called **Keys** in the UI but stays `chords` in IDs and the
  format.

## Drift rack

```html
<section class="rack drift">
  <div class="rack__head">
    <h2 class="rack__title">Drift</h2>
    <label class="toggle"
      ><input id="drift" type="checkbox" role="switch" />…</label
    >
    <p id="drift-status" class="drift__status" aria-live="polite">…</p>
  </div>
  <div class="drift__console">
    <div class="drift__steer">
      <div id="directions" class="rockers">
        <div class="rocker" role="group" aria-labelledby="rocker-colour">
          <span class="rocker__name legend" id="rocker-colour">Colour</span>
          <div class="rocker__body">
            <button
              class="rocker__side"
              data-direction="Darker"
              aria-pressed="false"
            >
              <span class="lamp"></span>Darker
            </button>
            <button
              class="rocker__side"
              data-direction="Brighter"
              aria-pressed="false"
            >
              …
            </button>
          </div>
        </div>
        … Activity (Busier/Sparser), Feel (Looser/Tighter), Atmosphere
        (Dreamier/Dustier)
      </div>
      <div class="drift__actions">#home · #hold · #capture</div>
    </div>
    <div class="drift__gauge-col">
      <figure id="distance" class="vu vu--gauge" role="meter">…</figure>
      <div class="drift__wander">…#wander knob…</div>
    </div>
  </div>
  <div id="dimensions" class="bridge">…</div>
</section>
```

- **Directions** are four opposed **rockers**, because the eight names form four
  natural pairs. The `data-direction` value is the exact `DW.directions` key.
  When adding directions later, add a rocker or a single-sided one.
- **Clicking the active direction again** returns to free wandering. This is new
  and optional; the POC always re-steers.
- **Drift off:** the bridge and gauge dim slightly via
  `.drift:has(#drift:not(:checked))`. No JS is needed.

### VU meter (`.vu`)

This is the signature visual: a meter bridge with one centre-zero meter per
dimension, grouped as on a console.

```html
<div
  class="vu"
  id="dim-tone"
  role="meter"
  aria-label="Tone"
  aria-valuemin="-100"
  aria-valuemax="100"
  aria-valuenow="-35"
  aria-valuetext="35% of the way to its lower limit"
  style="--d: -0.35"
>
  <div class="vu__face" aria-hidden="true">
    <span class="vu__needle"></span><span class="vu__peak"></span>
  </div>
  <div class="vu__legend" aria-hidden="true">
    <span class="vu__name legend">Tone</span><span class="vu__value">−12</span>
  </div>
</div>
```

**Groups**
(`<div class="bridge__group" role="group" aria-labelledby="group-time"><span class="bridge__name legend" id="group-time">Time</span><div class="bridge__meters">…</div></div>`):

| Group   | Dimensions                                    |
| ------- | --------------------------------------------- |
| Time    | tempo, swing, humanise                        |
| Groove  | busyness, embellish, rhythm, arrangement      |
| Harmony | density, register, substitution, timbre       |
| Sound   | tone, saturation, wow, crush, reverb, balance |
| Surface | vinyl, surface, tape, rumble, rain, room, hum |

Short labels: busyness → "Busy", embellish → "Embellish", arrangement →
"Arrange", substitution → "Subst.", saturation → "Drive", vinyl → "Crackle",
tape → "Hiss", room → "Room". New dimensions should go in the closest group.

**Needle value, `--d` (−1 to 1).** Normalise to the **permitted drift range**,
not the absolute range. That way every dimension can visibly reach its stop, and
the meter answers "how far could this go?":

```js
function deviation(current, origin, [lo, hi]) {
  if (current >= origin)
    return hi > origin ? (current - origin) / (hi - origin) : 0;
  return origin > lo ? (current - origin) / (origin - lo) : 0;
}
```

- **States**
  - **At rest:** the needle points straight up, at the green home tick.
  - **`.is-limit`** (when `|d| > 0.97`): the peak lamp lights and the value
    turns bold amber.
  - **`.is-locked`:** no `drift` bound in the Pressing. The face is hatched and
    dimmed, the needle stays fixed and the value reads "fixed". Set
    `aria-valuetext="Fixed at home"`.
  - **Paused** (`data-audio="off"`): needles hold their position and lose their
    backlight. After Return home while paused, set every `--d` to 0, and the
    needles ease home.
- **`.vu__value`:** a signed delta from home. Tempo is in BPM (`+6`); other
  dimensions are the delta as a percentage of the absolute range (`−12`). Use a
  real minus sign, `−`.
- **Screen readers:** the visual pieces are `aria-hidden`. The `role="meter"`
  host carries `aria-valuenow` (`round(d × 100)`) and a sentence in
  `aria-valuetext`. Examples are "At home", "64 BPM, 8 slower than home", or
  "35% of the way to its lower limit".
- **Motion:** the needle has `transition: transform var(--t-needle)` (1.8
  seconds, damped). Update it **once per bar**, from the existing bar callback.
  Don't update from `requestAnimationFrame`, because the CSS easing provides the
  needle swing. With reduced motion, the needle jumps.

### Distance gauge (`#distance.vu--gauge`)

This is a one-sided meter showing overall distance from home. `--d` runs from 0
(home, on the left) to 1 (far). The RMS of all unlocked deviations works well:

```js
const ds = unlocked.map((k) => deviation(cur[k], origin[k], limits[k]));
const distance = Math.sqrt(ds.reduce((n, d) => n + d * d, 0) / ds.length);
```

Set `--d`, `aria-valuenow` (0–100), `aria-valuetext` ("At home" or "31% from
home") and `#distance-value`. The red zone starts at 75%. It's a cue, not a
warning.

## Textures rack ("Room")

`#textures` holds seven `.knob--sm` knobs with the existing IDs. The names are
Crackle (vinyl), Surface, Tape hiss, Rumble, Rain, Room tone and Hum. Values can
drift, so when drift moves a texture, update its knob's `--v` and `<output>` at
the same time as the meters. The knob then turns by itself, slowly, which is a
nice touch.

## Toggle (`.toggle`)

```html
<label class="toggle">
  <input id="drift" type="checkbox" role="switch" />
  <span class="sr-only">Drift</span>
  <span class="toggle__track" aria-hidden="true"
    ><span class="toggle__lever"></span
  ></span>
  <span class="toggle__text" aria-hidden="true"></span>
</label>
```

The lever position and "On"/"Off" text are drawn by CSS from `:checked`.

## Score view (editor)

```html
<section class="rack score">
  <div class="rack__head">
    … <span id="editor-chip" class="chip">✓ Valid</span> …
  </div>
  <div class="editor" id="editor-frame">
    <div class="editor__gutter" aria-hidden="true">
      <div class="editor__gutter-inner" id="editor-gutter"></div>
    </div>
    <div class="editor__surface">
      <pre class="editor__tint" id="editor-tint" aria-hidden="true"></pre>
      <textarea
        id="editor"
        class="editor__input"
        wrap="off"
        spellcheck="false"
        aria-describedby="errors"
      ></textarea>
    </div>
  </div>
  <div id="errors" class="errors" aria-live="polite"></div>
  <div class="score__bar">#apply.key--primary · #download.key</div>
</section>
```

- **Tinting (cheap, optional):** a `<pre>` behind a transparent-text
  `<textarea>`. On `input` and on parse, rebuild the tint HTML line by line. On
  `scroll`, translate the tint and gutter. Add `.is-tinted` to `.editor` **only
  once the tint has rendered**. Until then, the textarea shows its own text, so
  a JS failure never hides content. The `editor__tint` and `editor__input` font,
  padding, `tab-size` and `white-space` must match exactly; the CSS handles
  that.
  - Classes: `t-kw` (directive), `t-name` (part, texture or dimension name),
    `t-num`, `t-dur` (`:4`), `t-rest` (`-` and `.`), `t-hit` (`x` and `X`),
    `t-ghost` (`g`) and `t-comment`.
  - Errors: wrap the line in `t-line-error` and the token in `t-error`, which
    gets a wavy underline.
  - `tintLine()` in the prototype is a good starting point. Feed it the real
    `DW.parse().errors`, not the fake diagnostics.
  - Rebuilding on each keystroke is fine for files of a few hundred lines. If
    that's ever slow, debounce the tint as well.
- **Gutter:** line numbers, with error lines shown as `! 12` in bold red, so
  they don't rely on colour alone.
- **`#errors`:** one `<button class="error">` per diagnostic:
  `<span class="error__pos">Line 3, col 7</span><span>message</span>`. Clicking
  selects the token. Select the token's length when known, otherwise one
  character, as now.
- **`#editor-chip`:** "✓ Valid", or "✕ 3 problems" with `.chip--error`.
- **Apply:** use **Ctrl/⌘+Enter** inside the editor. If Apply fails, move focus
  to the first `.error`.

## Shelf view

### Library (`#library.sleeves`)

```html
<li class="sleeve is-current" style="--hue: 212">
  <span class="sleeve__spine" aria-hidden="true"></span>
  <div class="sleeve__body">
    <h3 class="sleeve__title">Name</h3>
    <p class="sleeve__meta">72 BPM · C minor · 4/4 · 4 bars · saved 12 Nov</p>
  </div>
  <div class="sleeve__actions" role="group" aria-label="Name">
    <button class="key key--quiet" data-action="load">Load</button>
    … rename · duplicate · export ·
    <button class="key key--quiet key--danger" data-action="delete">
      Delete
    </button>
  </div>
</li>
```

- **`--hue`** is a stable hash of the name, giving each spine its own colour.
  It's decorative only.
- **`.is-current`:** this sleeve matches the loaded text, and it's labelled "On
  the platter" in text.
- **Rename** and **Delete** are confirmed **inline**: hide `.sleeve__actions`
  and append `.sleeve__rename` (a form) or `.sleeve__confirm` (with
  `role="alert"`). This avoids `confirm()` dialogs. Keep `confirm()` for
  "replace unapplied editor changes?" if you like, or reuse this pattern later.
  Handle focus: after rename, return focus to the Rename button; after delete,
  move it to the next sleeve.
- **Meta:** tempo, key, meter, bars and provenance (saved, captured or from
  Gist, plus a date). The current storage holds name → text only, so either
  parse each on render (cheap) or store `{ text, savedAt, source }`.
- **Empty:** `#shelf-empty` shows when there are no items; hide `#library`.
- **Capture never overwrites.** It creates a **new** Pressing named "<title> ·
  take N", saves it to the shelf, marks it `.is-current` and puts it on the
  platter. The captured state becomes the new home, with Drift off. The original
  is untouched on the shelf, or in the examples. The POC currently replaces the
  editor text, after a confirm if there are unapplied edits; saving to the shelf
  removes the risk of losing work. If storage is unavailable, keep it in memory
  and say so in `#status`.
- **New Pressing** (`#new`, shortcut N) puts a minimal, valid starter template
  in the Score view (see `TEMPLATE` in the prototype) and focuses the editor
  with the title selected. Nothing is saved until the listener saves it. If the
  editor has unapplied changes, confirm first, as `mayReplace()` does now.

### Import

- **`.dropzone`** has a "Choose a file…" button (`#upload`, which clicks the
  hidden `#file`). The whole window remains a drop target: set
  `body.is-dragging` on `dragenter` and remove it on `dragleave`, using a depth
  counter so child elements don't cause flicker. Clear it on `drop`. The
  `.drop-veil` overlay then appears, reading "Drop the needle…".
- **Gist states:** set `#gist-panel[data-state]` and the text of
  `#gist-message`.

| State     | When                        | Message pattern                                                                                                            |
| --------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `idle`    | Initially                   | (message hidden)                                                                                                           |
| `loading` | Fetch in flight             | "Asking GitHub for the Gist…" (spinner; static under reduced motion)                                                       |
| `done`    | Loaded                      | "Loaded “file.deadwax” from the Gist. It’s on the platter, unplayed."                                                      |
| `error`   | 404, bad ID, timeout, other | ✕ plus the specific POC message                                                                                            |
| `limited` | 403 or 429                  | ⏱ "GitHub’s limit of 60 requests an hour has been reached. Try again after {time}, or download the file and drop it here." |
| `choose`  | Several files               | "This Gist has several files. Choose one to load." (shows `#gist-files`)                                                   |

`#gist-message` has `role="status"`. Keep `#status` updates too, or drop the
duplicates from `#status` while the Shelf view is showing.

## Notices and errors

- **`#storage-status.notice`:** an amber bar with a "!" badge, hidden when
  empty. Suggested copy: _"This browser isn’t letting Dead Wax save, so the
  shelf lasts only until you close the tab. You can still play, edit and export
  files."_
- **`.notice--danger`:** for anything blocking. It isn't currently used.
- **Audio failed to start:** use `#status`, as now.

## Keyboard shortcuts

These are global and ignored while typing (in inputs, the textarea, selects or
the dialog) and when Ctrl, ⌘ or Alt is held. Space is ignored while a button,
link or checkbox has focus, so it still activates that control.

| Key            | Action                                                                |
| -------------- | --------------------------------------------------------------------- |
| Space          | Play / pause                                                          |
| D              | Drift on or off                                                       |
| 1–8            | Darker, Brighter, Busier, Sparser, Looser, Tighter, Dreamier, Dustier |
| [ and ]        | Wander −5% or +5% (also announced via `#status`)                      |
| H              | Return home                                                           |
| K              | Hold                                                                  |
| C              | Capture (as a new Pressing)                                           |
| N              | New Pressing                                                          |
| P · E · L      | Desk · Score · Shelf                                                  |
| Ctrl/⌘ + Enter | Apply (in the editor)                                                 |
| ?              | Shortcuts dialog                                                      |

The footer shows the four most useful ones (`.foot__keys`, hidden on phones).
`aria-keyshortcuts` is set on the relevant controls. The prototype's `keydown`
handler can be lifted as-is.

## Responsive behaviour

| Width      | Layout                                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| < 760px    | One column: Transport → Drift → Mixer → Room. Tabs go full-width under the logo; footer shortcuts are hidden. Five strips still fit at 360px. |
| 760–1079px | The transport puts keys beside the title, with the display below. The drift console puts the rockers beside the gauge.                        |
| ≥ 1080px   | Transport across the top; Drift (wide) on the left; Mixer and Room stacked on the right.                                                      |
| ≥ 1440px   | The Score view goes side by side, with the Desk on the left and the editor (sticky) on the right.                                             |

There's no horizontal scrolling at 360px; this was verified with `scrollWidth`.
Long titles wrap with `overflow-wrap: anywhere`.

## Accessibility checklist

- **Contrast:** all text is AA on every surface it sits on (see the header of
  `tokens.css`). Interactive borders (`--c-edge`) are at least 3:1.
- **Focus:** a 2px amber outline on everything. Composite controls (knob, toggle
  and toggle) draw it on the visible part via `:has(:focus-visible)`.
- **State is never colour alone:**
  - pressed keys sink and light a lamp
  - mute shows "· muted"
  - Drift shows "On" and "Off", and Play/Pause changes its label
  - error lines show "!"
  - the active bar shows "◂ now"
  - disabled keys are dashed
- **Meters** are `role="meter"` with `aria-valuetext`; the decoration is
  `aria-hidden`.
- **Live regions:** `#status`, `#drift-status`, `#errors` and `#gist-message`.
  `#clock` is deliberately not live.
- **Reduced motion:** every duration token is 0. The sweep, spinner and Play
  breathing are static.
- **Touch targets** are at least 44px, except the compact mute and quiet keys
  (32–36px), which have spacing around them.

## Copy and voice

The copy is quiet, concrete and a little warm, in British English, with no
exclamation marks. It uses the language of a record room: the needle, the
platter, the shelf and takes.

**Rules**

- **Control names stay plain.** Buttons say what they do: Play, Pause, Return
  home, Hold. The record language lives in status lines, hints and empty states,
  where it adds feeling without making anything harder to find. "Cut a take" and
  "Put on" are the exceptions, because they're as clear as the plain words.
- **One metaphor per sentence.** Don't stack puns.
- **Glossary:**
  - **Pressing:** the file and format, in docs and the editor.
  - **Record:** a Pressing, casually.
  - **On the platter:** the loaded Pressing.
  - **Needle down / needle up:** playing / paused.
  - **Home:** the Pressing as written.
  - **Take:** a capture.
  - **The shelf:** the library.

**Copy table.** Replace the POC text with the new text. Strings with `{…}` are
templates.

| Where                      | Element                | Text                                                                                                                                  |
| -------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| First-run note             | `.first-run`           | Drop the needle to begin. Browsers wait for a tap before making any sound.                                                            |
| Initial status             | `#status`              | Everything is synthesised here, in your browser.                                                                                      |
| Power indicator            | `#power-text`          | Standby (before first Play) · Spinning (playing) · Needle up (paused)                                                                 |
| Clock, ready               | `#clock`               | Ready                                                                                                                                 |
| Clock, playing             | `#clock`               | {tempo} BPM · bar {n}/{bars} · loop {loop}                                                                                            |
| Clock, paused              | `#clock`               | Needle up · bar {n}/{bars}                                                                                                            |
| Play, fresh                | `#status`              | Needle down.                                                                                                                          |
| Play, resume               | `#status`              | Needle down at bar {n}.                                                                                                               |
| Pause                      | `#status`              | Needle up. Play carries on from bar {n}; Return home starts afresh.                                                                   |
| Tap bar, playing           | `#status`              | Bar {n} is next.                                                                                                                      |
| Tap current bar (cancel)   | `#status`              | Cue cancelled.                                                                                                                        |
| Tap bar, paused            | `#status`              | Needle moved to bar {n}. Play starts there.                                                                                           |
| Steer or Hold while paused | `#status`              | Drop the needle before steering. · Drop the needle before holding.                                                                    |
| Drift on                   | `#drift-status`        | Wandering within this Pressing’s permitted dimensions.                                                                                |
| Drift off                  | `#drift-status`        | Drift paused here. Return home to restore the original.                                                                               |
| Direction                  | `#drift-status`        | Heading {direction}. It arrives a little each bar.                                                                                    |
| Direction cleared          | `#drift-status`        | Free wandering again.                                                                                                                 |
| Return home, playing       | `#drift-status`        | Coming home. Give it a loop or two.                                                                                                   |
| Arrived home               | `#drift-status`        | Home. The Pressing as written.                                                                                                        |
| At rest                    | `#drift-status`        | The original Pressing, with nowhere else to be.                                                                                       |
| Hold on / off              | `#drift-status`        | Holding here. The groove keeps turning. · Released. It’s wandering again.                                                             |
| Capture key                | `#capture`             | Cut a take                                                                                                                            |
| Capture done               | `#status`              | Cut “{title} · take {n}” and put it on the platter. The original is untouched on your shelf.                                          |
| Capture done               | `#drift-status`        | This take is the new home. Drift is off.                                                                                              |
| Apply, valid               | `#status`              | Queued. It drops in at the next bar.                                                                                                  |
| Apply, invalid             | `#status`              | Not applied. Fix the marked lines; the record on the platter keeps playing.                                                           |
| New Pressing               | `#status`              | A blank Pressing is in the score. Apply to hear it; save it to the shelf to keep it.                                                  |
| Empty platter              | `.display__empty`      | No record on the platter. Choose one above, pull one from the shelf, or drop a .deadwax file anywhere.                                |
| Empty platter button       | `[data-goto="shelf"]`  | Go to the shelf                                                                                                                       |
| Empty platter status       | `#status`              | Choose a record to put on.                                                                                                            |
| Save key                   | `#save`                | Save to shelf                                                                                                                         |
| Sleeve load action         | `[data-action="load"]` | Put on                                                                                                                                |
| Sleeve loaded              | `#status`              | “{name}” is on the platter.                                                                                                           |
| Delete confirm             | `.sleeve__confirm`     | Take “{name}” off the shelf? This can’t be undone. · [Delete] [Keep it]                                                               |
| Empty shelf                | `#shelf-empty`         | **The shelf is bare.** Save what’s on the platter, cut a take while it drifts, or bring a record in from a file or a Gist.            |
| Import heading             | `#import-title`        | Bring a record in                                                                                                                     |
| File read                  | `#status`              | Read “{file}”. It’s on the platter, needle up.                                                                                        |
| Gist loaded                | `#gist-message`        | Loaded “{file}” from the Gist. It’s on the platter, needle up.                                                                        |
| Drag-over veil             | `.drop-veil`           | Drop the needle…                                                                                                                      |
| Storage unavailable        | `#storage-status`      | This browser isn’t letting Dead Wax save, so the shelf lasts only until you close the tab. You can still play, edit and export files. |

Error messages (parse errors, Gist 404 and rate limits, file too large) stay
literal and specific. Clarity beats theme there.
