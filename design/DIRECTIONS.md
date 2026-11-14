# Dead Wax: three visual directions

> **Decision (14 Nov 2026):** direction **C, "After hours"**, dark only, with
> **system fonts only** (no Google Fonts, no network requests). The full design
> is in `design/prototype.html`, `design/tokens.css`, `design/components.css`
> and `design/components.md`. The Google Fonts named below are style references
> only; the mockups no longer load them and fall back to system fonts.

Step 1 of the design pass. Each direction has a rough static mockup of the main
screen (Player and Drift) in `design/mockups/`. Open them through a local
server, for example `python3 -m http.server` from the repository root, then
visit `/design/mockups/`.

**Scope: dark theme only.** At the user's request there is no light theme and no
`prefers-color-scheme` switch. Each palette below is a single dark set.

All palette pairs below were checked against WCAG AA (4.5:1 for text) on the
background, surface and raised colours. The lowest pair is noted for each.

---

## A. Run-out

> The quiet area at the end of the record: black lacquer, a cream test-pressing
> label, and matrix numbers etched by hand.

The app is a record that's still turning after the music has gone quiet. The
surfaces are warm, near-black lacquer. The only light object is a cream
test-pressing label. Metadata appears as small, spaced, monospaced "etchings"
(`DW·104729·A`), like the matrix numbers in the dead wax. A large, calm serif
gives the title the feel of a hand-lettered label. The **Player** is a record
seen from above. Each chord in the loop is an arc of groove, and the current arc
glows copper as the playhead passes. **Drift** is drawn as **The Groove**: a
radial chart in which _home is a perfect circle_. Each dimension is a spoke.
Rising values push the outline out, and falling values pull it in. A glance
tells you how far, and in what character, the music has wandered. It's the most
"product-like" of the three: soft, rounded and spacious.

| Token     | Hex       | Use                                         |
| --------- | --------- | ------------------------------------------- |
| bg        | `#12110f` | Page, lacquer black                         |
| surface   | `#1a1916` | Cards                                       |
| raised    | `#23211d` | Buttons, record face                        |
| line      | `#34312b` | Rules, grooves (decorative only)            |
| ink       | `#ece6d8` | Primary text                                |
| muted     | `#a8a090` | Secondary text, etchings                    |
| accent    | `#d9935f` | Copper: playhead, active state, drift shape |
| label     | `#e8dcc4` | Test-pressing label paper                   |
| label-ink | `#2a241b` | Text on label                               |
| home      | `#8fa898` | Sage: "home" references                     |

The lowest text contrast is muted on raised, at 6.2:1.

- **Type:** _Instrument Serif_ (titles and large numerals) with _IBM Plex Sans_
  (UI) and _IBM Plex Mono_ (etchings, readouts and the editor).
- **Texture and material:** matte lacquer. Very faint concentric grooves use
  `repeating-radial-gradient`, with a warm off-axis glow at the top left, like a
  single lamp. There's no grain on text areas.
- **Mockup:** `design/mockups/a-runout.html`

## B. Track sheet

> The paperwork of a session: a tape-box lid, a ruled track sheet, a grease
> pencil and a strip of masking tape.

This direction treats the app as the documentation of a session that never ends.
Everything sits on ruled sheets with stamped condensed headings. The title,
tempo, key, meter and seed are filled into boxes along the top, like a tape-box
label. The **Player** is a literal track sheet: bars as columns, the chord
written in each cell, and drum grids as tick boxes. The current bar and step are
circled in red pencil. The mixer is a row of channel strips. **Drift** is a
**chart recorder**. Each dimension draws a pencil trace across the last few
dozen bars against a dotted blue "home" line. You read not only where the music
is, but the path it took to get there. It suits musicians who edit Pressings,
because it is the most "notation-literate" direction. It's also the busiest of
the three.

| Token       | Hex       | Use                               |
| ----------- | --------- | --------------------------------- |
| bg          | `#1b1a16` | Desk                              |
| paper       | `#23221d` | Sheets (carbon-paper dark)        |
| rule        | `#3a372e` | Ruled lines (decorative)          |
| rule-strong | `#57523f` | Box borders                       |
| ink         | `#ebe3cf` | Primary text                      |
| muted       | `#aaa18a` | Stamped labels                    |
| pencil      | `#ee8a74` | Red grease pencil: current, drift |
| blue        | `#94b8dc` | Blue pencil: home lines           |
| tape        | `#3a3527` | Masking-tape tags                 |

