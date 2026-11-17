import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createConnection } from "node:net";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStoryServer } from "../skills/unslop/scripts/story-server.mjs";

async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "unslop-server-"));
  const root = join(dir, "site");
  mkdirSync(join(root, "assets"), { recursive: true });
  const file = join(root, "story.html");
  writeFileSync(file, "<h1>story</h1>");
  writeFileSync(join(root, "assets", "style.css"), "body { color: red }");
  writeFileSync(join(root, "app.js"), "window.fixture = true;");
  writeFileSync(join(root, "other.html"), "private sibling HTML");
  writeFileSync(join(root, ".env"), "DUMMY=not-a-secret");
  writeFileSync(join(root, "config.json"), '{"dummy":"fixture"}');
  writeFileSync(join(root, "private.pem"), "dummy fixture");
  writeFileSync(join(dir, "outside.css"), "outside");
  symlinkSync(join(dir, "outside.css"), join(root, "escape.css"));
  symlinkSync(join(root, ".env"), join(root, "alias.css"));
  symlinkSync(join(root, "assets", "style.css"), join(root, "linked.css"));
  const server = await startStoryServer({ root, file, stage: '<iframe src="__story/story.html"></iframe>' });
  t.after(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { ...server, root, url: new URL(server.base) };
}

function get(server, suffix, { method = "GET", headers = {}, raw = false } = {}) {
  return new Promise((done, fail) => {
    const req = request({
      hostname: server.url.hostname, port: server.url.port,
      path: raw ? suffix : `${server.url.pathname}${suffix}`,
      method, headers,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => done({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
      response.on("error", fail);
    });
    req.on("error", fail);
    req.setTimeout(5000, () => req.destroy(new Error("story-server request timed out")));
    req.end();
  });
}

test("serves the stage, main HTML and normal nested assets with protective headers", async (t) => {
  const server = await setup(t);
  const stage = await get(server, "/__stage.html");
  assert.equal(stage.status, 200);
  assert.match(stage.body, /iframe/);
  assert.equal(stage.headers["x-content-type-options"], "nosniff");
  assert.equal(stage.headers["referrer-policy"], "no-referrer");
  assert.equal(stage.headers["cross-origin-resource-policy"], "same-origin");
  assert.equal(stage.headers["x-frame-options"], "SAMEORIGIN");
  assert.match(stage.headers["content-security-policy"], /frame-ancestors 'self'/);
  assert.equal((await get(server, "/__story/story.html")).body, "<h1>story</h1>");
  for (const asset of ["assets/style.css", "app.js", "linked.css"]) {
    assert.equal((await get(server, `/__story/${asset}`)).status, 200, asset);
  }
});

test("denies hidden, configuration, sibling HTML, directory and escaping symlink paths", async (t) => {
  const server = await setup(t);
  for (const asset of [".env", "%2eenv", "config.json", "private.pem", "other.html", "assets", "escape.css", "alias.css", "missing.css", "../outside.css", "..%2foutside.css"]) {
    assert.equal((await get(server, `/__story/${asset}`)).status, 404, asset);
  }
  assert.equal((await get(server, "/__stage.html")).status, 200);
});

test("rejects invalid routes, missing or incorrect tokens and unexpected host/origin", async (t) => {
  const server = await setup(t);
  for (const path of ["/__stage.html", "/wrong-token/__stage.html", `${server.url.pathname}-extra/__stage.html`]) {
    assert.equal((await get(server, path, { raw: true })).status, 404, path);
  }
  assert.equal((await get(server, "/app.js")).status, 404);
  assert.equal((await get(server, "/__stage.html", { headers: { host: "attacker.invalid" } })).status, 404);
  assert.equal((await get(server, "/__stage.html", { headers: { origin: "https://attacker.invalid" } })).status, 403);
});

test("malformed percent escapes and invalid characters do not crash the server", async (t) => {
  const server = await setup(t);
  for (const path of ["/__story/%", "/__story/%E0%A4%A", "/__story/a%00.css", "/__story/sub%5cstyle.css"]) {
    assert.equal((await get(server, path)).status, 400, path);
  }
  assert.equal((await get(server, "/__story/app.js")).status, 200);
});

test("HEAD returns GET headers with no body and non-read methods are denied", async (t) => {
  const server = await setup(t);
  const response = await get(server, "/__story/app.js", { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.equal(response.body, "");
  assert.equal(Number(response.headers["content-length"]), Buffer.byteLength("window.fixture = true;"));
  const denied = await get(server, "/__stage.html", { method: "POST" });
  assert.equal(denied.status, 405);
  assert.equal(denied.headers.allow, "GET, HEAD");
});

test("missing assets after startup return 404 and the next request still succeeds", async (t) => {
  const server = await setup(t);
  rmSync(join(server.root, "app.js"));
  assert.equal((await get(server, "/__story/app.js")).status, 404);
  assert.equal((await get(server, "/__stage.html")).status, 200);
});

test("each server receives a different route token and cannot use another server's token", async (t) => {
  const first = await setup(t);
  const second = await setup(t);
  assert.notEqual(first.url.pathname, second.url.pathname);
  assert.match(first.url.pathname, /^\/[a-f0-9]{48}$/);
  assert.equal((await get(second, `${first.url.pathname}/__stage.html`, { raw: true })).status, 404);
});

test("close is idempotent and terminates an active incomplete connection", { timeout: 5000 }, async (t) => {
  const server = await setup(t);
  const socket = createConnection({ host: server.url.hostname, port: server.url.port });
  await new Promise((done, fail) => { socket.once("connect", done); socket.once("error", fail); });
  const closed = new Promise((done) => socket.once("close", done));
  socket.write("GET / HTTP/1.1\r\n");
  await server.close();
  await server.close();
  await closed;
});
