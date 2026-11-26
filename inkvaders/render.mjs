// Canvas drawing and all presentation state: starfield, sprites, ink, bullets,
// particles, popups, shake, banners and the HUD. It reads the Game directly
// (read-only) and reacts to the events returned from step().

import { FIELD } from "./game.mjs";
import {
  GLYPH_H,
  GLYPH_W,
  bitmapRects,
  glyphFor,
  spriteFrame,
  spriteSize,
  textWidth,
} from "./sprites.mjs";

export const BG = "#0b0820";

/** Sprite colours by kind. Enemy bullets are yellow so they never blend in. */
export const COLOURS = {
  blob: "#8dff3c",
  squid: "#ff4fa3",
  crab: "#ff9a2e",
  diver: "#a66bff",
  inkeater: "#27e6c8",
  mothership: "#ff3b57",
  boss: "#ff4d8d",
  ship: "#7df9ff",
  enemyBullet: "#ffe14d",
};

const INK_HUE_A = 188; // cyan
const INK_HUE_B = 312; // magenta
const MAX_PARTICLES = 520;
const SPRITE_PX = 4;
const SPRITE_PAD = 10;

/** Hue that ping-pongs cyan ↔ magenta. `t` is any real number. */
export function inkHue(t) {
  const tri = Math.abs((((t % 2) + 2) % 2) - 1); // 0…1…0
  return INK_HUE_A + (INK_HUE_B - INK_HUE_A) * tri;
}
const inkColour = (t, l = 62, a = 1) =>
  `hsla(${inkHue(t).toFixed(0)} 100% ${l}% / ${a})`;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rand = (a, b) => a + Math.random() * (b - a);
const easeOutBack = (x) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/** @type {Map<string, Array<[number, number, number, number]>>} */
const glyphRects = new Map();
function rectsFor(ch) {
  let rects = glyphRects.get(ch);
  if (!rects) {
    rects = bitmapRects(glyphFor(ch));
    glyphRects.set(ch, rects);
  }
  return rects;
}

/**
 * Draw pixel-font text. `colour` is a CSS colour, or a function from glyph
 * index to colour for per-letter effects.
 * @param {CanvasRenderingContext2D} g
 * @param {string} text
 * @param {number} x @param {number} y Top-left (or per `align`).
 * @param {number} px Size of one font pixel.
 * @param {{ align?: "left"|"center"|"right", colour?: string | ((i: number) => string), alpha?: number }} [o]
 */
export function drawText(g, text, x, y, px, o = {}) {
  const { align = "left", colour = "#fff", alpha = 1 } = o;
  const chars = [...text];
  const width = textWidth(text, px);
  let cx =
    align === "center" ? x - width / 2 : align === "right" ? x - width : x;
  g.save();
  g.globalAlpha *= alpha;
  const perGlyph = typeof colour === "function";
  if (!perGlyph) {
    g.fillStyle = colour;
    g.beginPath();
  }
  chars.forEach((ch, i) => {
    if (perGlyph) {
      g.fillStyle = colour(i);
      g.beginPath();
    }
    for (const [rx, ry, rw, rh] of rectsFor(ch)) {
      g.rect(cx + rx * px, y + ry * px, rw * px, rh * px);
    }
    if (perGlyph) g.fill();
    cx += (GLYPH_W + 1) * px;
  });
  if (!perGlyph) g.fill();
  g.restore();
}

