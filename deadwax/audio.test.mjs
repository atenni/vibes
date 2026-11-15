import test from "node:test";
import assert from "node:assert/strict";
import { AudioRack } from "./audio.mjs";

/** Exercise the real rack's session policy without building an audio graph.
 * @param {object | undefined} navigator
 * @param {() => void} onContext
 */
function openContext(navigator, onContext) {
  const contextOpened = new Error("Context opened");
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: navigator,
    configurable: true,
  });
  globalThis.AudioContext = class {
    constructor() {
      onContext();
      throw contextOpened;
    }
  };
  try {
    assert.throws(
      () => new AudioRack(1, 0.65),
      (error) => error === contextOpened,
    );
  } finally {
    if (saved) Object.defineProperty(globalThis, "navigator", saved);
    delete globalThis.AudioContext;
  }
}

test("audio requests playback routing before opening the context on every start", () => {
  const session = { type: "auto" };
  for (let i = 0; i < 2; i++) {
    session.type = "auto";
    openContext({ audioSession: session }, () => {
      assert.equal(session.type, "playback");
    });
  }
});

test("audio still starts without the Audio Session API", () => {
  for (const navigator of [undefined, {}]) {
    let opened = false;
    openContext(navigator, () => {
      opened = true;
    });
    assert.equal(opened, true);
  }
});

test("a rejected audio-session policy does not block context creation", () => {
  let requested, opened;
  openContext(
    {
      audioSession: {
        set type(value) {
          requested = value;
          throw new Error("Session policy unavailable");
        },
      },
    },
    () => {
      opened = true;
    },
  );
  assert.equal(requested, "playback");
  assert.equal(opened, true);
});
