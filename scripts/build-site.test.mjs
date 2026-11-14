import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import test from "node:test";
import {
  bitmapPng,
  buildSite,
  collectExperiments,
  discoverExperiments,
  escapeHtml,
  fillTemplate,
  humanise,
  readMetadata,
  renderCard,
  resolveIcon,
} from "./build-site.mjs";

function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), "vibes-build-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  }
  return root;
}

test("a bare index.html gets defaults for every field", () => {
  assert.deepEqual(readMetadata("<p>Hello</p>", "word-clock"), {
    name: "Word clock",
    description: "",
    tags: [],
    listed: true,
    iconHref: undefined,
  });
});

test("reads name, description, tags and icon from standard head tags", () => {
  const html = `<!doctype html><head>
    <title>CIDR helper &middot; Vibes</title>
    <meta content="Subnets &amp; ranges." name="description">
    <meta name='keywords' content=' Network,  calculator ,network,, '>
    <link rel="shortcut icon" href="icon.svg">
  </head><body><meta name="description" content="ignored"></body>`;
  assert.deepEqual(readMetadata(html, "cidr"), {
    name: "CIDR helper",
    description: "Subnets & ranges.",
    tags: ["network", "calculator"],
    listed: true,
    iconHref: "icon.svg",
  });
});

test("title separators, application-name and og:description", () => {
  assert.equal(
    readMetadata("<title>Dead Wax — a room</title>", "x").name,
    "Dead Wax",
  );
  assert.equal(readMetadata("<title>A | B</title>", "x").name, "A");
  assert.equal(
    readMetadata("<title>Self-hosted thing</title>", "x").name,
    "Self-hosted thing",
  );
  const html = `<title>Long title - here</title>
    <meta name="application-name" content="Short">
    <meta property="og:description" content="From Open Graph">`;
  assert.equal(readMetadata(html, "x").name, "Short");
  assert.equal(readMetadata(html, "x").description, "From Open Graph");
});

test("robots noindex unlists an experiment", () => {
  const html = `<meta name="robots" content="noindex, nofollow">`;
  assert.equal(readMetadata(html, "x").listed, false);
});

test("discovery skips tooling, hidden, underscored and index-less folders", () => {
  const root = fixture({
    "alpha/index.html": "",
    "beta/index.html": "",
    "empty/readme.md": "",
    "llm/index.html": "",
    "tmp/index.html": "",
    "scripts/index.html": "",
    ".github/index.html": "",
    "_site/index.html": "",
  });
  try {
    assert.deepEqual(discoverExperiments(root), ["alpha", "beta"]);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("icons prefer icon.svg, then a local or data: favicon", () => {
  const root = fixture({
    "a/index.html": "",
    "a/icon.svg": "<svg/>",
    "b/index.html": "",
    "b/img/fav.png": "",
    "c/index.html": "",
  });
  try {
    assert.equal(resolveIcon(root, "a", "other.png"), "a/icon.svg");
    assert.equal(resolveIcon(root, "b", "./img/fav.png?v=2"), "b/img/fav.png");
    assert.equal(
      resolveIcon(root, "c", "data:image/svg+xml,x"),
      "data:image/svg+xml,x",
    );
    assert.equal(resolveIcon(root, "c", "../favicon.svg"), null);
    assert.equal(resolveIcon(root, "c", "https://example.com/i.png"), null);
    assert.equal(resolveIcon(root, "c", "missing.png"), null);
    assert.equal(resolveIcon(root, "c", undefined), null);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("experiments sort by git date, newest first", () => {
  const root = fixture({
    "old/index.html": "<title>Old</title>",
    "new/index.html": "<title>New</title>",
    "hidden/index.html": '<meta name="robots" content="noindex">',
  });
  const git = (args, date) =>
    execFileSync("git", args, {
      cwd: root,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
    });
  try {
    git(["init", "-q"]);
    git(["add", "old", "hidden"]);
    git(["commit", "-q", "--no-verify", "-m", "old"], "2026-01-01T00:00:00Z");
    git(["add", "new"]);
    git(["commit", "-q", "--no-verify", "-m", "new"], "2026-02-01T00:00:00Z");
    const experiments = collectExperiments(root);
    assert.deepEqual(
      experiments.map((e) => [e.slug, e.updated.toISOString()]),
      [
        ["new", "2026-02-01T00:00:00.000Z"],
        ["old", "2026-01-01T00:00:00.000Z"],
      ],
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("cards escape metadata and omit empty descriptions", () => {
  const card = renderCard({
    slug: "x",
    name: `<b>"Bold"</b>`,
    description: "",
    tags: ["a&b"],
    icon: null,
    updated: new Date("2026-11-14T21:00:00Z"),
  });
  assert.match(card, /&lt;b&gt;&quot;Bold&quot;&lt;\/b&gt;/);
  assert.doesNotMatch(card, /<p>/);
  assert.match(card, /a&amp;b/);
  assert.match(card, /15 Nov 2026/); // Sydney time.
  assert.equal(escapeHtml(`'`), "&#39;");
});

test("fillTemplate replaces only known regions", () => {
  const template =
    "a<!-- build:x -->old<!-- /build:x -->b<!-- build:y --><!-- /build:y -->";
  assert.equal(
    fillTemplate(template, { x: "new" }),
    "a<!-- build:x -->\nnew\n<!-- /build:x -->b<!-- build:y --><!-- /build:y -->",
  );
});

test("PNG icons are valid, opaque and the requested size", () => {
  const png = bitmapPng(["#."], 180);
  assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  assert.equal(png.readUInt32BE(16), 180);
  assert.equal(png.readUInt32BE(20), 180);
  assert.equal(png[25], 2); // RGB, no alpha channel.
  const idat = png.indexOf("IDAT");
  const raw = inflateSync(
    png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)),
  );
  assert.equal(raw.length, 180 * (180 * 3 + 1));
});

test("buildSite renders the homepage and copies only deployable files", () => {
  const root = fixture({
    "index.html":
      "<ul><!-- build:cards --><!-- /build:cards --></ul><!-- build:count --><!-- /build:count -->",
    "sw.js": 'const VERSION = "dev";',
    "README.md": "",
    CNAME: "example.com",
    "app/index.html": "<title>App</title>",
    "app/lib.mjs": "",
    "app/lib.test.mjs": "",
    "app/test.mjs": "",
    "llm/PLAN.md": "",
  });
  const out = path.join(root, "_site");
  try {
    buildSite(root, out);
    const home = readFileSync(path.join(out, "index.html"), "utf8");
    assert.match(home, /href="app\/"/);
    assert.match(home, /\b1 experiment\n/);
    assert.ok(existsSync(path.join(out, "CNAME")));
    assert.ok(existsSync(path.join(out, "app/lib.mjs")));
    assert.ok(existsSync(path.join(out, "icons/apple-touch-icon.png")));
    assert.ok(!existsSync(path.join(out, "app/lib.test.mjs")));
    assert.ok(!existsSync(path.join(out, "app/test.mjs")));
    assert.ok(!existsSync(path.join(out, "README.md")));
    assert.ok(!existsSync(path.join(out, "llm")));
    assert.doesNotMatch(readFileSync(path.join(out, "sw.js"), "utf8"), /"dev"/);
    const [experiment] = JSON.parse(
      readFileSync(path.join(out, "experiments.json"), "utf8"),
    );
    assert.equal(experiment.name, "App");
    assert.equal("listed" in experiment, false);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("humanise turns folder names into titles", () => {
  assert.equal(humanise("dead-wax_v2"), "Dead wax v2");
});