/** @param {HTMLCanvasElement} canvas */
export function createRenderer(canvas) {
  const ctx = /** @type {CanvasRenderingContext2D} */ (
    canvas.getContext("2d", { alpha: false })
  );
  const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = () => motionQuery.matches;

  // Layout, all in CSS pixels except `dpr`.
  const layout = {
    w: 0,
    h: 0,
    dpr: 1,
    scale: 1,
    ox: 0,
    oy: 0,
    safe: { top: 0, right: 0, bottom: 0, left: 0 },
    hud: { top: 0, right: 0 },
  };

  let t = 0;
  let kick = 0;
  let flash = { a: 0, colour: "#fff" };
  let meterShake = 0;
  let stepPulse = 0;
  let shownScore = 0;
  let drawHintArmed = false;
  let bannerSeen = { text: "", start: 0 };

  /** @type {Array<any>} */ let particles = [];
  /** @type {Array<any>} */ let popups = [];
  /** @type {Array<any>} */ let rings = [];

  // ---- layout ----------------------------------------------------------

  function readSafeArea() {
    const probe = document.getElementById("safe");
    if (!probe) return;
    const cs = getComputedStyle(probe);
    layout.safe = {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
    };
  }

  function resize() {
    layout.dpr = Math.min(window.devicePixelRatio || 1, 2);
    layout.w = window.innerWidth;
    layout.h = window.innerHeight;
    canvas.width = Math.round(layout.w * layout.dpr);
    canvas.height = Math.round(layout.h * layout.dpr);
    layout.scale = Math.min(layout.w / FIELD.w, layout.h / FIELD.h);
    layout.ox = (layout.w - FIELD.w * layout.scale) / 2;
    layout.oy = (layout.h - FIELD.h * layout.scale) / 2;
    readSafeArea();

    const left = Math.max(layout.ox, layout.safe.left);
    const right = Math.min(
      layout.ox + FIELD.w * layout.scale,
      layout.w - layout.safe.right,
    );
    const top = Math.max(layout.oy, layout.safe.top);
    layout.hud = {
      top: top + 8,
      right: layout.w - right + 8,
      left: left + 12,
      rightEdge: right - 8,
    };
    makeGrain();
    makeStars();
  }

  /** Screen (CSS px) → playfield units. */
  function toField(cx, cy) {
    return {
      x: (cx - layout.ox) / layout.scale,
      y: (cy - layout.oy) / layout.scale,
    };
  }
  /** Playfield units → screen CSS px. */
  function toScreen(x, y) {
    return { x: x * layout.scale + layout.ox, y: y * layout.scale + layout.oy };
  }

  // ---- background ------------------------------------------------------

  /** @type {CanvasPattern | null} */ let grain = null;
  function makeGrain() {
    if (grain) return;
    const c = document.createElement("canvas");
    c.width = c.height = 192;
    const g = c.getContext("2d");
    const img = g.createImageData(192, 192);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = v;
      img.data[i + 1] = v * 0.9;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.random() < 0.55 ? 0 : 38;
    }
    g.putImageData(img, 0, 0);
    grain = ctx.createPattern(c, "repeat");
  }

  /** @type {Array<{x:number,y:number,z:number,p:number}>} */ let stars = [];
  function makeStars() {
    if (stars.length) return;
    for (let i = 0; i < 110; i++) {
      stars.push({
        x: Math.random(),
        y: Math.random(),
        z: Math.random() < 0.6 ? 0 : Math.random() < 0.7 ? 1 : 2,
        p: Math.random() * 6.28,
      });
    }
  }

  function drawBackground(shipX) {
    const { w, h, dpr } = layout;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(
      w / 2,
      h * 0.35,
      0,
      w / 2,
      h * 0.35,
      Math.max(w, h) * 0.7,
    );
    glow.addColorStop(0, "rgba(70, 30, 140, 0.35)");
    glow.addColorStop(1, "rgba(11, 8, 32, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    if (grain) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = grain;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    const sway = ((shipX ?? 180) - 180) * -0.04;
    for (const s of stars) {
      const speed = 6 + s.z * 10;
      const y = (((s.y * h + t * speed) % h) + h) % h;
      const x = (((s.x * w + sway * (s.z + 1)) % w) + w) % w;
      const tw = 0.55 + 0.45 * Math.sin(t * (1 + s.z) + s.p);
      ctx.globalAlpha = (0.25 + s.z * 0.22) * tw;
      ctx.fillStyle = s.z === 2 ? "#cfe9ff" : s.z === 1 ? "#b7a6ff" : "#8a7fd0";
      const size = 1 + (s.z === 2 ? 1 : 0);
      ctx.fillRect(x, y, size, size);
    }
    ctx.globalAlpha = 1;
  }

  // ---- sprites ---------------------------------------------------------

  /** @type {Map<string, HTMLCanvasElement>} */ const spriteCache = new Map();
  function spriteImage(name, frame, colour) {
    const key = `${name}:${frame}:${colour}`;
    let img = spriteCache.get(key);
    if (img) return img;
    const rows = spriteFrame(name, frame);
    img = document.createElement("canvas");
    img.width = rows[0].length * SPRITE_PX + SPRITE_PAD * 2;
    img.height = rows.length * SPRITE_PX + SPRITE_PAD * 2;
    const g = img.getContext("2d");
    g.fillStyle = colour;
    g.shadowColor = colour;
    g.shadowBlur = 9;
    const rects = bitmapRects(rows);
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) g.shadowBlur = 0;
      for (const [x, y, rw, rh] of rects) {
        g.fillRect(
          SPRITE_PAD + x * SPRITE_PX,
          SPRITE_PAD + y * SPRITE_PX,
          rw * SPRITE_PX,
          rh * SPRITE_PX,
        );
      }
    }
    spriteCache.set(key, img);
    return img;
  }

  /**
   * Draw a sprite centred on (cx, cy), stretched to w×h playfield units.
   */
  function drawSprite(name, frame, colour, cx, cy, w, h, o = {}) {
    const { sx = 1, sy = 1, rot = 0, alpha = 1 } = o;
    const img = spriteImage(name, frame, colour);
    const cols = (img.width - SPRITE_PAD * 2) / SPRITE_PX;
    const rows = (img.height - SPRITE_PAD * 2) / SPRITE_PX;
    const kx = (w / cols / SPRITE_PX) * sx;
    const ky = (h / rows / SPRITE_PX) * sy;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      img,
      (-img.width / 2) * kx,
      (-img.height / 2) * ky,
      img.width * kx,
      img.height * ky,
    );
    ctx.restore();
  }

  // ---- presentation state ---------------------------------------------

  const factor = () => (reduced() ? 0.5 : 1);

  function spawn(p) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push(p);
  }

  function burst(x, y, colours, n, speed, o = {}) {
    const count = Math.max(1, Math.round(n * factor()));
    for (let i = 0; i < count; i++) {
      const a =
        o.angle !== undefined
          ? o.angle + rand(-(o.spread ?? 0.6), o.spread ?? 0.6)
          : rand(0, Math.PI * 2);
      const s = speed * rand(0.25, 1);
      const life = rand(0.35, 0.9) * (o.life ?? 1);
      spawn({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        max: life,
        size: rand(1.5, 3.8) * (o.size ?? 1),
        colour: Array.isArray(colours)
          ? colours[(Math.random() * colours.length) | 0]
          : colours,
        round: o.round ?? Math.random() < 0.35,
        drag: o.drag ?? 2.2,
        grav: o.grav ?? 120,
      });
    }
  }

  const inkPalette = () => [
    inkColour(rand(0, 2), 60),
    inkColour(rand(0, 2), 70),
    "#ffffff",
  ];

  function ring(x, y, rMax, colour, life = 0.45, width = 4) {
    rings.push({ x, y, rMax, colour, life, max: life, width });
  }

  function popup(text, x, y, o = {}) {
    popups.push({
      text,
      x: clamp(x, 30, FIELD.w - 30),
      y,
      age: 0,
      life: o.life ?? 0.95,
      scale: o.scale ?? 2,
      colour: o.colour ?? "#fff",
      vy: o.vy ?? -34,
    });
  }

  function addFlash(a, colour) {
    if (reduced()) a *= 0.5;
    flash = { a: Math.max(flash.a, a), colour };
  }

  function colourFor(kind) {
    return COLOURS[kind] ?? "#fff";
  }

  /** React to the events returned by step(). */
  function handleEvents(game, events) {
    for (const e of events) {
      switch (e.type) {
        case "shot":
          burst(game.ship.x, game.ship.y - 16, "#bff", 2, 60, {
            angle: -Math.PI / 2,
            spread: 0.7,
            life: 0.4,
            size: 0.6,
            grav: 0,
          });
          break;
        case "invaderHit":
          burst(e.x, e.y, "#fff", 4, 120, { life: 0.5, size: 0.8 });
          kick = Math.max(kick, 0.08);
          break;
        case "invaderKilled": {
          const colour = colourFor(e.kind);
          burst(e.x, e.y, [colour, colour, "#fff"], 18, 220);
          burst(e.x, e.y, colour, 6, 110, {
            round: false,
            size: 1.8,
            life: 1.1,
          });
          ring(e.x, e.y, 26, colour, 0.3, 2);
          kick = Math.max(kick, e.byRicochet ? 0.3 : 0.14);
          popup(`+${e.points}`, e.x, e.y - 8, { scale: 2, colour });
          if (e.combo >= 2) {
            const top = e.combo >= 8;
            popup(top ? "×8 INKREDIBLE" : `×${e.combo}`, e.x, e.y - 26, {
              scale: top ? 2.4 : 2 + e.combo * 0.45,
              colour: inkColour(e.combo * 0.35, 64),
              life: top ? 1.5 : 1.1,
              vy: -26,
            });
          }
          if (top8(e)) addFlash(0.18, "#ff5cf0");
          break;
        }
        case "ricochet":
          burst(e.x, e.y, inkPalette(), 14, 260, {
            round: true,
            grav: 200,
            life: 0.8,
          });
          ring(
            e.x,
            e.y,
            20 + Math.min(e.combo ?? 1, 8) * 3,
            inkColour(e.combo ?? 0, 65),
            0.28,
            3,
          );
          kick = Math.max(kick, 0.12);
          break;
        case "inkEmpty":
          meterShake = 1;
          addFlash(0.12, "#ff3355");
          break;
        case "bombFired":
          kick = Math.max(kick, 0.35);
          burst(game.ship.x, game.ship.y - 18, inkPalette(), 16, 200, {
            angle: -Math.PI / 2,
            spread: 0.9,
            round: true,
          });
          break;
        case "bombBurst": {
          const r = e.r ?? e.radius ?? 120;
          kick = 1;
          addFlash(0.55, "#ffffff");
          ring(e.x, e.y, r, "#ffffff", 0.5, 8);
          ring(e.x, e.y, r * 0.7, inkColour(0.2), 0.42, 6);
          ring(e.x, e.y, r * 1.1, inkColour(1.2), 0.6, 4);
          burst(e.x, e.y, inkPalette(), 80, 420, {
            round: true,
            life: 1.4,
            grav: 260,
            size: 1.4,
          });
          break;
        }
        case "playerHit":
        case "lifeLost":
          if (
            e.type === "lifeLost" &&
            events.some((x) => x.type === "playerHit")
          )
            break;
          kick = 1;
          addFlash(0.5, "#ff2a4d");
          burst(
            game.ship.x,
            game.ship.y,
            ["#7df9ff", "#fff", "#ff5c7a"],
            36,
            320,
            { life: 1.1 },
          );
          ring(game.ship.x, game.ship.y, 200, "#ff4466", 0.7, 6);
          ring(game.ship.x, game.ship.y, 120, "#ffffff", 0.45, 3);
          break;
        case "waveClear":
          for (let i = 0; i < 3; i++) {
            burst(rand(60, 300), rand(150, 330), inkPalette(), 24, 260, {
              round: true,
              life: 1.1,
            });
          }
          break;
        case "mothershipKilled": {
          const x = e.x ?? game.mothership?.x ?? 180;
          const y = e.y ?? game.mothership?.y ?? 56;
          burst(x, y, [COLOURS.mothership, "#ffd23f", "#fff"], 40, 300, {
            life: 1.2,
          });
          ring(x, y, 60, COLOURS.mothership, 0.5, 4);
          kick = Math.max(kick, 0.4);
          if (e.points)
            popup(`+${e.points}`, x, y + 14, {
              scale: 2.6,
              colour: "#ffd23f",
              life: 1.4,
            });
          break;
        }
        case "bossHit":
          if (game.boss)
            burst(
              e.x ?? game.boss.x,
              e.y ?? game.boss.y + 10,
              ["#fff", COLOURS.boss],
              8,
              200,
            );
          kick = Math.max(kick, 0.2);
          break;
        case "bossKilled": {
          const bx = game.boss?.x ?? e.x ?? 180;
          const by = game.boss?.y ?? e.y ?? 120;
          kick = 1;
          addFlash(0.7, "#ffffff");
          for (let i = 0; i < 6; i++) {
            burst(
              bx + rand(-40, 40),
              by + rand(-30, 30),
              [COLOURS.boss, "#ffd23f", "#fff", ...inkPalette()],
              28,
              380,
              { life: 1.6 },
            );
            ring(
              bx + rand(-30, 30),
              by + rand(-20, 20),
              rand(60, 140),
              inkColour(i * 0.4),
              0.5 + i * 0.1,
              4,
            );
          }
          break;
        }
        case "gameOver":
          burst(
            game.ship.x,
            game.ship.y,
            ["#7df9ff", "#fff", "#ff5c7a"],
            60,
            380,
            { life: 1.6 },
          );
          kick = 1;
          break;
        case "inkRefill":
          for (let i = 0; i < 14; i++) {
            const p = toField(
              layout.w / 2 + rand(-70, 70),
              layout.hud.top + 38,
            );
            burst(p.x, p.y, inkPalette(), 1, 60, {
              round: true,
              grav: -20,
              life: 0.8,
            });
          }
          break;
        case "march":
          stepPulse = 1;
          break;
        default:
      }
    }
  }
  const top8 = (e) => e.combo >= 8;

  /** Advance presentation state by real time `dt`. */
  function update(dt, game, view = {}) {
    t += dt;
    const slow = game && game.hitStop > 0 ? 0.15 : 1;
    const pdt = dt * slow;

    kick = Math.max(0, kick - dt * 1.9);
    flash.a = Math.max(0, flash.a - dt * 1.8);
    meterShake = Math.max(0, meterShake - dt * 3);
    stepPulse = Math.max(0, stepPulse - dt * 7);

    for (const p of particles) {
      p.life -= pdt;
      p.vx -= p.vx * p.drag * pdt;
      p.vy -= p.vy * p.drag * pdt;
      p.vy += p.grav * pdt;
      p.x += p.vx * pdt;
      p.y += p.vy * pdt;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const r of rings) r.life -= pdt;
    rings = rings.filter((r) => r.life > 0);
    for (const p of popups) {
      p.age += pdt;
      p.y += p.vy * pdt;
      p.vy *= 1 - Math.min(1, pdt * 1.6);
    }
    popups = popups.filter((p) => p.age < p.life);

    if (!game) return;
    shownScore += (game.score - shownScore) * Math.min(1, dt * 12);
    if (game.score - shownScore < 1) shownScore = game.score;

    // Continuous sparkles: ink bombs drip, ricocheted bullets shed ink.
    for (const b of game.bombs ?? []) {
      burst(b.x, b.y + 6, inkPalette(), 1, 40, {
        round: true,
        grav: 80,
        life: 0.7,
      });
    }
    for (const b of game.bullets ?? []) {
      if (b.friendly && b.ricochet && Math.random() < 0.7) {
        burst(b.x, b.y, inkPalette(), 1, 30, {
          round: true,
          grav: 0,
          life: 0.4,
          size: 0.7,
        });
      }
    }
    if (
      game.ship?.alive &&
      game.ink > 1 &&
      (game.strokes ?? []).some((s) => s.drawing) === false
    ) {
      // nothing: placeholder to keep the condition obvious for future tweaks
    }
    // First-play "draw here" hint arms when an enemy bullet nears the ship.
    if (
      view.mode === "play" &&
      game.wave === 1 &&
      !game.hints?.drew &&
      game.ship?.alive
    ) {
      for (const b of game.bullets ?? []) {
        if (!b.friendly && b.y > 300 && Math.abs(b.x - game.ship.x) < 120)
          drawHintArmed = true;
      }
    }
  }

  function reset() {
    particles = [];
    popups = [];
    rings = [];
    kick = 0;
    flash = { a: 0, colour: "#fff" };
    drawHintArmed = false;
    shownScore = 0;
    bannerSeen = { text: "", start: t };
  }

  // ---- drawing ---------------------------------------------------------

  function drawDock() {
    const g = ctx.createLinearGradient(0, FIELD.dockY, 0, FIELD.h + 200);
    g.addColorStop(0, "rgba(125, 249, 255, 0)");
    g.addColorStop(0.35, "rgba(125, 249, 255, 0.07)");
    g.addColorStop(1, "rgba(125, 249, 255, 0.12)");
    ctx.fillStyle = g;
    ctx.fillRect(-1000, FIELD.dockY, FIELD.w + 2000, 2000);
    ctx.save();
    ctx.strokeStyle = "rgba(125, 249, 255, 0.22)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 7]);
    ctx.lineDashOffset = -t * 6;
    ctx.beginPath();
    ctx.moveTo(-1000, FIELD.dockY);
    ctx.lineTo(FIELD.w + 1000, FIELD.dockY);
    ctx.stroke();
    ctx.restore();
  }

  function drawInvaders(game) {
    const pulse = stepPulse;
    for (const inv of game.invaders ?? []) {
      const colour = colourFor(inv.kind);
      const bob = Math.sin(t * 3 + inv.x * 0.025) * 1.2;
      let sx = 1 + 0.12 * pulse;
      let sy = 1 - 0.14 * pulse;
      let rot = 0;
      let alpha = 1;
      let y = inv.y + bob;
      if (inv.diving) {
        rot = Math.sin(t * 14 + inv.id) * 0.25;
        sx = 1.1;
        sy = 0.95;
      }
      if (inv.stun > 0) {
        rot = Math.sin(t * 40) * 0.15;
        alpha = 0.65;
      }
      const flashing = inv.flash > 0;
      drawSprite(
        inv.kind,
        inv.frame,
        flashing ? "#ffffff" : colour,
        inv.x,
        y,
        inv.w,
        inv.h,
        { sx, sy, rot, alpha },
      );
      if (inv.maxHp > 1 && inv.hp < inv.maxHp && !flashing) {
        // armour cracks: a dim pip row under damaged invaders
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillRect(
          inv.x - 5,
          y + inv.h / 2 + 3,
          10 * (inv.hp / inv.maxHp),
          2,
        );
      }
      if (inv.stun > 0) {
        ctx.fillStyle = "#fff";
        for (let i = 0; i < 3; i++) {
          const a = t * 8 + i * 2.1;
          ctx.fillRect(
            inv.x + Math.cos(a) * 9,
            y - inv.h / 2 - 4 + Math.sin(a) * 2,
            2,
            2,
          );
        }
      }
    }
    const m = game.mothership;
    if (m) {
      drawSprite(
        "mothership",
        Math.floor(t * 6),
        COLOURS.mothership,
        m.x,
        m.y,
        42,
        18,
        { rot: Math.sin(t * 10) * 0.04 },
      );
    }
  }

  function drawBoss(game) {
    const b = game.boss;
    if (!b) return;
    const flashing = b.flash > 0;
    const wob = Math.sin(t * 2) * 0.03;
    drawSprite(
      "boss",
      Math.floor(t * 3),
      flashing ? "#ffffff" : COLOURS.boss,
      b.x,
      b.y,
      b.w,
      b.h,
      { rot: wob },
    );
    // glowing eyes
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = inkColour(t, 65, 0.8);
    for (const ex of [-14, 14]) {
      ctx.beginPath();
      ctx.arc(b.x + ex, b.y - 4, 4 + Math.sin(t * 6) * 0.8, 0, 6.3);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawShip(game) {
    const s = game.ship;
    if (!s || s.alive === false) return;
    if (s.invuln > 0 && Math.floor(s.invuln * 14) % 2 === 0) return;
    const lean = clamp((s.vx ?? 0) / 500, -0.4, 0.4);
    // thruster
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const fl = 7 + Math.random() * 6;
    const g = ctx.createLinearGradient(0, s.y + 8, 0, s.y + 8 + fl);
    g.addColorStop(0, "rgba(255, 120, 240, 0.9)");
    g.addColorStop(1, "rgba(255, 120, 240, 0)");
    ctx.fillStyle = g;
    ctx.translate(s.x, 0);
    ctx.rotate(lean);
    ctx.fillRect(-3, s.y + 8, 6, fl);
    ctx.restore();
    drawSprite("ship", 0, COLOURS.ship, s.x, s.y, 30, 22, { rot: lean });
  }

  function drawStrokes(game) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of game.strokes ?? []) {
      const pts = s.points;
      if (!pts || pts.length === 0) continue;
      const remaining = s.life - s.age;
      const fade = s.drawing ? 1 : clamp(remaining / 0.6, 0, 1);
      if (fade <= 0) continue;
      const hueBase = (s.hue0 ?? 0) / 360;
      if (pts.length === 1) {
        ctx.fillStyle = inkColour(hueBase, 70, fade);
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, 5, 0, 6.3);
        ctx.fill();
        continue;
      }
      const passes = [
        [15, 0.14, 55],
        [7, 0.45, 62],
        [2.6, 0.95, 88],
      ];
      for (const [width, alpha, light] of passes) {
        ctx.lineWidth = width * (1 + (reduced() ? 0 : Math.sin(t * 30) * 0.03));
        for (let i = 0; i < pts.length - 1; i += 4) {
          ctx.strokeStyle = inkColour(hueBase + i * 0.045, light, alpha * fade);
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          const end = Math.min(i + 4, pts.length - 1);
          for (let j = i + 1; j <= end; j++) ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
      if (s.drawing) {
        const p = pts[pts.length - 1];
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 16);
        g.addColorStop(0, "rgba(255,255,255,0.9)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(p.x - 16, p.y - 16, 32, 32);
      }
    }
    ctx.restore();
  }

  function drawBullets(game) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const b of game.bullets ?? []) {
      if (!b.friendly) {
        const r = Math.max(b.r ?? 3, 2.5);
        ctx.fillStyle = "rgba(255, 150, 40, 0.28)";
        ctx.beginPath();
        ctx.arc(b.x, b.y, r * 2.6, 0, 6.3);
        ctx.fill();
        ctx.fillStyle = COLOURS.enemyBullet;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(t * 6 + b.id);
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.restore();
        ctx.fillStyle = "#fff";
        ctx.fillRect(b.x - 1, b.y - 1, 2, 2);
      } else if (b.ricochet) {
        const trail = b.trail ?? [];
        if (trail.length > 1) {
          ctx.lineWidth = 4;
          for (let i = 1; i < trail.length; i++) {
            const a = i / trail.length;
            ctx.strokeStyle = inkColour(t * 2 + i * 0.08, 62, a * 0.6);
            ctx.lineWidth = 1 + a * 5;
            ctx.beginPath();
            ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
            ctx.lineTo(trail[i].x, trail[i].y);
            ctx.stroke();
          }
          const last = trail[trail.length - 1];
          ctx.beginPath();
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        const r = (b.r ?? 3) + 1;
        ctx.fillStyle = inkColour(t * 2, 60, 0.35);
        ctx.beginPath();
        ctx.arc(b.x, b.y, r * 3, 0, 6.3);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, 6.3);
        ctx.fill();
      } else {
        // the ship's own shots: short cyan tracers
        ctx.strokeStyle = "rgba(160, 255, 255, 0.9)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - (b.vx ?? 0) * 0.025, b.y - (b.vy ?? -500) * 0.025);
        ctx.stroke();
        ctx.fillStyle = "rgba(125, 249, 255, 0.25)";
        ctx.beginPath();
        ctx.arc(b.x, b.y, 6, 0, 6.3);
        ctx.fill();
      }
    }
    // Ink bombs and their droplets.
    for (const bomb of game.bombs ?? []) {
      const r = 10 + Math.sin(t * 24) * 1.5;
      const g = ctx.createRadialGradient(
        bomb.x,
        bomb.y,
        0,
        bomb.x,
        bomb.y,
        r * 2.4,
      );
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.35, inkColour(t * 3, 62, 0.9));
      g.addColorStop(1, "rgba(255, 60, 220, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bomb.x, bomb.y, r * 2.4, 0, 6.3);
      ctx.fill();
    }
    for (const d of game.droplets ?? []) {
      ctx.strokeStyle = inkColour(d.x * 0.01 + t, 66, 0.8);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.vx * 0.03, d.y - d.vy * 0.03);
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(d.x, d.y, 2.2, 0, 6.3);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.colour;
      const s = p.size * (0.4 + 0.6 * a);
      if (p.round) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, s * 0.8, 0, 6.3);
        ctx.fill();
      } else {
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
    for (const r of rings) {
      const k = 1 - r.life / r.max;
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = r.colour;
      ctx.lineWidth = r.width * (1 - k * 0.6);
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.rMax * (1 - Math.pow(1 - k, 3)), 0, 6.3);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPopups() {
    for (const p of popups) {
      const k = p.age / p.life;
      const pop = easeOutBack(clamp(p.age / 0.18, 0, 1));
      const fade = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      const wanted = p.scale * pop;
      const maxPx = (FIELD.w - 20) / textWidth(p.text, 1);
      const px = Math.min(wanted, maxPx);
      const half = textWidth(p.text, px) / 2;
      const x = clamp(p.x, half + 6, FIELD.w - half - 6);
      ctx.save();
      ctx.globalAlpha = fade;
      drawText(
        ctx,
        p.text,
        x + px * 0.6,
        p.y - (GLYPH_H * px) / 2 + px * 0.6,
        px,
        { align: "center", colour: "rgba(0,0,0,0.55)" },
      );
      drawText(ctx, p.text, x, p.y - (GLYPH_H * px) / 2, px, {
        align: "center",
        colour: p.colour,
      });
      ctx.restore();
    }
  }

  function drawHints(game, view) {
    if (view.mode !== "play") return;
    const hints = game.hints ?? {};
    const pulse = 0.55 + 0.45 * Math.sin(t * 4);
    if (!hints.steered) {
      drawText(ctx, "SLIDE HERE ↓", FIELD.w / 2, FIELD.dockY + 80, 3, {
        align: "center",
        colour: "#7df9ff",
        alpha: pulse,
      });
      drawText(
        ctx,
        "SHIP FOLLOWS YOUR THUMB",
        FIELD.w / 2,
        FIELD.dockY + 110,
        1.6,
        { align: "center", colour: "#bfefff", alpha: pulse * 0.8 },
      );
    } else if (!hints.drew && drawHintArmed) {
      drawText(ctx, "DRAW HERE ↑", FIELD.w / 2, 370, 3.2, {
        align: "center",
        colour: inkColour(t, 65),
        alpha: pulse,
      });
      drawText(ctx, "INK BOUNCES BULLETS BACK", FIELD.w / 2, 402, 1.6, {
        align: "center",
        colour: "#ffd0fb",
        alpha: pulse * 0.85,
      });
      // a little animated squiggle to copy
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = inkColour(t, 65, 0.5 * pulse);
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      const reveal = (t * 0.9) % 1;
      for (let i = 0; i <= 20 * reveal; i++) {
        const x = 120 + i * 6;
        const y = 438 - i * 1.6 + Math.sin(i * 0.5) * 3;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (
      view.hintBomb &&
      game.ink >= (game.inkMax ?? 100) - 0.5 &&
      game.state === "playing"
    ) {
      drawText(
        ctx,
        "FLICK ↑ FOR INK BOMB",
        FIELD.w / 2,
        FIELD.dockY + 100,
        2.6,
        { align: "center", colour: "#ff9cf5", alpha: pulse },
      );
    }
  }

  function drawBanner(game, view) {
    const b = game.banner;
    if (!b || view.mode === "title") return;
    if (bannerSeen.text !== b.text) bannerSeen = { text: b.text, start: t };
    const age = t - bannerSeen.start;
    const pop = easeOutBack(clamp(age / 0.3, 0, 1));
    const px = Math.min(6, (FIELD.w - 30) / textWidth(b.text, 1)) * pop;
    if (px <= 0.1) return;
    const big = b.kind === "boss" || b.kind === "ink";
    const y = 250;
    ctx.save();
    ctx.translate(FIELD.w / 2, y);
    ctx.rotate(Math.sin(t * 1.5) * 0.015);
    ctx.translate(-FIELD.w / 2, -y);
    drawText(ctx, b.text, FIELD.w / 2 + px, y - (GLYPH_H * px) / 2 + px, px, {
      align: "center",
      colour: "rgba(255, 50, 200, 0.6)",
    });
    drawText(ctx, b.text, FIELD.w / 2 - px * 0.5, y - (GLYPH_H * px) / 2, px, {
      align: "center",
      colour: "rgba(60, 230, 255, 0.7)",
    });
    drawText(ctx, b.text, FIELD.w / 2, y - (GLYPH_H * px) / 2, px, {
      align: "center",
      colour: big ? (i) => inkColour(i * 0.25 + t * 2, 70) : "#ffffff",
    });
    ctx.restore();
  }

  /** The wordmark for the title screen, with an ink shimmer and drips. */
  function drawWordmark() {
    const text = "INKVADERS";
    const px = Math.min(6, (FIELD.w - 36) / textWidth(text, 1));
    const width = textWidth(text, px);
    const x0 = (FIELD.w - width) / 2;
    const y0 = 30;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    drawText(ctx, text, x0 - 2, y0, px, { colour: "rgba(255, 60, 220, 0.55)" });
    drawText(ctx, text, x0 + 2, y0 + 1, px, {
      colour: "rgba(40, 230, 255, 0.55)",
    });
    ctx.restore();
    drawText(ctx, text, x0, y0, px, {
      colour: (i) => inkColour(i * 0.3 + t * 0.8, 72 + Math.sin(t * 3 + i) * 8),
    });
    // drips under the letters
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    [...text].forEach((_, i) => {
      const cx = x0 + i * (GLYPH_W + 1) * px + 2.5 * px;
      const len = (Math.sin(t * 0.9 + i * 1.9) * 0.5 + 0.5) * 16 + 3;
      ctx.fillStyle = inkColour(i * 0.3 + t * 0.8, 62, 0.85);
      ctx.fillRect(cx - 1.2, y0 + GLYPH_H * px, 2.4, len);
      ctx.beginPath();
      ctx.arc(cx, y0 + GLYPH_H * px + len, 3, 0, 6.3);
      ctx.fill();
    });
    ctx.restore();
    // a twinkle that sweeps along
    const sweep = ((t * 0.35) % 1.6) - 0.3;
    const sx = x0 + width * sweep;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(sx, y0 + 12, 0, sx, y0 + 12, 28);
    g.addColorStop(0, "rgba(255,255,255,0.8)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(sx - 28, y0 - 16, 56, 56);
    ctx.restore();
  }

  function drawGhost(ghost) {
    if (!ghost) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const f of [ghost.steer, ghost.ink]) {
      if (!f) continue;
      const colour = f === ghost.steer ? "125, 249, 255" : "255, 120, 240";
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 28);
      g.addColorStop(0, `rgba(${colour}, ${f.down ? 0.55 : 0.3})`);
      g.addColorStop(1, `rgba(${colour}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(f.x - 28, f.y - 28, 56, 56);
      ctx.strokeStyle = `rgba(${colour}, 0.8)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.down ? 11 : 15, 0, 6.3);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTouches(touches) {
    if (!touches?.length) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of touches) {
      if (p.role !== "steer") continue;
      ctx.strokeStyle = "rgba(125, 249, 255, 0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 22, 0, 6.3);
      ctx.stroke();
      ctx.fillStyle = "rgba(125, 249, 255, 0.12)";
      ctx.fill();
    }
    ctx.restore();
  }

  // ---- HUD (screen space) ----------------------------------------------

  function drawHud(game, view) {
    const { hud, w, dpr } = layout;
    const u = clamp((FIELD.w * layout.scale) / 360, 0.75, 1.3);
    const big = Math.round(3 * u * 2) / 2;
    const small = Math.round(2 * u * 2) / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const L = hud.left;
    const T = hud.top;
    const R = hud.rightEdge;
    const rowH = 44;

    const my0 = T + rowH + 8;
    // Score + best (row 1, left)
    drawText(
      ctx,
      String(Math.round(shownScore)),
      L,
      T + (rowH - GLYPH_H * big) / 2,
      big,
      { colour: "#ffffff" },
    );
    drawText(ctx, `WAVE ${game.wave}`, L, my0, small, {
      colour: "rgba(190, 180, 255, 0.9)",
    });

    // Lives (row 1, left of the pause button)
    const lifeW = 20 * u;
    for (let i = 0; i < (game.lives ?? 0); i++) {
      const lx = R - 44 - 6 - (i + 0.5) * lifeW;
      drawSprite("ship", 0, COLOURS.ship, lx, T + rowH / 2, 15 * u, 11 * u);
    }

    // Ink meter (row 2, centred)
    const inkMax = game.inkMax ?? 100;
    const frac = clamp(game.ink / inkMax, 0, 1);
    const pips = 20;
    const pipW = 6.4 * u;
    const meterW = pips * pipW;
    const mx0 = layout.ox + (FIELD.w * layout.scale) / 2 - meterW / 2;
    const my =
      T + rowH + 6 + (meterShake > 0 ? Math.sin(t * 90) * 3 * meterShake : 0);
    const full = frac >= 0.995;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < pips; i++) {
      const lit = clamp(frac * pips - i, 0, 1);
      const x = mx0 + i * pipW;
      ctx.fillStyle = "rgba(160, 140, 255, 0.16)";
      ctx.fillRect(x, my, pipW - 1.6, 11 * u);
      if (lit > 0) {
        ctx.fillStyle = inkColour(
          i / pips + (full ? t * 2 : 0),
          full ? 72 : 62,
          lit,
        );
        ctx.fillRect(x, my, pipW - 1.6, 11 * u);
      }
    }
    if (full) {
      const g = ctx.createLinearGradient(mx0, 0, mx0 + meterW, 0);
      g.addColorStop(0, "rgba(60, 230, 255, 0.0)");
      g.addColorStop(1, "rgba(255, 60, 220, 0.0)");
      ctx.strokeStyle = inkColour(t * 3, 70, 0.4 + 0.3 * Math.sin(t * 8));
      ctx.lineWidth = 2;
      ctx.strokeRect(mx0 - 3, my - 3, meterW + 4, 11 * u + 6);
    } else if (meterShake > 0) {
      ctx.strokeStyle = `rgba(255, 50, 80, ${meterShake})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(mx0 - 3, my - 3, meterW + 4, 11 * u + 6);
    }
    ctx.restore();

    // Combo (row 2, right)
    if (game.combo >= 2) {
      const text = `×${Math.min(game.combo, 8)}`;
      const pulse = 1 + 0.12 * Math.sin(t * 14);
      drawText(ctx, text, R, my - 4, big * pulse, {
        align: "right",
        colour: inkColour(game.combo * 0.35, 66),
      });
      const frac2 = clamp((game.comboTimer ?? 0) / 2.5, 0, 1);
      ctx.fillStyle = inkColour(game.combo * 0.35, 60, 0.9);
      ctx.fillRect(R - 40 * u * frac2, my + GLYPH_H * big, 40 * u * frac2, 2);
    }

    // Boss health (row 1, centre, between score and lives)
    if (game.boss) {
      const bw = 110 * u;
      const bx = layout.ox + (FIELD.w * layout.scale) / 2 - bw / 2 - 6 * u;
      const by = T + 10;
      drawText(ctx, "INKUBUS", bx + bw / 2, by - 4, 1.5, {
        align: "center",
        colour: "#ff8bc4",
      });
      ctx.fillStyle = "rgba(255, 77, 141, 0.2)";
      ctx.fillRect(bx, by + 8, bw, 7);
      ctx.fillStyle = game.boss.flash > 0 ? "#fff" : COLOURS.boss;
      ctx.fillRect(
        bx,
        by + 8,
        bw * clamp(game.boss.hp / game.boss.maxHp, 0, 1),
        7,
      );
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * @param {any} game
   * @param {{ mode: "title"|"play"|"paused"|"over", touches?: any[], ghost?: any, hintBomb?: boolean, dt?: number }} view
   */
  function draw(game, view) {
    const { dpr } = layout;
    const trauma = Math.max(game?.trauma ?? 0, kick);
    const shake = reduced() ? 0 : trauma * trauma;
    const sxo = (Math.random() * 2 - 1) * shake * 16;
    const syo = (Math.random() * 2 - 1) * shake * 16;

    drawBackground(game?.ship?.x);
    if (!game) return;

    ctx.setTransform(
      dpr * layout.scale,
      0,
      0,
      dpr * layout.scale,
      dpr * (layout.ox + (sxo * layout.scale) / 2),
      dpr * (layout.oy + (syo * layout.scale) / 2),
    );
    drawDock();
    drawInvaders(game);
    drawBoss(game);
    drawShip(game);
    drawStrokes(game);
    drawBullets(game);
    drawParticles();
    drawGhost(view.ghost);
    if (view.mode !== "title") drawTouches(view.touches);
    drawPopups();
    drawHints(game, view);
    if (view.mode === "title") drawWordmark();
    else drawBanner(game, view);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (flash.a > 0.005) {
      ctx.globalAlpha = Math.min(1, flash.a);
      ctx.fillStyle = flash.colour;
      ctx.fillRect(0, 0, layout.w, layout.h);
      ctx.globalAlpha = 1;
    }
    if (view.mode !== "title") drawHud(game, view);
  }

  return {
    resize,
    layout,
    toField,
    toScreen,
    handleEvents,
    update,
    reset,
    draw,
    spriteSize,
  };
}
