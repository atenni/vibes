import * as DW from "./core.mjs";
import { loadHouseRecords } from "./house-records.mjs";
import { Transport } from "./transport.mjs";

const EXAMPLES = await loadHouseRecords();
const $ = (id) => document.getElementById(id);
const status = (message) => ($("status").textContent = message);
const parts = ["chords", "bass", "drums", "melody"];
const labels = {
  humanise: "Humanise",
  busyness: "Busy",
  embellish: "Embellish",
  arrangement: "Arrange",
  substitution: "Subst.",
  saturation: "Drive",
  vinyl: "Crackle",
  tape: "Hiss",
};
const groups = {
  Time: ["tempo", "swing", "humanise"],
  Groove: ["busyness", "embellish", "rhythm", "arrangement"],
  Harmony: ["density", "register", "substitution", "timbre"],
  Sound: ["tone", "saturation", "wow", "crush", "reverb", "balance"],
  Surface: DW.textures,
};
const TEMPLATE = `deadwax 1\ntitle Untitled Pressing\ntempo 76\nmeter 4/4\nkey C major\nswing 0.16\nbars 4\nseed 104729\n\ninstrument chords epiano\ninstrument bass upright\ninstrument melody vibes\n\nchords Dm9:4 G13:4 Cmaj7#11:4 Am9:4\nbass auto root-fifth\nkick X... .... x... ....\nrim .... x... .... x...\nhats x.g. x.g. x.g. x.g.\n\ntexture vinyl 0.12\ntexture tape 0.05\n\ndrift rate 0.35\ndrift tempo 60 96\ndrift tone 0.15 0.85\ndrift busyness 0.1 0.8\ndrift reverb 0.1 0.65\n`;
let song = DW.parse(EXAMPLES[0].text).song,
  transport = null,
  starting = false;
let lastApplied = EXAMPLES[0].text,
  editTimer,
  currentShelfName = null,
  direction = null;
let library = Object.create(null),
  gistFiles = [],
  restoring = true;
const settings = {
  seed: song.seed,
  volume: 0.65,
  wander: song.drift.rate,
  drift: false,
  muted: new Set(),
};
const storage = {
  read(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      storageWarning();
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      storageWarning();
      return false;
    }
  },
};
function storageWarning() {
  $("storage-status").textContent =
    "This browser isn’t letting Dead Wax save, so the shelf lasts only until you close the tab. You can still play, edit and export files.";
}
const saved = storage.read("deadwax.session.v1", null),
  shelf = storage.read("deadwax.library.v1", {});
if (shelf && typeof shelf === "object" && !Array.isArray(shelf))
  for (const [name, text] of Object.entries(shelf))
    if (typeof text === "string") library[name] = text;
/* The house records are ordinary shelf entries. They are stocked once per
   browser; after that, deleting or renaming them sticks. */
