import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { closeBrowser, launchBrowser } from "../skills/unslop/scripts/browser.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "unslop", "scripts", "snapshot.mjs");
const USAGE = /usage: node snapshot\.mjs/;
const NO_BROWSER = /Playwright is not installed|Executable doesn't exist/;

const page = `<!doctype html><html><head><meta charset="utf-8">` + `<style>body{margin:0;background:#141415;color:#ededed}.card{padding:24px}</style>` + `</head><body><div class="card"><h1>Hello</h1></div></body></html>`;

const fixtures = [];
after(() => { for (const dir of fixtures) rmSync(dir, { recursive: true, force: true }); });
const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "unslop-snapshot-"));
  fixtures.push(dir);
  const file = join(dir, "page.html");
  writeFileSync(file, page);
  return { dir, file };
};

const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 80_000, killSignal: "SIGKILL" });

// A run that needs a real browser: skip instead of failing when this
// machine has no Playwright or Chromium to launch. Returns true when it
// skipped, so the test must return right after calling it — t.skip() marks
// the test skipped but does not stop the test function.
const skipIfNoBrowser = (t, result) => {
  if (NO_BROWSER.test(result.stderr ?? "")) {
    t.skip("Playwright or Chromium is not installed here");
    return true;
  }
  return false;
};

