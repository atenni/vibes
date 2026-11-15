// Build the deployable site into _site/: copy the repository, render the
// homepage cards from each experiment's own <head>, and generate PWA icons.
// Experiment folders are copied unchanged.
//
// Usage: node scripts/build-site.mjs [output directory]
//
// No dependencies. Every metadata field has a default, so a folder containing
// only an index.html is a valid experiment.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";

const ROOT = path.resolve(import.meta.dirname, "..");

// Top-level folders that are never experiments or deployed.
const SKIP_DIRS = new Set(["llm", "tmp", "scripts", "node_modules"]);
// Root files that are repository tooling rather than site content.
const SKIP_ROOT_FILES = new Set(["README.md", "AGENTS.md"]);
// Files `node --test` would discover; keep them out of the output so tests run
// once and Node-only test code is not published.
const NODE_TEST_FILE = /^(test|test-.+|.+[.\-_]test)\.[cm]?[jt]s$/;

const TIME_ZONE = "Australia/Sydney";
// Commit links on the homepage and in experiment footers point here.
const REPO_URL = "https://github.com/atenni/vibes";

// ---------------------------------------------------------------- metadata

// prettier-ignore
const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·",
  mdash: "—", ndash: "–", hellip: "…", times: "×", copy: "©", rsquo: "’",
  lsquo: "‘", rdquo: "”", ldquo: "“",
};

export function decodeEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const code =
        entity[1].toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function parseAttributes(tag) {
  const attributes = {};
  const pattern = /([^\s=<>/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (const [, name, double, single, bare] of tag.matchAll(pattern)) {
    attributes[name.toLowerCase()] = decodeEntities(double ?? single ?? bare);
  }
  return attributes;
}

/** "dead-wax" → "Dead wax" */
export function humanise(slug) {
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Read homepage metadata from standard <head> tags.
 *
 * - name: <meta name="application-name">, else <title> up to the first
 *   " · ", " — ", " – ", " | " or " - ", else the folder name.
 * - description: <meta name="description">, else og:description, else "".
 * - tags: comma-separated <meta name="keywords">, else [].
 * - listed: false when <meta name="robots"> contains "noindex".
 * - iconHref: the first <link rel="icon"> href, if any.
 */
export function readMetadata(html, slug) {
  const head = html.split(/<\/head>/i)[0];
  const rawTitle = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const title = decodeEntities(rawTitle).replace(/\s+/g, " ").trim();
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) =>
    parseAttributes(m[0]),
  );
  const meta = (key) =>
    metas
      .find((m) => (m.name ?? m.property)?.toLowerCase() === key)
      ?.content?.replace(/\s+/g, " ")
      .trim() ?? "";
  const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) =>
    parseAttributes(m[0]),
  );
  const icon = links.find((link) =>
    link.rel?.toLowerCase().split(/\s+/).includes("icon"),
  );
  const shortTitle = title.split(/\s+[·—–|-]\s+/)[0].trim();

  return {
    name: meta("application-name") || shortTitle || humanise(slug),
    description: meta("description") || meta("og:description"),
    tags: [
      ...new Set(
        meta("keywords")
          .split(",")
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean),
      ),
    ],
    listed: !/\bnoindex\b/i.test(meta("robots")),
    iconHref: icon?.href,
  };
}

/** Top-level folders with an index.html, alphabetically. */
export function discoverExperiments(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !isSkippedName(entry.name) &&
        existsSync(path.join(root, entry.name, "index.html")),
    )
    .map((entry) => entry.name)
    .sort();
}

function isSkippedName(name) {
  return name.startsWith(".") || name.startsWith("_") || SKIP_DIRS.has(name);
}

/**
 * Card icon URL relative to the site root, or null for a generated pixel icon.
 * Prefers icon.svg/icon.png in the folder, then the page's own favicon when it
 * is a data: URI or a file inside the folder.
 */
