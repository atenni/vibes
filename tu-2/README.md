# TU-2

A chromatic guitar and bass tuner styled after the BOSS TU-2 pedal. Tap the
footswitch, play a string, chase the LEDs until they stop. Audio is analysed on
the device and never recorded or sent anywhere.

## Use

- **Footswitch** (or Space/Enter): start or stop listening.
- **MODE** (right key, tap): Chromatic → Guitar → Guitar ♭ → Guitar ♭♭ → Bass ♭♭
  → Bass ♭ → Bass, as in the TU-2 manual. The mode's LED on the arc lights
  briefly.
- **STREAM/CENT** (left key, tap): stream (marquee that stops when in tune) or
  single cent LED.
- **PITCH**: hold the left key to lower, the right key to raise the reference A4
  by 1 Hz (438–445 Hz). It repeats while held.
- Settings persist in `localStorage` (`tu-2:settings`).
- `?demo` replaces the microphone with a synthetic plucked string, so the
  pipeline can be tried without a guitar.

The microphone needs a secure context: HTTPS or `http://localhost`.

## Files

- `app.mjs` wiring, settings, rAF loop, aria status
- `mic.mjs` getUserMedia, AudioContext, AnalyserNode, Wake Lock, demo signal
- `display.mjs` LEDs, guides, 7-segment SVG, CHECK LED
- `pitch.mjs`, `notes.mjs`, `tuner.mjs`, `segments.mjs` pure logic (tested)

Run `node --test tu-2/`.