const pngSize = (file) => {
  const bytes = readFileSync(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

test("no arguments prints the usage and exits 1", () => {
  const result = run([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, USAGE);
});

const badSizes = [
  ["--width=abc", "a non-number width"],
  ["--width=0", "a zero width"],
  ["--width=-5", "a negative width"],
  ["--width=1.5", "a fractional width"],
  ["--height=abc", "a non-number height"],
  ["--height=0", "a zero height"],
];

for (const [flag, label] of badSizes) {
  test(`${label} (${flag}) fails with a clear error, not a stack trace`, () => {
    const { file } = fixture();
    const result = run([`file://${file}`, "out.html", flag]);
    assert.equal(result.status, 1, `expected a fast failure, got status ${result.status}`);
    assert.match(result.stderr, /must be a whole number above 0/);
    assert.doesNotMatch(result.stderr, /browser\.newPage/);
  });
}

test("--width with no value fails with a clear error", () => {
  const { file } = fixture();
  const result = run([`file://${file}`, "out.html", "--width"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--width needs a value/);
});

test("a local file path is snapshotted, not rejected as an invalid URL", (t) => {
  const { dir, file } = fixture();
  const out = join(dir, "out.html");
  const result = run([file, out]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(out), "saved html is missing");
  assert.ok(existsSync(join(dir, "out.live.png")), "live screenshot is missing");
  assert.deepEqual(pngSize(join(dir, "out.live.png")), { width: 1440, height: 810 });
});

test("--width 800 in space form sets the viewport to 800 wide", (t) => {
  const { dir, file } = fixture();
  const out = join(dir, "out.html");
  const result = run([`file://${file}`, out, "--width", "800"]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /saved .*out\.html\n?$/);
  assert.doesNotMatch(result.stdout, /as 800/, "800 leaked into the pass label instead of the width");
  assert.deepEqual(pngSize(join(dir, "out.live.png")), { width: 800, height: 810 });
});

test("--width=800 in equals form still sets the viewport to 800 wide", (t) => {
  const { dir, file } = fixture();
  const out = join(dir, "out.html");
  const result = run([`file://${file}`, out, "--width=800"]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(pngSize(join(dir, "out.live.png")), { width: 800, height: 810 });
});

test("--height 600 in space form sets the viewport height", (t) => {
  const { dir, file } = fixture();
  const out = join(dir, "out.html");
  const result = run([`file://${file}`, out, "--height", "600"]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(pngSize(join(dir, "out.live.png")), { width: 1440, height: 600 });
});

for (const flags of [["--widh", "800"], ["--dark", "--light"], ["--width", "999999999"], ["--timeout", "0"]]) {
  test(`invalid options fail explicitly: ${flags.join(" ")}`, () => {
    const { dir, file } = fixture();
    const result = run([file, join(dir, "out.html"), ...flags]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown option|only one|at most 8192|--timeout/);
  });
}

test("snapshot refuses input overwrite and preserves the original file", () => {
  const { dir, file } = fixture();
  const result = run([file, file]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /overwrite the input/);
  assert.equal(readFileSync(file, "utf8"), page);
  assert.deepEqual(readdirSync(dir), ["page.html"]);
});

test("saved snapshots remove active content and enforce script blocking when reopened", async (t) => {
  const { dir, file } = fixture();
  writeFileSync(file, `<!doctype html><html onclick="window.compromised=1"><head><meta http-equiv="refresh" content="999;url=https://example.invalid"><style>body{margin:0;color:#222;background:#f4f2ec}</style></head><body>
    <h1 id="top">Capture test</h1><a id="jump" href="#top">Jump to heading</a><a id="bad" href="javascript:window.compromised=1" onclick="window.compromised=1">Unsafe action</a>
    <iframe srcdoc="<script>window.parent.compromised=1</script>"></iframe>
    <form action="https://example.invalid"><button formaction="https://example.invalid">Submit</button></form>
    <svg><a xlink:href="javascript:window.compromised=1"><text>Label</text></a></svg>
  </body></html>`);
  const out = join(dir, "safe.html");
  const result = run([file, out, "--light"]);
  if (skipIfNoBrowser(t, result)) return;
  assert.equal(result.status, 0, result.stderr);
  const saved = readFileSync(out, "utf8");
  assert.doesNotMatch(saved, /<iframe|javascript:|\sonclick=|\sformaction=|\saction=|http-equiv="refresh"/i);
  assert.match(saved, /script-src 'none'/);
  assert.match(saved, /id="jump" href="#top"/);
  const { chromium } = await import("playwright");
  const chrome = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((path) => path && existsSync(path));
  const browser = await launchBrowser(chromium, chrome ? { executablePath: chrome } : {});
  try {
    const tab = await browser.newPage();
    await tab.goto(`file://${out}`);
    await tab.locator("#bad").click();
    await tab.locator("#jump").click();
    assert.equal(new URL(tab.url()).hash, "#top");
    await tab.evaluate(() => {
      const script = document.createElement("script"); script.textContent = "window.compromised=1"; document.head.appendChild(script);
    });
    assert.equal(await tab.evaluate(() => window.compromised), undefined);
    assert.equal(await tab.locator("h1").textContent(), "Capture test");
  } finally { await closeBrowser(browser); }
});

test("a stalled page hits its deadline without publishing partial output or leaving locks", async () => {
  const { dir } = fixture();
  const out = join(dir, "out.html");
  writeFileSync(out, "prior result");
  const server = createServer((request, response) => {
    if (request.url === "/") response.end('<!doctype html><html><head><link rel="stylesheet" href="/never.css"></head><body>Wait</body></html>');
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try {
    await assert.rejects(promisify(execFile)(process.execPath, [script, `http://127.0.0.1:${server.address().port}`, out, "--timeout", "1000"], { timeout: 15_000, killSignal: "SIGKILL" }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /timed out after 1000 milliseconds/);
      return true;
    });
    assert.equal(readFileSync(out, "utf8"), "prior result");
    assert.deepEqual(readdirSync(dir).sort(), ["out.html", "page.html"]);
  } finally { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
});

test("a hostile source realm cannot replace the sanitizer or its CSP", () => {
  const { dir, file } = fixture();
  writeFileSync(file, `<!doctype html><html><head><style>body{color:#222}</style></head><body><h1>Real content</h1>
  <script>
    document.documentElement.cloneNode = () => ({
      attributes: [], querySelectorAll: () => [],
      querySelector: () => ({appendChild(){}, prepend(){}}),
      get outerHTML(){ return '<html><head></head><body><script>window.pwned=true<\\/script></body></html>'; }
    });
  </script></body></html>`);
  const out = join(dir, "out.html");
  const result = run([file, out]);
  assert.equal(result.status, 0, result.stderr);
  const saved = readFileSync(out, "utf8");
  assert.match(saved, /Real content/);
  assert.match(saved, /script-src 'none'/);
  assert.doesNotMatch(saved, /window\.pwned|<script/i);
});