The lowest text contrast is muted on tape, at 4.8:1.

- **Type:** _Archivo Narrow_ (stamped headings and labels) with _Archivo_ (UI)
  and _Courier Prime_ (written values, readouts and the editor).
- **Texture and material:** ruled paper drawn with `linear-gradient`, square
  corners and a hard drop shadow, like sheets on a desk. A tilted masking-tape
  tag is the only playful touch.
- **Mockup:** `design/mockups/b-track-sheet.html`

## C. After hours

> A console in a jazz club after closing: matte hardware, backlit VU meters and
> one warm lamp.

This direction is the most "gear-like" of the three. The app is a rack of matte
dark hardware, lit only by amber. The **Player** has a recessed display with
four segment bars that fill amber, beat by beat. The parts are channel strips
with real-looking fader caps, and Wander is a knob. **Drift** is a **meter
bridge**. Each dimension has a small, centre-zero VU meter, and its needle rests
straight up when it's at home. One large meter shows the total **distance from
home**. The needles swing slowly and with damping, which suits the once-per-bar
drift. It's the most tactile direction and the closest to "a piece of studio
gear you leave on". The risk is that the cream meter faces are the brightest
thing on screen. In the full design, they would be dimmed to a warm backlit tan.

| Token    | Hex       | Use                                |
| -------- | --------- | ---------------------------------- |
| bg       | `#0d1112` | Room                               |
| chassis  | `#151b1c` | Rack panels                        |
| panel    | `#1b2223` | Raised hardware                    |
| inset    | `#0a0d0e` | Recessed displays and fader slots  |
| line     | `#2b3536` | Seams (decorative)                 |
| ink      | `#e4ded0` | Primary text                       |
| muted    | `#95a09c` | Legends                            |
| glow     | `#f2b35b` | Amber: lamps, lit segments, active |
| face     | `#f1dfb8` | VU meter face                      |
| face-ink | `#2b2113` | Meter scale                        |
| needle   | `#b5321f` | Needles (4.6:1 on face)            |
| home     | `#6f9c8b` | Green "home" tick on meters        |

The lowest text contrast is muted on panel, at 6.0:1.

- **Type:** _Barlow Semi Condensed_ (legends, UI and the title in a light
  weight) with _Martian Mono_ (readouts, the display and the editor).
- **Texture and material:** matte, anodised-looking panels with a 1px inner
  highlight. Displays are recessed with an inset shadow. Amber glow uses
  `box-shadow` and is reserved for "lit" states.
- **Mockup:** `design/mockups/c-after-hours.html`

---

## Comparison

|                          | A. Run-out                   | B. Track sheet               | C. After hours              |
| ------------------------ | ---------------------------- | ---------------------------- | --------------------------- |
| Signature drift visual   | Radial "groove" outline      | Pencil chart-recorder traces | Centre-zero needle meters   |
| Shows _history_ of drift | No (present only)            | Yes                          | No (present only)           |
| Calm over hours          | ●●● Highest                  | ●● Lots of linework          | ●● Bright meter faces       |
| Musician and editor fit  | ●●                           | ●●● Notation-like            | ●●                          |
| Mobile (360px)           | ●●● Radial chart scales well | ●● Tables need re-flow       | ●● Twelve meters stack tall |
| Build cost               | Low                          | Medium                       | Medium (meter SVGs)         |

Elements combine well. For example, A's groove chart could sit inside C's
hardware, or B's chart traces could be an optional "history" view in A.

## Open decision: fonts (needs your explicit approval)

The design brief asks for Google Fonts. The product brief allows **no network
endpoint except the GitHub Gist API**, so loading Google Fonts would be a
product-scope exception, not just a CSP change. The developer prefers a system
stack and will not relax the CSP without your approval.

1. **System stack (default, recommended).** The named Google Fonts become design
   references only. Each direction gets a tuned system stack, for example
   `ui-serif, "New York", Georgia` for A's titles, and
   `ui-monospace, "SF Mono", Menlo` for the readouts. It works offline and from
   `file:`.
2. **Google Fonts exception.** Load the fonts and widen the CSP
   (`style-src https://fonts.googleapis.com` and
   `font-src https://fonts.gstatic.com`), with the system stack as a fallback.
   This adds a third-party request on each visit.

The mockups load Google Fonts only to show the intended character. The final
tokens will be designed to look right with the system stack alone.
