// navigator.vibrate wrapper that honours the haptics setting. A silent no-op
// where vibration is unsupported (iOS Safari, most desktops).

const PATTERNS = {
  kill: 12,
  ricochetKill: [18, 24, 18],
  hit: 70,
  bomb: [60, 30, 120],
  wave: [20, 40, 20, 40, 40],
  boss: [80, 40, 80, 40, 160],
  tap: 8,
};

export const hapticsSupported =
  typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

export function createHaptics() {
  let enabled = true;
  let lastBuzz = 0;

  /** @param {number | number[]} pattern */
  function buzz(pattern) {
    if (!enabled || !hapticsSupported) return;
    const now = performance.now();
    if (now - lastBuzz < 30) return; // don't stack tiny pulses
    lastBuzz = now;
    try {
      navigator.vibrate(pattern);
    } catch {
      // Vibration can be blocked by permissions policy; ignore.
    }
  }

  return {
    get enabled() {
      return enabled;
    },
    set enabled(value) {
      enabled = Boolean(value);
    },
    supported: hapticsSupported,
    /** Confirm a toggle with a tap. */
    tap: () => buzz(PATTERNS.tap),
    buzz,
    /** @param {Array<{type:string, byRicochet?:boolean}>} events */
    handle(events) {
      for (const e of events) {
        switch (e.type) {
          case "invaderKilled":
            buzz(e.byRicochet ? PATTERNS.ricochetKill : PATTERNS.kill);
            break;
          case "playerHit":
          case "lifeLost":
            buzz(PATTERNS.hit);
            break;
          case "bombBurst":
            buzz(PATTERNS.bomb);
            break;
          case "waveClear":
            buzz(PATTERNS.wave);
            break;
          case "bossKilled":
            buzz(PATTERNS.boss);
            break;
          default:
        }
      }
    },
  };
}
