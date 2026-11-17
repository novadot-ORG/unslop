import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "unslop", "scripts", "story.mjs");
const STEPS_ERROR = /needs <meta name="unslop-steps"/;
const FRAME_ERROR = /unslop-frame must be three numbers/;

// A tiny story page. The meta tag under test is spliced into the head;
// everything else stays the same, so only the meta handling can change the outcome.
const story = (meta) =>
  `<!doctype html><html><head><meta charset="utf-8">${meta}` +
  `<style>body{margin:0;background:#141415;color:#ededed}.card{padding:24px}</style>` +
  `</head><body><div class="card"><h1>Hello</h1></div></body></html>`;

const run = (meta) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-story-"));
  const file = join(dir, "story.html");
  writeFileSync(file, story(meta));
  try {
    return spawnSync(process.execPath, [script, file, "--check"], { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

const pastMeta = (result) => {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed.steps, ["Spacing", "Color"]);
  assert.deepEqual(parsed.frame, [0, 0, 960]);
  return true;
};

test("missing unslop-steps meta fails with a clear error", () => {
  const result = run("");
  assert.equal(result.status, 1);
  assert.match(result.stderr, STEPS_ERROR);
});

test("empty unslop-steps meta fails with a clear error", () => {
  const result = run('<meta name="unslop-steps" content="">');
  assert.equal(result.status, 1);
  assert.match(result.stderr, STEPS_ERROR);
});

const goodMeta = (steps = "Spacing, Color") => `<meta name="unslop-steps" content="${steps}">`;

test("meta tag with content before name is accepted", () => {
  assert.ok(pastMeta(run('<meta content="Spacing, Color" name="unslop-steps">')), "reversed attributes were rejected");
});

test("meta tag with single quotes is accepted", () => {
  assert.ok(pastMeta(run(`<meta name='unslop-steps' content='Spacing, Color'>`)), "single quotes were rejected");
});

test("meta tag with an extra attribute between name and content is accepted", () => {
  assert.ok(pastMeta(run('<meta data-x="1" name="unslop-steps" content="Spacing, Color">')), "extra attribute was rejected");
});

test("uppercase meta tag and attribute names are accepted", () => {
  assert.ok(pastMeta(run('<META NAME="unslop-steps" CONTENT="Spacing, Color">')), "uppercase meta was rejected");
});

const badFrames = [
  ["two numbers", "0 0"],
  ["a non-number", "0 0 abc"],
  ["a zero width", "0 0 0"],
  ["a negative width", "0 0 -960"],
  ["four numbers", "0 0 960 100"],
  ["an empty value", ""],
  ["an infinite number", "0 0 Infinity"],
  ["an overflowing offset", "1e309 0 960"],
  ["an excessive width", "0 0 999999999"],
  ["a subpixel width", "0 0 1e-300"],
];

for (const [label, value] of badFrames) {
  test(`unslop-frame with ${label} fails fast with a clear error`, () => {
    const result = run(`${goodMeta()}<meta name="unslop-frame" content="${value}">`);
    assert.equal(result.status, 1, `expected a fast failure, got status ${result.status}`);
    assert.match(result.stderr, FRAME_ERROR);
    assert.match(result.stderr, new RegExp(`got "${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  });
}

test("a valid unslop-frame is accepted", () => {
  assert.ok(pastMeta(run(`${goodMeta()}<meta name="unslop-frame" content="0 0 960">`)), "valid frame was rejected");
});

test("no unslop-frame tag falls back to the default frame", () => {
  assert.ok(pastMeta(run(goodMeta())), "missing frame tag was rejected");
});

test("commented and scripted meta tags do not replace actual metadata", () => {
  assert.ok(pastMeta(run('<!-- <meta name="unslop-steps" content="Wrong"> -->' + '<script>const fake = \'<meta name="unslop-steps" content="Wrong">\';</script>' + goodMeta())));
});

test("a quoted attribute cannot spoof a real name attribute", () => {
  assert.ok(pastMeta(run('<meta data-note="name=unslop-steps" content="Wrong">' + goodMeta())));
});

test("finite values that overflow derived geometry fail", () => {
  const result = run(goodMeta() + '<meta name="unslop-frame" content="0 -32768 960">');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /oversized|non-finite/);
});

test("unknown CLI flags fail before dependency startup", () => {
  const result = spawnSync(process.execPath, [script, "missing.html", "out.mp4", "--wied"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown option/);
});

test("a FIFO input is rejected without blocking or launching dependencies", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-story-fifo-"));
  try {
    const file = join(dir, "story.html");
    if (spawnSync("mkfifo", [file]).status !== 0) { t.skip("Named pipes are unavailable"); return; }
    const result = spawnSync(process.execPath, [script, file, "--check"], { encoding: "utf8", timeout: 2000, killSignal: "SIGKILL" });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /regular HTML file/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("excessive step counts fail before building a runtime", () => {
  const result = run(goodMeta(Array(65).fill("Color").join(",")));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /at most 64 steps/);
});
