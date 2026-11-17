import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { resolveStoryFile } from "../skills/unslop/scripts/story-path.mjs";

// A root with a sibling whose name starts with the root's, the shape
// the prefix check gets wrong: /tmp/x/site vs /tmp/x/site-private.
const setup = (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "unslop-story-path-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "site");
  const sibling = join(base, "site-private");
  mkdirSync(join(root, "sub"), { recursive: true });
  mkdirSync(sibling, { recursive: true });
  writeFileSync(join(root, "asset.txt"), "asset");
  writeFileSync(join(root, "sub", "inner.txt"), "inner");
  writeFileSync(join(sibling, "secret.txt"), "secret");
  symlinkSync(join(sibling, "secret.txt"), join(root, "link-out"));
  symlinkSync(join(root, "asset.txt"), join(root, "link-in"));
  return { root, sibling };
};

test("serves a file directly under root", (t) => {
  const { root } = setup(t);
  assert.equal(resolveStoryFile(root, "/__story/asset.txt"), join(root, "asset.txt"));
});

test("serves a nested file under root", (t) => {
  const { root } = setup(t);
  assert.equal(resolveStoryFile(root, "/__story/sub/inner.txt"), join(root, "sub", "inner.txt"));
});

test("serves a path that normalizes back inside root", (t) => {
  const { root } = setup(t);
  assert.equal(resolveStoryFile(root, "/__story/sub/../asset.txt"), join(root, "asset.txt"));
});

test("rejects a missing file", (t) => {
  const { root } = setup(t);
  assert.equal(resolveStoryFile(root, "/__story/nope.txt"), null);
});

test("rejects the root itself, which is a directory, not a file", (t) => {
  const { root } = setup(t);
  assert.equal(resolveStoryFile(root, "/__story/"), null);
});

test("rejects a sibling directory whose name starts with the root's", (t) => {
  const { root } = setup(t);
  assert.equal(resolveStoryFile(root, "/__story/../site-private/secret.txt"), null);
});

test("rejects a deeper escape through a nested path", (t) => {
  const { root } = setup(t);
  assert.equal(resolveStoryFile(root, "/__story/sub/../../site-private/secret.txt"), null);
});

test("rejects a symlink inside root that points outside it", (t) => {
  const { root } = setup(t);
  assert.equal(resolveStoryFile(root, "/__story/link-out"), null);
});

test("serves a symlink inside root that points inside it", (t) => {
  const { root } = setup(t);
  assert.equal(resolveStoryFile(root, "/__story/link-in"), join(root, "asset.txt"));
});

test("rejects a nested directory", (t) => {
  const { root } = setup(t);
  assert.equal(resolveStoryFile(root, "/__story/sub"), null);
});

test("requires the story route prefix", (t) => {
  const { root } = setup(t);
  for (const path of ["/asset.txt", "/__story", "/__story-other/asset.txt"]) {
    assert.equal(resolveStoryFile(root, path), null);
  }
});

test("rejects malformed path types, NULs and backslashes", (t) => {
  const { root } = setup(t);
  for (const path of [null, 1, "/__story/asset.txt\0", "/__story/sub\\inner.txt"]) {
    assert.equal(resolveStoryFile(root, path), null);
  }
});

test("rejects hidden files and files under hidden directories", (t) => {
  const { root } = setup(t);
  mkdirSync(join(root, ".private"));
  writeFileSync(join(root, ".env"), "dummy=fixture");
  writeFileSync(join(root, ".private", "asset.txt"), "private");
  assert.equal(resolveStoryFile(root, "/__story/.env"), null);
  assert.equal(resolveStoryFile(root, "/__story/.private/asset.txt"), null);
});

test("rejects aliases into hidden files", (t) => {
  const { root } = setup(t);
  writeFileSync(join(root, ".env"), "dummy=fixture");
  symlinkSync(join(root, ".env"), join(root, "public.css"));
  assert.equal(resolveStoryFile(root, "/__story/public.css"), null);
});

test("rejects a named pipe without reading or blocking", { skip: process.platform === "win32" }, (t) => {
  const { root } = setup(t);
  execFileSync("mkfifo", [join(root, "pipe.css")]);
  assert.equal(resolveStoryFile(root, "/__story/pipe.css"), null);
});
