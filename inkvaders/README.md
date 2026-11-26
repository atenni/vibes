# Inkvaders

Space Invaders for thumbs. You don't have bunkers; you draw them.

## How to play

Your ship fires automatically. You have two verbs:

- **Glide:** touch anywhere in the dock (the bottom fifth) and slide. The ship
  rides above your thumb so you can see it.
- **Ink:** touch and draw anywhere in the sky. Invader bullets that hit your ink
  ricochet back up, turn your colour, speed up and kill invaders. Chained
  ricochet kills build a combo multiplier (up to ×8).
- **Flick:** with a full ink meter, flick upward from the dock to throw an Ink
  Bomb. It spends the whole meter and splashes ink that kills what it touches.

Steer with one thumb and draw with the other. Every fifth wave is a boss, the
Inkubus, which only ricochets and bombs hurt properly.

### Controls

| Input    | Steer             | Ink             | Bomb       | Pause     | Mute |
| -------- | ----------------- | --------------- | ---------- | --------- | ---- |
| Touch    | slide in the dock | draw in the sky | flick up   | ❚❚ button |      |
| Mouse    | hover in the dock | drag in the sky |            | P / Esc   | M    |
| Keyboard | ← → or A D        |                 | Space or B | P / Esc   | M    |

The game pauses itself when the tab is hidden or loses focus. Lifting a thumb
never pauses. Sound and haptics have separate toggles, and are remembered.

## Running it

Serve the repository root over HTTP and open `/inkvaders/`:

```sh
uv run python -m http.server 8000
```

Everything is static, offline-capable and has no dependencies.

## Tests

```sh
node --test inkvaders/
```

The pure modules (`rng`, `geometry`, `waves`, `game`, `sprites`) are tested.

## Architecture

| File           | Role                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| `index.html`   | Markup, meta tags, overlays (title, pause, game over), footer          |
| `style.css`    | Layout, overlays, safe areas, touch hygiene                            |
| `app.mjs`      | Bootstrap, fixed 1/120 s loop, screen state, storage, wake lock, share |
| `input.mjs`    | Pointer/keyboard to `InputFrame`; steer/ink roles; flick detection     |
| `render.mjs`   | Canvas drawing, particles, popups, shake, HUD; driven by step events   |
| `sprites.mjs`  | Pure pixel bitmaps and the 5×7 font                                    |
| `audio.mjs`    | Web Audio synth, marching bassline                                     |
| `haptics.mjs`  | `navigator.vibrate` wrapper                                            |
| `game.mjs`     | Pure simulation: `createGame`, `step(game, dt, input) → events`        |
| `waves.mjs`    | Pure wave definitions and generator                                    |
| `geometry.mjs` | Pure vector, segment and reflection maths                              |
| `rng.mjs`      | Seeded mulberry32                                                      |

The simulation is deterministic and knows nothing about the DOM. The shell owns
time, input and presentation: particles, popups and screen shake live in
`render.mjs`. The title screen's demo runs the real engine with a scripted bot.

Persisted in `localStorage` under `inkvaders:`: `best`, `stats`, `settings`,
`hints` (first-play hints are shown until completed).