function restock() {
  let added = 0;
  for (const { text } of EXAMPLES) {
    if (Object.values(library).includes(text)) continue;
    library[uniqueName(DW.parse(text).song.title)] = text;
    added++;
  }
  return added;
}
if (!storage.read("deadwax.house.v1", false)) {
  restock();
  storage.write("deadwax.library.v1", library);
  storage.write("deadwax.house.v1", true);
}
function persist() {
  if (!restoring)
    storage.write("deadwax.session.v1", {
      text: $("editor").value,
      applied: lastApplied,
      shelfName: currentShelfName,
      settings: { ...settings, muted: [...settings.muted] },
    });
}
function saveShelf() {
  const ok = storage.write("deadwax.library.v1", library);
  renderLibrary();
  renderPicker();
  return ok;
}
function setView(view) {
  document.body.dataset.view = view;
  if (view === "shelf") renderLibrary();
  if (view === "desk" && transport?.song === song) {
    const p = transport.position();
    setActive(p.bar, p.offset, p.record?.tempo ?? transport.tempo);
  }
  for (const button of document.querySelectorAll(".tab[data-view]")) {
    if (button.dataset.view === view)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}
for (const button of document.querySelectorAll(".tab[data-view]"))
  button.onclick = () => setView(button.dataset.view);
for (const button of document.querySelectorAll("[data-goto]"))
  button.onclick = () => setView(button.dataset.goto);
const escape = (text) =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function syncEditorScroll() {
  const e = $("editor");
  $("editor-tint").style.transform =
    `translate(${-e.scrollLeft}px,${-e.scrollTop}px)`;
  $("editor-gutter").style.transform = `translateY(${-e.scrollTop}px)`;
}
function tintLine(line, errors) {
  let first = true,
    comment = false;
  const pieces = [...line.matchAll(/\s+|\S+/g)]
    .map((match) => {
      const token = match[0],
        column = match.index + 1;
      if (!token.trim()) return escape(token);
      if (token.startsWith(";")) comment = true;
      let cls = comment
        ? "t-comment"
        : first
          ? "t-kw"
          : /^\d+(\.\d+)?$/.test(token)
            ? "t-num"
            : /^[.xXg|]+$/.test(token)
              ? "t-rest"
              : /^(chords|bass|melody|drums|rate)$/.test(token) ||
                  Object.hasOwn(DW.specs, token)
                ? "t-name"
                : "";
      first = false;
      let html = escape(token);
      if (cls === "t-rest")
        html = [...token]
          .map(
            (c) =>
              `<span class="${c === "g" ? "t-ghost" : /[xX]/.test(c) ? "t-hit" : "t-rest"}">${escape(c)}</span>`,
          )
          .join("");
      else if (!comment && token.includes(":"))
        html = escape(token).replace(
          /(:[\d.]+)$/,
          '<span class="t-dur">$1</span>',
        );
      if (cls) html = `<span class="${cls}">${html}</span>`;
      if (
        errors.some(
          (e) => e.column >= column && e.column < column + token.length,
        )
      )
        html = `<span class="t-error">${html}</span>`;
      return html;
    })
    .join("");
  return errors.length
    ? `<span class="t-line-error">${pieces || " "}</span>`
    : pieces;
}
function showErrors(errors, { reveal = false } = {}) {
  const lines = $("editor").value.split("\n");
  $("errors").replaceChildren();
  $("editor").setAttribute("aria-invalid", String(!!errors.length));
  $("editor-chip").textContent = errors.length
    ? `✕ ${errors.length} problem${errors.length === 1 ? "" : "s"}`
    : "✓ Valid";
  $("editor-chip").classList.toggle("chip--error", !!errors.length);
  $("editor-gutter").innerHTML = lines
    .map((_, i) =>
      errors.some((e) => e.line === i + 1)
        ? `<span class="is-error">! ${i + 1}</span>`
        : String(i + 1),
    )
    .join("\n");
  $("editor-tint").innerHTML =
    lines
      .map((line, i) =>
        tintLine(
          line,
          errors.filter((e) => e.line === i + 1),
        ),
      )
      .join("\n") + "\n";
  $("editor-frame").classList.add("is-tinted");
  syncEditorScroll();
  for (const e of errors) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "error";
    const pos = document.createElement("span"),
      msg = document.createElement("span");
    pos.className = "error__pos";
    pos.textContent = `Line ${e.line}, col ${e.column}`;
    msg.textContent = e.message;
    b.append(pos, msg);
    b.onclick = () => {
      const start =
        lines.slice(0, e.line - 1).reduce((n, l) => n + l.length + 1, 0) +
        e.column -
        1;
      $("editor").focus();
      $("editor").setSelectionRange(start, start + 1);
    };
    $("errors").append(b);
  }
  if (reveal && errors.length) setView("score");
}
function readEditor({ reveal = true } = {}) {
  const p = DW.parse($("editor").value);
  showErrors(p.errors, { reveal });
  return p.errors.length ? null : p.song;
}
$("editor").onscroll = syncEditorScroll;
$("editor").oninput = () => {
  clearTimeout(editTimer);
  editTimer = setTimeout(() => {
    showErrors(DW.parse($("editor").value).errors);
    persist();
  }, 180);
};
function patchText(text, key, value) {
  const lines = text.split("\n");
  const prefix = key + " ";
  const i = lines.findLastIndex((l) => l.trimStart().startsWith(prefix));
  if (i >= 0) lines[i] = key + " " + value;
  else lines.push(key + " " + value);
  return lines.join("\n");
}
function patchDirective(key, value) {
  $("editor").value = patchText($("editor").value, key, value);
  lastApplied = patchText(lastApplied, key, value);
  showErrors(DW.parse($("editor").value).errors);
  renderPicker();
  persist();
}
function knob(input, value) {
  input.value = value;
  input
    .closest(".knob")
    ?.style.setProperty(
      "--v",
      (value - Number(input.min)) / (Number(input.max) - Number(input.min)),
    );
}
function deviation(value, origin, limits) {
  const [lo, hi] = limits;
  if (value >= origin)
    return hi > origin ? (value - origin) / (hi - origin) : 0;
  return origin > lo ? (value - origin) / (origin - lo) : 0;
}
function dimensions(state = song.values, origin = song.values, score = song) {
  const deviations = [];
  for (const key in DW.specs) {
    const el = $("dim-" + key),
      limits = score.drift.limits[key],
      locked = !limits;
    const d = locked
      ? 0
      : DW.clamp(deviation(state[key], origin[key], limits), -1, 1);
    if (!locked) deviations.push(d);
    el.style.setProperty("--d", d);
    el.classList.toggle("is-locked", locked);
    el.classList.toggle("is-limit", Math.abs(d) > 0.97);
    const delta =
      key === "tempo"
        ? state[key] - origin[key]
        : ((state[key] - origin[key]) / (DW.specs[key][1] - DW.specs[key][0])) *
          100;
    const n = Math.round(Math.abs(delta)),
      signed = n === 0 ? "0" : (delta < 0 ? "−" : "+") + n;
    el.querySelector(".vu__value").textContent = locked ? "fixed" : signed;
    el.setAttribute("aria-valuenow", Math.round(d * 100));
    el.setAttribute(
      "aria-valuetext",
      locked
        ? "Fixed at home"
        : Math.abs(d) < 0.005
          ? "At home"
          : key === "tempo"
            ? `${state[key].toFixed(1)} BPM, ${Math.abs(delta).toFixed(1)} ${delta < 0 ? "slower" : "faster"} than home`
            : `${Math.round(Math.abs(d) * 100)}% of the way to its ${d < 0 ? "lower" : "upper"} limit`,
    );
  }
  const distance = deviations.length
    ? Math.sqrt(deviations.reduce((n, d) => n + d * d, 0) / deviations.length)
    : 0;
  $("distance").style.setProperty("--d", distance);
  $("distance").setAttribute("aria-valuenow", Math.round(distance * 100));
  $("distance").setAttribute(
    "aria-valuetext",
    distance < 0.005 ? "At home" : `${Math.round(distance * 100)}% from home`,
  );
  $("distance-value").textContent = Math.round(distance * 100) + "%";
  for (const key of DW.textures) {
    const input = $("texture-" + key);
    if (document.activeElement !== input) knob(input, state[key]);
    $("texture-value-" + key).textContent = Math.round(state[key] * 100) + "%";
  }
}
for (const [group, keys] of Object.entries(groups)) {
  const section = document.createElement("div");
  section.className = "bridge__group";
  section.setAttribute("role", "group");
  section.setAttribute("aria-labelledby", "group-" + group.toLowerCase());
  const label = document.createElement("span");
  label.className = "bridge__name legend";
  label.id = "group-" + group.toLowerCase();
  label.textContent = group;
  const meters = document.createElement("div");
  meters.className = "bridge__meters";
  for (const key of keys) {
    const el = document.createElement("div"),
      n =
        $("dimensions").querySelectorAll(".vu").length + meters.children.length;
    el.className = "vu";
    el.id = "dim-" + key;
    // Golden-ratio steps spread periods and phases without repeats.
    el.style.setProperty(
      "--wobble-period",
      (2.4 + ((n * 0.618) % 1) * 1.6).toFixed(2) + "s",
    );
    el.style.setProperty(
      "--wobble-delay",
      (-((n * 1.618) % 1) * 4).toFixed(2) + "s",
    );
    el.setAttribute("role", "meter");
    el.setAttribute("aria-label", labels[key] || key);
    el.setAttribute("aria-valuemin", "-100");
    el.setAttribute("aria-valuemax", "100");
    el.innerHTML = `<div class="vu__face" aria-hidden="true"><span class="vu__needle"></span><span class="vu__peak"></span></div><div class="vu__legend" aria-hidden="true"><span class="vu__name legend">${labels[key] || key}</span><span class="vu__value">0</span></div>`;
    meters.append(el);
  }
  section.append(label, meters);
  $("dimensions").append(section);
}
const pretty = (symbol) => symbol.replaceAll("b", "♭").replaceAll("#", "♯");
function drawBars() {
  const list = $("bars");
  list.replaceChildren();
  $("loopmap").replaceChildren();
  list.dataset.row = String(Math.min(song.bars, 4));
  list.toggleAttribute("data-eight", song.bars % 8 === 0);
  list.toggleAttribute("data-long", song.bars > 8);
  $("bars-legend").textContent = song.bars + "-bar loop";
  for (let i = 0; i < song.bars; i++) {
    const chords = song.chords.filter(
        (e) =>
          e.at < (i + 1) * song.beats && e.at + e.duration > i * song.beats,
      ),
      li = document.createElement("li"),
      button = document.createElement("button");
    li.className = "bar";
    button.className = "bar__btn";
    button.type = "button";
    button.dataset.bar = i;
    button.tabIndex = i === 0 ? 0 : -1;
    button.setAttribute(
      "aria-label",
      `Bar ${i + 1}, ${chords.map((e) => e.symbol).join(", ")}`,
    );
    const n = document.createElement("span");
    n.className = "bar__n";
    n.textContent = i + 1;
    const symbols = document.createElement("span");
    symbols.className = "bar__chord";
    chords.forEach((e, j) => {
      if (j) {
        const sep = document.createElement("span");
        sep.className = "sep";
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = "/";
        symbols.append(sep);
      }
      const symbol = document.createElement("span");
      symbol.textContent = pretty(e.symbol);
      if (e.at < i * song.beats) symbol.className = "is-held";
      symbols.append(symbol);
    });
    const sweep = document.createElement("span");
    sweep.className = "bar__sweep";
    button.append(n, symbols, sweep);
    li.append(button);
    list.append(li);
    $("loopmap").append(document.createElement("i"));
  }
}
function setActive(bar, offset = 0, tempo = song.tempo, score = song) {
  const list = $("bars");
  const focused = document.activeElement?.closest("#bars [data-bar]");
  const tabBar = focused ? +focused.dataset.bar : bar;
  list.style.setProperty("--bar-dur", (60 / tempo) * score.beats + "s");
  list.style.setProperty("--beats", score.beats);
  for (const [i, li] of [...list.children].entries()) {
    const active = i === bar;
    li.classList.toggle("is-active", active);
    li.classList.toggle("is-cued", i === transport?.cuedBar);
    const button = li.firstElementChild;
    if (active) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
    button.tabIndex = i === tabBar ? 0 : -1;
    if (active) {
      const sweep = button.querySelector(".bar__sweep");
      sweep.style.setProperty("--from", offset);
      sweep.style.display = "none";
      void sweep.offsetWidth;
      sweep.style.display = "";
    }
  }
  for (const [i, segment] of [...$("loopmap").children].entries()) {
    segment.classList.toggle("is-active", i === bar);
    segment.classList.toggle("is-past", i < bar);
  }
  const item = list.children[bar];
  if (item) {
    const itemRect = item.getBoundingClientRect(),
      rect = list.getBoundingClientRect();
    if (itemRect.top < rect.top || itemRect.bottom > rect.bottom)
      list.scrollTo({
        top: list.scrollTop + itemRect.top - rect.top,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }
}
function mixer() {
  for (const part of parts) {
    $("level-" + part).value = song.levels[part];
    $("level-value-" + part).textContent = Math.round(song.levels[part] * 100);
    $("mute-" + part).setAttribute(
      "aria-pressed",
      String(settings.muted.has(part)),
    );
  }
  $("volume").value = settings.volume;
  $("volume-value").textContent = Math.round(settings.volume * 100);
}
/* Which shelf entry is on the platter, if any. An exact text match wins;
   otherwise keep the entry it was loaded from, now marked Edited. */
function syncCurrent() {
  if (currentShelfName !== null && !Object.hasOwn(library, currentShelfName))
    currentShelfName = null;
  if (library[currentShelfName] !== lastApplied)
    currentShelfName =
      Object.keys(library).find((name) => library[name] === lastApplied) ??
      currentShelfName;
}
function renderPicker() {
  syncCurrent();
  const picker = $("record"),
    names = Object.keys(library).sort(),
    onShelf = currentShelfName !== null,
    edited = onShelf && library[currentShelfName] !== lastApplied;
  const options = names.map((name) => new Option(name, name));
  if (!onShelf) {
    const loose = new Option(song.title + " (not on the shelf)", "");
    loose.disabled = true;
    options.unshift(loose);
  }
  picker.replaceChildren(...options);
  picker.value = onShelf ? currentShelfName : "";
  picker.disabled = !names.length && !onShelf;
  $("title-tag").hidden = onShelf && !edited;
  $("title-tag").textContent = onShelf ? "Edited" : "Unsaved";
}
function renderSong() {
  renderPicker();
  $("title").textContent = song.title;
  $("meta-tempo").textContent = song.tempo + " bpm";
  $("meta-key").textContent = pretty(song.key);
  $("meta-meter").textContent = song.meter;
  $("meta-bars").textContent = song.bars + (song.bars === 1 ? " bar" : " bars");
  $("seed").value = settings.seed;
  knob($("wander"), settings.wander);
  $("wander-value").textContent = Math.round(settings.wander * 100) + "%";
  $("drift").checked = settings.drift;
  drawBars();
  mixer();
  if (transport?.song === song)
    dimensions(transport.drift.current, transport.drift.origin, song);
  else dimensions();
  const p = transport?.position() ?? { bar: 0, offset: 0 };
  setActive(Math.min(p.bar, song.bars - 1), p.offset);
  renderLibrary();
}
/* The record turns as a Web Animation, which the browser runs on the
   compositor, so main-thread work at bar lines can't make it stutter. Play
   ramps the playback rate up over 1.2 s and Pause winds it down over 2.6 s,
   the same times as the lamps (--t-lamp-on, --t-lamp-off). Only the ramps
   touch the main thread; a steady spin needs no JavaScript at all. */
const platter = { anim: null, rate: 0, target: 0, frame: 0, last: 0 };
function spinPlatter(on) {
  platter.target = on ? 1 : 0;
  platter.anim ??= $("tt-platter").animate(
    [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
    { duration: 3600, iterations: Infinity }, // 100° a second
  );
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    cancelAnimationFrame(platter.frame);
    platter.frame = 0;
    platter.rate = 0; // still record; the arm alone shows state
    platter.anim.pause();
    return;
  }
  if (platter.frame) return;
  platter.last = performance.now();
  const step = (now) => {
    const dt = Math.min((now - platter.last) / 1000, 0.1);
    platter.last = now;
    platter.rate =
      platter.rate < platter.target
        ? Math.min(platter.target, platter.rate + dt / 1.2)
        : Math.max(platter.target, platter.rate - dt / 2.6);
    if (platter.rate > 0) {
      platter.anim.playbackRate = platter.rate;
      if (platter.anim.playState !== "running") platter.anim.play();
    } else platter.anim.pause();
    platter.frame =
      platter.rate !== platter.target ? requestAnimationFrame(step) : 0;
  };
  platter.frame = requestAnimationFrame(step);
}
function transportUI() {
  const playing = !!transport?.running;
  document.body.dataset.audio = playing ? "on" : "off";
  spinPlatter(playing);
  $("power-text").textContent = playing
    ? "Spinning"
    : document.body.hasAttribute("data-first-run")
      ? "Standby"
      : "Needle up";
  $("seed").disabled = playing;
  if (!playing) {
    const p = transport?.position() ?? { bar: 0, offset: 0 };
    $("clock").textContent =
      transport || !document.body.hasAttribute("data-first-run")
        ? `Needle up · bar ${p.bar + 1}/${song.bars}`
        : "Ready";
    setActive(p.bar, p.offset, transport?.tempo ?? song.tempo);
  }
}
function pauseTransport() {
  if (!transport?.running) return;
  const changed = transport.pending || transport.song !== song;
  transport.pause();
  if (changed) {
    transport = null;
    transportUI();
    dimensions();
    persist();
    status("Needle up. The new Pressing is ready from bar 1.");
    return;
  }
  transportUI();
  const d = transport.drift;
  dimensions(d.current, d.origin, transport.song);
  persist();
  status(
    `Needle up. Play carries on from bar ${transport.position().bar + 1}; Return home starts afresh.`,
  );
}
function ensureTransport() {
  if (!transport)
    transport = new Transport(
      song,
      settings,
      (v) => {
        if (v.song === song) {
          setActive(v.bar, v.offset, v.plan.state.tempo, v.song);
          dimensions(v.plan.state, v.origin ?? transport.drift.origin, v.song);
          if (
            transport.drift.home &&
            $("drift-status").textContent !==
              "Home. The Pressing as written." &&
            Object.keys(DW.specs).every((key) => {
              const [lo, hi] = v.song.drift.limits[key] ?? [
                v.origin[key],
                v.origin[key],
              ];
              return (
                Math.abs(v.plan.state[key] - v.origin[key]) <=
                (hi - lo) * 0.004 + 0.00001
              );
            })
          )
            $("drift-status").textContent = "Home. The Pressing as written.";
        }
        $("clock").textContent =
          `${v.plan.state.tempo.toFixed(1)} BPM · bar ${v.bar + 1}/${v.song.bars} · loop ${v.loop + 1}`;
      },
      () => {
        transportUI();
        status("Audio was interrupted. Press Play to resume from here.");
      },
    );
  return transport;
}
function clearDirection() {
  direction = null;
  for (const b of document.querySelectorAll("[data-direction]"))
    b.setAttribute("aria-pressed", "false");
  $("hold").setAttribute("aria-pressed", "false");
}
function applyText(text, { queue = false } = {}) {
  clearTimeout(editTimer);
  const parsed = DW.parse(text);
  $("editor").value = text;
  showErrors(parsed.errors, { reveal: true });
  if (parsed.errors.length) {
    persist();
    status(
      "Not applied. Fix the marked lines; the record on the platter keeps playing.",
    );
    return false;
  }
  if (!queue && transport?.running) transport.pause();
  song = parsed.song;
  lastApplied = text;
  settings.seed = song.seed;
  settings.wander = song.drift.rate;
  settings.muted = new Set(song.muted);
  settings.drift = false;
  clearDirection();
  if (queue && transport?.running) transport.pending = song;
  else transport = null;
  $("drift-status").textContent =
    "The original Pressing, with nowhere else to be.";
  renderSong();
  transportUI();
  persist();
  status(
    queue && transport?.running
      ? "Queued. It drops in at the next bar."
      : "The record is on the platter, needle up.",
  );
  return true;
}
function mayReplace() {
  return (
    $("editor").value === lastApplied ||
    confirm(
      "Replace your unapplied editor changes? Export them first if you want to keep them.",
    )
  );
}
$("record").onchange = () => {
  const name = $("record").value;
  if (Object.hasOwn(library, name) && mayReplace()) {
    currentShelfName = name;
    if (applyText(library[name])) status(`“${name}” is on the platter.`);
  } else renderPicker();
};
$("apply").onclick = () => {
  const ok = applyText($("editor").value, {
    queue: !!transport?.running,
  });
  if (!ok) $("errors").querySelector("button")?.focus();
};
$("play").onclick = async () => {
  if (starting) return;
  if (transport?.running) {
    pauseTransport();
    return;
  }
  if (!$("seed").checkValidity()) {
    status("Seed must be an integer between 0 and 4294967295.");
    return;
  }
  if ($("editor").value !== lastApplied) {
    if (!readEditor()) {
      status("Fix the Pressing before playing.");
      return;
    }
    applyText($("editor").value);
  }
  starting = true;
  $("play").disabled = true;
  try {
    const t = ensureTransport(),
      p = t.position(),
      resuming = !!t.startSnapshot;
    await t.start();
    document.body.removeAttribute("data-first-run");
    transportUI();
    status(resuming ? `Needle down at bar ${p.bar + 1}.` : "Needle down.");
    persist();
  } catch (e) {
    if (transport?.rack) await transport.rack.dispose();
    transport = null;
    transportUI();
    status("Audio could not start: " + e.message);
  } finally {
    starting = false;
    $("play").disabled = false;
  }
};
$("bars").onclick = (e) => {
  const button = e.target.closest("[data-bar]");
  if (!button) return;
  const t = ensureTransport(),
    bar = +button.dataset.bar;
  t.jumpTo(bar);
  if (t.running) {
    for (const [i, li] of [...$("bars").children].entries())
      li.classList.toggle("is-cued", i === t.cuedBar);
    status(t.cuedBar === null ? "Cue cancelled." : `Bar ${bar + 1} is next.`);
  } else {
    setActive(bar);
    $("clock").textContent = `Needle up · bar ${bar + 1}/${song.bars}`;
    status(`Needle moved to bar ${bar + 1}. Play starts there.`);
  }
};
$("bars").onkeydown = (e) => {
  const button = e.target.closest("[data-bar]");
  if (!button) return;
  const index = +button.dataset.bar,
    cols =
      parseInt(getComputedStyle($("bars")).getPropertyValue("--cols")) || 4;
  let next;
  if (e.key === "ArrowRight") next = index + 1;
  else if (e.key === "ArrowLeft") next = index - 1;
  else if (e.key === "ArrowDown") next = index + cols;
  else if (e.key === "ArrowUp") next = index - cols;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = song.bars - 1;
  else return;
  e.preventDefault();
  const buttons = $("bars").querySelectorAll("[data-bar]");
  buttons.forEach((b) => (b.tabIndex = -1));
  const target = buttons[DW.clamp(next, 0, buttons.length - 1)];
  target.tabIndex = 0;
  target.focus();
};
$("seed").onchange = () => {
  if (!$("seed").checkValidity()) {
    status("Seed must be an integer between 0 and 4294967295.");
    return;
  }
  settings.seed = +$("seed").value;
  song.seed = settings.seed;
  patchDirective("seed", settings.seed);
  transport = null;
  clearDirection();
  dimensions();
  transportUI();
  status("Seed changed. The next Play starts a fresh session.");
};
$("volume").oninput = () => {
  settings.volume = +$("volume").value;
  $("volume-value").textContent = Math.round(settings.volume * 100);
  if (transport?.running)
    transport.rack.master.gain.setTargetAtTime(
      settings.volume,
      transport.rack.ctx.currentTime,
      0.025,
    );
  persist();
};
for (const part of parts) {
  $("mute-" + part).onclick = () => {
    settings.muted.has(part)
      ? settings.muted.delete(part)
      : settings.muted.add(part);
    song.muted = [...settings.muted];
    if (transport) transport.song.muted = [...settings.muted];
    const line = song.muted.length ? "mute " + song.muted.join(" ") : "";
    const patch = (text) => {
      const lines = text.split("\n").filter((l) => !/^\s*mute\b/.test(l));
      if (line) lines.push(line);
      return lines.join("\n");
    };
    $("editor").value = patch($("editor").value);
    lastApplied = patch(lastApplied);
    showErrors(DW.parse($("editor").value).errors);
    mixer();
    if (transport?.running)
      transport.rack.mix(
        transport.song,
        transport.drift.current,
        settings.muted,
        transport.rack.ctx.currentTime,
      );
    persist();
  };
  $("level-" + part).oninput = () => {
    const value = +$("level-" + part).value;
    song.levels[part] = value;
    if (transport) transport.song.levels[part] = value;
    patchDirective("level " + part, value);
    mixer();
    if (transport?.running)
      transport.rack.mix(
        transport.song,
        transport.drift.current,
        settings.muted,
        transport.rack.ctx.currentTime,
      );
  };
}
for (const key of DW.textures) {
  const input = $("texture-" + key);
  input.oninput = () => {
    const value = +input.value;
    song.values[key] = value;
    if (transport) {
      transport.song.values[key] = value;
      transport.setDimension(key, value);
    }
    const limits = song.drift.limits[key];
    if (limits) {
      limits[0] = Math.min(limits[0], value);
      limits[1] = Math.max(limits[1], value);
      patchDirective("drift " + key, limits.join(" "));
    }
    patchDirective("texture " + key, value);
    knob(input, value);
    $("texture-value-" + key).textContent = Math.round(value * 100) + "%";
    if (transport?.running)
      transport.rack.setColour(
        transport.drift.current,
        transport.rack.ctx.currentTime,
      );
    dimensions(
      transport?.drift.current ?? song.values,
      transport?.drift.origin ?? song.values,
    );
  };
}
$("wander").oninput = () => {
  settings.wander = +$("wander").value;
  song.drift.rate = settings.wander;
  knob($("wander"), settings.wander);
  $("wander-value").textContent = Math.round(settings.wander * 100) + "%";
  patchDirective("drift rate", settings.wander);
};
$("drift").onchange = () => {
  settings.drift = $("drift").checked;
  if (settings.drift && transport) transport.drift.home = false;
  $("drift-status").textContent = settings.drift
    ? "Wandering within this Pressing’s permitted dimensions."
    : "Drift paused here. Return home to restore the original.";
  persist();
};
for (const b of document.querySelectorAll("[data-direction]"))
  b.onclick = () => {
    if (!transport?.running) {
      status("Drop the needle before steering.");
      return;
    }
    const t = transport,
      name = b.dataset.direction;
    direction = direction === name ? null : name;
    settings.drift = true;
    $("drift").checked = true;
    DW.steer(t.drift, song, direction ?? "Free");
    $("hold").setAttribute("aria-pressed", "false");
    for (const other of document.querySelectorAll("[data-direction]"))
      other.setAttribute(
        "aria-pressed",
        String(other.dataset.direction === direction),
      );
    $("drift-status").textContent = direction
      ? "Heading " + direction.toLowerCase() + ". It arrives a little each bar."
      : "Free wandering again.";
    persist();
  };
$("home").onclick = () => {
  clearDirection();
  if (!transport?.running) {
    transport = null;
    dimensions();
    transportUI();
    $("drift-status").textContent = "Home. The Pressing as written.";
    return;
  }
  DW.steer(transport.drift, song, "Home");
  $("drift-status").textContent = "Coming home. Give it a loop or two.";
};
$("hold").onclick = () => {
  if (!transport?.running) {
    status("Drop the needle before holding.");
    return;
  }
  const d = transport.drift;
  d.hold = !d.hold;
  $("hold").setAttribute("aria-pressed", String(d.hold));
  $("drift-status").textContent = d.hold
    ? "Holding here. The groove keeps turning."
    : "Released. It’s wandering again.";
};
function uniqueName(base) {
  if (!Object.hasOwn(library, base)) return base;
  let n = 2;
  while (Object.hasOwn(library, `${base} ${n}`)) n++;
  return `${base} ${n}`;
}
function preserveOriginal() {
  if (!Object.values(library).includes(lastApplied))
    library[uniqueName(song.title)] = lastApplied;
}
$("capture").onclick = () => {
  if (!mayReplace()) return;
  const captured = ensureTransport().snapshot(),
    base = captured.title.replace(/(?: — capture| · take \d+)$/, "");
  let take = 1;
  while (Object.hasOwn(library, `${base} · take ${take}`)) take++;
  captured.title = `${base} · take ${take}`;
  captured.muted = [...settings.muted];
  preserveOriginal();
  const text = DW.serialize(captured);
  library[captured.title] = text;
  currentShelfName = captured.title;
  const queue = !!transport.running;
  applyText(text, { queue });
  const ok = saveShelf();
  $("drift-status").textContent = "This take is the new home. Drift is off.";
  status(
    `Cut “${captured.title}” and put it on the platter. The original is untouched on your shelf.` +
      (ok ? "" : " It is kept in memory; export it before closing this tab."),
  );
};
$("restock").onclick = () => {
  const added = restock();
  const ok = saveShelf();
  focusSleeve(Object.keys(library).sort()[0]);
  status(
    (added === 1
      ? "One house record is back on the shelf."
      : `${added} house records are back on the shelf.`) +
      (ok ? "" : " They are kept in memory for this page session."),
  );
};
$("new").onclick = () => {
  if (!mayReplace()) return;
  currentShelfName = null;
  applyText(TEMPLATE);
  setView("score");
  $("editor").focus();
  const start = TEMPLATE.indexOf("Untitled Pressing");
  $("editor").setSelectionRange(start, start + "Untitled Pressing".length);
  status(
    "A blank Pressing is in the score. Apply to hear it; save it to the shelf to keep it.",
  );
};
function download(text, name) {
  const parsed = DW.parse(text);
  if (parsed.errors.length) {
    status("Fix parse errors before exporting.");
    return;
  }
  const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download =
    (name || parsed.song.title || "untitled")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() + ".deadwax";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("download").onclick = () => {
  if (!readEditor()) return;
  download($("editor").value);
  status("Exported the exact editor text.");
};
function sleeveHue(name) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return hash % 360;
}
function renderLibrary() {
  const list = $("library");
  list.replaceChildren();
  const names = Object.keys(library).sort();
  $("shelf-count").textContent =
    names.length + (names.length === 1 ? " record" : " records");
  $("shelf-empty").hidden = !!names.length;
  $("restock-row").hidden = EXAMPLES.every(({ text }) =>
    Object.values(library).includes(text),
  );
  list.hidden = !names.length;
  syncCurrent();
  for (const name of names) {
    const li = document.createElement("li");
    li.className = "sleeve";
    li.dataset.name = name;
    li.style.setProperty("--hue", sleeveHue(name));
    const current = name === currentShelfName && library[name] === lastApplied;
    li.classList.toggle("is-current", current);
    // The cover: a square sleeve with a die-cut hole showing the record's
    // label, in the name's own colour, like the record on the turntable.
    const cover = document.createElement("span");
    cover.className = "sleeve__cover";
    cover.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "sleeve__label";
    cover.append(label);
    const body = document.createElement("div");
    body.className = "sleeve__body";
    const title = document.createElement("h3");
    title.className = "sleeve__title";
    title.textContent = name;
    const meta = document.createElement("p");
    meta.className = "sleeve__meta";
    const p = DW.parse(library[name]);
    if (p.errors.length) meta.textContent = "Needs repair in the Score view";
    else
      meta.append(
        ...[
          `${p.song.tempo} BPM`,
          pretty(p.song.key),
          p.song.meter,
          `${p.song.bars} bar${p.song.bars === 1 ? "" : "s"}`,
          ...(/ · take \d+$/.test(name) ? ["captured"] : []),
        ].flatMap((part, i, all) => {
          // The dot stays with the part before it, so no line starts with one.
          const span = document.createElement("span");
          span.textContent = i < all.length - 1 ? `${part} ·` : part;
          return i ? [" ", span] : [span];
        }),
      );
    body.append(title, meta);
    if (current) {
      const tag = document.createElement("p");
      tag.className = "sleeve__current";
      tag.textContent = "On the platter";
      body.prepend(tag);
    }
    const actions = document.createElement("div");
    actions.className = "sleeve__actions";
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-label", name);
    for (const action of ["load", "rename", "duplicate", "export", "delete"]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className =
        "key key--quiet" +
        (action === "load" ? " sleeve__load" : "") +
        (action === "delete" ? " key--danger" : "");
      b.dataset.action = action;
      b.textContent =
        action === "load"
          ? "Put on"
          : action[0].toUpperCase() + action.slice(1);
      actions.append(b);
    }
    li.append(cover, body, actions);
    list.append(li);
  }
}
function focusSleeve(name, action = "load") {
  const item = [...$("library").children].find(
    (li) => li.dataset.name === name,
  );
  if (item) item.querySelector(`[data-action="${action}"]`)?.focus();
  else $("new").focus();
}
$("save-form").onsubmit = (e) => {
  e.preventDefault();
  const edited = readEditor();
  if (!edited) return;
  const name = $("save-name").value.trim() || edited.title;
  if (
    Object.hasOwn(library, name) &&
    library[name] !== $("editor").value &&
    !confirm(`Replace the saved Pressing “${name}”?`)
  )
    return;
  library[name] = $("editor").value;
  currentShelfName = name;
  const ok = saveShelf();
  status(
    ok
      ? "Saved to your shelf."
      : "Kept in memory for this page session. Export to keep a copy.",
  );
};
$("library").onclick = (e) => {
  const b = e.target.closest("[data-action]"),
    item = b?.closest(".sleeve");
  if (!item) return;
  const name = item.dataset.name,
    text = library[name],
    action = b.dataset.action;
  if (action === "load") {
    if (mayReplace()) {
      currentShelfName = name;
      applyText(text);
      setView("desk");
      status(`“${name}” is on the platter.`);
    }
    return;
  }
  if (action === "export") {
    download(text, name);
    return;
  }
  if (action === "duplicate") {
    const copy = uniqueName(name + " · copy");
    library[copy] = text;
    saveShelf();
    focusSleeve(copy, "rename");
    status(`Duplicated “${name}” without changing the original.`);
    return;
  }
  const actions = item.querySelector(".sleeve__actions");
  actions.hidden = true;
  if (action === "rename") {
    const form = document.createElement("form");
    form.className = "sleeve__rename";
    const input = document.createElement("input");
    input.className = "input";
    input.value = name;
    input.required = true;
    input.maxLength = 160;
    input.setAttribute("aria-label", "New sleeve name");
    const save = document.createElement("button");
    save.className = "key key--quiet";
    save.textContent = "Rename";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "key key--quiet";
    cancel.textContent = "Cancel";
    form.append(input, save, cancel);
    item.append(form);
    input.focus();
    input.select();
    cancel.onclick = () => {
      renderLibrary();
      focusSleeve(name, "rename");
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      const next = input.value.trim();
      if (!next || /[\r\n]/.test(next)) {
        input.setCustomValidity("Enter a single-line name.");
        input.reportValidity();
        return;
      }
      if (next !== name && Object.hasOwn(library, next)) {
        input.setCustomValidity("That name is already on the shelf.");
        input.reportValidity();
        return;
      }
      delete library[name];
      library[next] = text;
      if (currentShelfName === name) currentShelfName = next;
      saveShelf();
      focusSleeve(next, "rename");
      status(`Sleeve renamed to “${next}”.`);
    };
    input.oninput = () => input.setCustomValidity("");
  } else if (action === "delete") {
    const box = document.createElement("div");
    box.className = "sleeve__confirm";
    box.setAttribute("role", "alert");
    const msg = document.createElement("p");
    msg.textContent = `Take “${name}” off the shelf? This can’t be undone.`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "key key--quiet key--danger";
    remove.textContent = "Delete";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "key key--quiet";
    cancel.textContent = "Keep it";
    box.append(msg, remove, cancel);
    item.append(box);
    cancel.focus();
    cancel.onclick = () => {
      renderLibrary();
      focusSleeve(name, "delete");
    };
    remove.onclick = () => {
      const names = Object.keys(library).sort(),
        next = names[names.indexOf(name) + 1] ?? names[names.indexOf(name) - 1];
      delete library[name];
      if (currentShelfName === name) currentShelfName = null;
      saveShelf();
      focusSleeve(next);
      status("Removed from the shelf. The loaded Pressing is unchanged.");
    };
  }
};
async function loadFile(file) {
  if (!file) return;
  if (file.size > 1024 * 1024) {
    status("That file is too large. Pressings must be smaller than 1 MB.");
    return;
  }
  if (!mayReplace()) return;
  try {
    currentShelfName = null;
    if (applyText(await file.text())) {
      setView("desk");
      status(`Read “${file.name}”. It’s on the platter, needle up.`);
    }
  } catch (e) {
    status("Could not read file: " + e.message);
  }
}
$("upload").onclick = () => $("file").click();
$("file").onchange = async () => {
  await loadFile($("file").files[0]);
  $("file").value = "";
};
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (![...(e.dataTransfer?.types ?? [])].includes("Files")) return;
  e.preventDefault();
  dragDepth++;
  document.body.classList.add("is-dragging");
});
window.addEventListener("dragover", (e) => {
  e.preventDefault();
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove("is-dragging");
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("is-dragging");
  loadFile(e.dataTransfer.files[0]);
});
function gistState(state, message) {
  $("gist-panel").dataset.state = state;
  $("gist-message").textContent = message;
  status(message);
}
function gistId(value) {
  const t = value.trim();
  if (/^[a-f0-9]{5,64}$/i.test(t)) return t;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:" || u.hostname !== "gist.github.com")
      return null;
    return (
      u.pathname
        .split("/")
        .filter(Boolean)
        .find((x) => /^[a-f0-9]{20,64}$/i.test(x)) ?? null
    );
  } catch {
    return null;
  }
}
let gistController = null;
function loadGistFile(file) {
  if (file.truncated) {
    gistState(
      "error",
      "GitHub truncated this file. Download it from GitHub, then upload it here. No raw-content endpoint is contacted.",
    );
    return;
  }
  if (typeof file.content !== "string" || file.content.length > 1024 * 1024) {
    gistState(
      "error",
      "The file contents are missing or exceed 1 MB. Download it and upload it here.",
    );
    return;
  }
  if (!mayReplace()) {
    gistState("idle", "");
    return;
  }
  currentShelfName = null;
  if (!applyText(file.content)) {
    gistState(
      "error",
      "This Gist file has parse errors. Repair it in the Score view.",
    );
    return;
  }
  $("gist-files").hidden = true;
  gistState(
    "done",
    `Loaded “${file.filename}” from the Gist. It’s on the platter, needle up.`,
  );
}
async function importGist(value) {
  const id = gistId(value);
  if (!id) {
    gistState("error", "Enter a GitHub Gist URL or hexadecimal ID.");
    return;
  }
  gistController?.abort();
  const controller = new AbortController();
  gistController = controller;
  const timer = setTimeout(() => controller.abort(), 20000);
  $("import-gist").disabled = true;
  $("gist-files").hidden = true;
  gistState("loading", "Asking GitHub for the Gist…");
  try {
    const response = await fetch(
      "https://api.github.com/gists/" + encodeURIComponent(id),
      {
        headers: { Accept: "application/vnd.github+json" },
        signal: controller.signal,
        credentials: "omit",
        redirect: "error",
      },
    );
    if (response.status === 403 || response.status === 429) {
      const reset = Number(response.headers.get("x-ratelimit-reset"));
      gistState(
        "limited",
        "GitHub refused the request or its limit of 60 requests an hour was reached." +
          (reset
            ? " Try again after " +
              new Date(reset * 1000).toLocaleTimeString() +
              ","
            : " Try again later,") +
          " or download the file and drop it here.",
      );
      return;
    }
    if (response.status === 404)
      throw new Error(
        "Gist not found (404). Check the ID and that the Gist is public or unlisted.",
      );
    if (!response.ok)
      throw new Error("GitHub returned HTTP " + response.status + ".");
    const data = await response.json();
    gistFiles = Object.values(data.files ?? {}).filter(
      (f) => f && typeof f.filename === "string",
    );
    if (!gistFiles.length) throw new Error("This Gist has no readable files.");
    const preferred = gistFiles.filter((f) =>
      f.filename.toLowerCase().endsWith(".deadwax"),
    );
    if (preferred.length === 1) loadGistFile(preferred[0]);
    else if (gistFiles.length === 1) loadGistFile(gistFiles[0]);
    else {
      $("gist-choice").replaceChildren(
        ...gistFiles.map((f, i) => new Option(f.filename, String(i))),
      );
      $("gist-files").hidden = false;
      gistState("choose", "This Gist has several files. Choose one to load.");
    }
    const url = new URL(location.href);
    url.searchParams.set("gist", id);
    try {
      history.replaceState(null, "", url);
    } catch {}
  } catch (e) {
    if (controller === gistController)
      gistState(
        "error",
        e.name === "AbortError"
          ? "Gist request timed out or was cancelled. Try again."
          : e.message,
      );
  } finally {
    clearTimeout(timer);
    if (controller === gistController) $("import-gist").disabled = false;
  }
}
$("import-gist").onclick = () => importGist($("gist").value);
$("gist-load").onclick = () => loadGistFile(gistFiles[+$("gist-choice").value]);
$("shortcuts-open").onclick = () => $("shortcuts").showModal();
$("shortcuts").querySelector("form").onsubmit = (e) => {
  e.preventDefault();
  $("shortcuts").close();
};
for (const input of document.querySelectorAll(".knob__input")) {
  input.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    input.focus({ preventScroll: true });
    const x = event.clientX,
      y = event.clientY,
      value = +input.value,
      span = input.max - input.min;
    input.setPointerCapture(event.pointerId);
    const move = (e) => {
      input.value = DW.clamp(
        value + ((y - e.clientY + e.clientX - x) / 180) * span,
        +input.min,
        +input.max,
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const finish = () => {
      input.removeEventListener("pointermove", move);
      input.removeEventListener("pointerup", finish);
      input.removeEventListener("pointercancel", finish);
      if (input.hasPointerCapture(event.pointerId))
        input.releasePointerCapture(event.pointerId);
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    input.addEventListener("pointermove", move);
    input.addEventListener("pointerup", finish);
    input.addEventListener("pointercancel", finish);
  });
}
window.addEventListener("keydown", (e) => {
  if (
    e.target === $("editor") &&
    (e.ctrlKey || e.metaKey) &&
    e.key === "Enter"
  ) {
    e.preventDefault();
    $("apply").click();
    return;
  }
  if (
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    e.target.closest("input,textarea,select,dialog,[contenteditable]")
  )
    return;
  const key = e.key.toLowerCase();
  if (key === " ") {
    if (e.target.closest("button,a")) return;
    e.preventDefault();
    $("play").click();
  } else if (key === "?") {
    $("shortcuts-open").click();
  } else if (key === "d") {
    $("drift").checked = !$("drift").checked;
    $("drift").dispatchEvent(new Event("change"));
  } else if (key === "h") $("home").click();
  else if (key === "k") $("hold").click();
  else if (key === "c") $("capture").click();
  else if (key === "n") $("new").click();
  else if (key === "p" || key === "e" || key === "l")
    setView({ p: "desk", e: "score", l: "shelf" }[key]);
  else if (key === "[" || key === "]") {
    $("wander").value = DW.clamp(
      settings.wander + (key === "]" ? 0.05 : -0.05),
      0,
      1,
    );
    $("wander").dispatchEvent(new Event("input"));
    status("Wander " + Math.round(settings.wander * 100) + "%.");
  } else if (/^[1-8]$/.test(key))
    document.querySelectorAll("[data-direction]")[+key - 1]?.click();
});
if (saved && typeof saved.text === "string") {
  const fallback =
    typeof saved.applied === "string" && !DW.parse(saved.applied).errors.length
      ? saved.applied
      : EXAMPLES[0].text;
  if (typeof saved.shelfName === "string") currentShelfName = saved.shelfName;
  applyText(DW.parse(saved.text).errors.length ? fallback : saved.text);
  if (saved.text !== lastApplied) {
    $("editor").value = saved.text;
    showErrors(DW.parse(saved.text).errors, { reveal: true });
    status("Recovered an unfinished draft. The last valid Pressing is kept.");
  }
  const st = saved.settings;
  if (st && typeof st === "object") {
    for (const k of ["volume", "wander"])
      if (Number.isFinite(st[k])) settings[k] = DW.clamp(st[k], 0, 1);
    if (Number.isInteger(st.seed) && st.seed >= 0 && st.seed <= 4294967295)
      settings.seed = st.seed;
    settings.drift = st.drift === true;
    if (Array.isArray(st.muted))
      settings.muted = new Set(st.muted.filter((p) => parts.includes(p)));
  }
} else applyText(EXAMPLES[0].text);
renderSong();
transportUI();
restoring = false;
persist();
if (!saved) status("Everything is synthesised here, in your browser.");
const gist = new URLSearchParams(location.search).get("gist");
if (gist) {
  $("gist").value = gist;
  setView("shelf");
  importGist(gist);
}
document.addEventListener("visibilitychange", () => {
  if (transport?.running) {
    clearTimeout(transport.timer);
    transport.tick();
  }
});
window.addEventListener("pagehide", () => {
  persist();
  pauseTransport();
});