export function resolveIcon(root, slug, iconHref) {
  for (const file of ["icon.svg", "icon.png"]) {
    if (existsSync(path.join(root, slug, file))) return `${slug}/${file}`;
  }
  if (!iconHref) return null;
  if (/^data:image\//i.test(iconHref)) return iconHref;
  if (/^([a-z][a-z\d+.-]*:|\/|\.\.)/i.test(iconHref)) return null;
  const relative = path.posix.normalize(iconHref.split(/[?#]/)[0]);
  if (relative.startsWith("..")) return null;
  return existsSync(path.join(root, slug, relative))
    ? `${slug}/${relative}`
    : null;
}

/**
 * The last commit touching the folder: its author date and full SHA. Outside
 * a git checkout, or for uncommitted folders, the date falls back to the
 * index.html mtime and the SHA is null.
 */
export function lastCommit(root, slug) {
  try {
    const [sha, date] = execFileSync(
      "git",
      ["log", "-1", "--format=%H %aI", "--", slug],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    )
      .trim()
      .split(" ");
    if (sha && date) return { sha, updated: new Date(date) };
  } catch {
    // Not a git checkout, or git is unavailable: fall back to the file system.
  }
  return {
    sha: null,
    updated: statSync(path.join(root, slug, "index.html")).mtime,
  };
}

/** Link to a commit on GitHub, or null without one. */
export function commitUrl(sha) {
  return sha ? `${REPO_URL}/commit/${sha}` : null;
}

export function collectExperiments(root) {
  return discoverExperiments(root)
    .map((slug) => {
      const html = readFileSync(path.join(root, slug, "index.html"), "utf8");
      const { iconHref, ...metadata } = readMetadata(html, slug);
      return {
        slug,
        ...metadata,
        icon: resolveIcon(root, slug, iconHref),
        ...lastCommit(root, slug),
      };
    })
    .filter((experiment) => experiment.listed)
    .sort((a, b) => b.updated - a.updated || a.name.localeCompare(b.name));
}

// --------------------------------------------------------------- rendering

// prettier-ignore
const PIXEL_ICONS = {
  network: ["..###..", "..#.#..", "..###..", "...#...", ".#####.", ".#...#.", "###.###", "#.#.#.#", "###.###"],
  music: ["....###.", "....#.##", "....#...", "....#...", "..###...", ".####...", ".###....", "........"],
  time: ["..####..", ".#..#.#.", "#...#..#", "#...##.#", "#......#", "#......#", ".#....#.", "..####.."],
  text: ["######..", "#....##.", "#.##..#.", "#.....#.", "#.#####.", "#.....#.", "#.###.#.", "#######."],
  colour: ["...#....", "..###...", ".#####..", ".#####..", "#######.", "#######.", ".#####..", "..###..."],
  game: ["########", "#......#", "#.#..#.#", "#......#", "#......#", "#.#..#.#", "#......#", "########"],
  maths: ["#######", "#.....#", "#######", "#.#.#.#", "#######", "#.#.#.#", "#######", "#.#.#.#", "#######"],
  generic: ["########", "#.#.#..#", "########", "#......#", "#.##...#", "#......#", "#.####.#", "########"],
};
const ICON_ALIASES = {
  audio: "music",
  sound: "music",
  calculator: "maths",
  math: "maths",
  color: "colour",
  design: "colour",
  clock: "time",
  writing: "text",
  dns: "network",
};
// prettier-ignore
const TINTS = ["#cfe6f5", "#f6d9b8", "#f3efb0", "#e4dcf5", "#f6cfd6", "#cdeccf", "#dfe3e8"];

/** 15×15 Vibes "V", shared by the menu bar logo and the PWA icons. */
export const LOGO = [
  "...............",
  "...............",
  "...............",
  "...##.....##...",
  "...##.....##...",
  "...##.....##...",
  "...###...###...",
  "....##...##....",
  "....###.###....",
  ".....##.##.....",
  ".....#####.....",
  "......###......",
  "...............",
  "...............",
  "...............",
];
const LOGO_BACKGROUND = [0x20, 0x36, 0x2a];
const LOGO_INK = [0xa6, 0xe7, 0xbd];

export function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function pixelSvg(rows, size) {
  const height = rows.length;
  const width = Math.max(...rows.map((row) => row.length));
  // One horizontal run per path segment keeps the markup small.
  const path = rows
    .flatMap((row, y) =>
      [...row.matchAll(/#+/g)].map(
        (run) => `M${run.index} ${y}h${run[0].length}v1h-${run[0].length}z`,
      ),
    )
    .join("");
  return `<svg viewBox="-1 -1 ${width + 2} ${height + 2}" width="${size}" height="${size}" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><path d="${path}"/></svg>`;
}

function stableIndex(text, length) {
  let hash = 0;
  for (const character of text)
    hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  return hash % length;
}

export function iconFor(experiment) {
  if (experiment.icon) {
    return `<img src="${escapeHtml(experiment.icon)}" alt="" width="40" height="40" />`;
  }
  const key = experiment.tags
    .map((tag) => ICON_ALIASES[tag] ?? tag)
    .find((tag) => tag in PIXEL_ICONS);
  return pixelSvg(PIXEL_ICONS[key ?? "generic"], 36);
}

export function tintFor(experiment) {
  return TINTS[
    stableIndex(experiment.tags[0] ?? experiment.slug, TINTS.length)
  ];
}

const dateFormat = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: TIME_ZONE,
});

export function renderCard(experiment) {
  const tags = experiment.tags
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");
  const description = experiment.description
    ? `<p>${escapeHtml(experiment.description)}</p>`
    : "";
  return `<li data-name="${escapeHtml(experiment.name)}" data-updated="${experiment.updated.getTime()}" data-tags="${escapeHtml(experiment.tags.join(" "))}">
          <a class="card" href="${escapeHtml(experiment.slug)}/" style="--tile: ${tintFor(experiment)}">
            <span class="icon">${iconFor(experiment)}</span>
            <div class="body">
              <h2>${escapeHtml(experiment.name)}</h2>
              ${description}
              <div class="tags"><span class="tag fresh" hidden>Updated</span>${tags}</div>
              <span class="meta">Updated <time datetime="${experiment.updated.toISOString()}">${dateFormat.format(experiment.updated)}</time>${experiment.sha ? ` · <code>${experiment.sha.slice(0, 7)}</code>` : ""}</span>
            </div>
          </a>
        </li>`;
}

export function renderFilters(experiments) {
  const counts = new Map();
  for (const tag of experiments.flatMap((e) => e.tags)) {
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const tags = [...counts].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  return [
    '<button class="chip" type="button" aria-pressed="true" data-tag="">all</button>',
  ]
    .concat(
      tags.map(
        ([tag]) =>
          `<button class="chip" type="button" aria-pressed="false" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`,
      ),
    )
    .join("\n          ");
}

/** Replace each <!-- build:name -->…<!-- /build:name --> region. */
export function fillTemplate(template, regions) {
  return template.replace(
    /(<!-- build:([\w-]+) -->)[\s\S]*?(<!-- \/build:\2 -->)/g,
    (match, open, name, close) =>
      name in regions ? `${open}\n${regions[name]}\n${close}` : match,
  );
}

export function renderHomepage(template, experiments) {
  const count = experiments.length;
  return fillTemplate(template, {
    filters: renderFilters(experiments),
    cards: experiments.map(renderCard).join("\n"),
    count: `${count} experiment${count === 1 ? "" : "s"}`,
    logo: pixelSvg(
      LOGO.slice(2, -2).map((row) => row.slice(2, -2)),
      20,
    ),
  });
}

// --------------------------------------------------------------- PNG icons

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** Opaque RGB PNG of a pixel bitmap, scaled to whole pixels and centred. */
export function bitmapPng(
  rows,
  size,
  ink = LOGO_INK,
  background = LOGO_BACKGROUND,
) {
  const cells = rows.length;
  const unit = Math.floor(size / cells);
  const offset = Math.floor((size - unit * cells) / 2);
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1); // Filter byte 0 (none) per row.
    for (let x = 0; x < size; x++) {
      const cx = Math.floor((x - offset) / unit);
      const cy = Math.floor((y - offset) / unit);
      const lit = rows[cy]?.[cx] === "#";
      const colour = lit ? ink : background;
      raw.set(colour, rowStart + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, deflate, no filter, no interlace.
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------- build

function copyTree(source, target, isRoot = false) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (isSkippedName(entry.name)) continue;
    if (isRoot && entry.isFile() && SKIP_ROOT_FILES.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile() && !NODE_TEST_FILE.test(entry.name))
      copyFileSync(from, to);
  }
}

export function buildSite(root = ROOT, out = path.join(root, "_site")) {
  rmSync(out, { recursive: true, force: true });
  copyTree(root, out, true);

  const experiments = collectExperiments(root);
  const template = readFileSync(path.join(root, "index.html"), "utf8");
  writeFileSync(
    path.join(out, "index.html"),
    renderHomepage(template, experiments),
  );

  mkdirSync(path.join(out, "icons"), { recursive: true });
  for (const [name, size] of [
    ["apple-touch-icon.png", 180],
    ["icon-192.png", 192],
    ["icon-512.png", 512],
  ]) {
    writeFileSync(path.join(out, "icons", name), bitmapPng(LOGO, size));
  }

  writeFileSync(
    path.join(out, "experiments.json"),
    `${JSON.stringify(
      experiments.map(({ listed, ...experiment }) => ({
        ...experiment,
        url: commitUrl(experiment.sha),
      })),
      null,
      2,
    )}\n`,
  );

  // A content hash names the shell cache so each deploy refreshes it.
  const hash = createHash("sha256");
  for (const file of [
    "index.html",
    "manifest.webmanifest",
    "experiments.json",
  ]) {
    if (existsSync(path.join(out, file)))
      hash.update(readFileSync(path.join(out, file)));
  }
  const swPath = path.join(out, "sw.js");
  if (existsSync(swPath)) {
    const sw = readFileSync(swPath, "utf8");
    hash.update(sw);
    writeFileSync(
      swPath,
      sw.replace(
        /const VERSION = "[^"]*";/,
        `const VERSION = "${hash.digest("hex").slice(0, 12)}";`,
      ),
    );
  }

  return experiments;
}

if (import.meta.main) {
  const out = path.resolve(process.argv[2] ?? path.join(ROOT, "_site"));
  const experiments = buildSite(ROOT, out);
  console.log(
    `Built ${path.relative(process.cwd(), out) || "."} with ${experiments.length} experiment(s): ${experiments.map((e) => e.slug).join(", ")}`,
  );
}
