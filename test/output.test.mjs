import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, linkSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOutputSession } from "../skills/unslop/scripts/output.mjs";

const fixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), "unslop-output-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};

test("competing writers fail without altering the first writer or existing output", (t) => {
  const root = fixture(t);
  const out = join(root, "result.html");
  writeFileSync(out, "original");
  const first = createOutputSession([out]);
  try {
    assert.throws(() => createOutputSession([out]), /locked by another run/);
    assert.equal(readFileSync(out, "utf8"), "original");
    writeFileSync(first.staged[0], "complete");
    first.commit();
    assert.equal(readFileSync(out, "utf8"), "complete");
  } finally { first.cleanup(); }
  assert.deepEqual(readdirSync(root), ["result.html"]);
});

test("independent outputs can be generated concurrently and use different workspaces", (t) => {
  const root = fixture(t);
  const a = createOutputSession([join(root, "a.mp4")]);
  const b = createOutputSession([join(root, "b.mp4")]);
  try {
    assert.notEqual(a.staged[0], b.staged[0]);
    writeFileSync(a.staged[0], "A"); writeFileSync(b.staged[0], "B");
    b.commit(); a.commit();
    assert.equal(readFileSync(join(root, "a.mp4"), "utf8"), "A");
    assert.equal(readFileSync(join(root, "b.mp4"), "utf8"), "B");
  } finally { a.cleanup(); b.cleanup(); }
});

test("input, hardlink and symlink outputs cannot destroy source content", (t) => {
  const root = fixture(t);
  const source = join(root, "source.html");
  const hardlink = join(root, "hardlink.html");
  const symlink = join(root, "symlink.html");
  writeFileSync(source, "preserve"); linkSync(source, hardlink); symlinkSync(source, symlink);
  for (const out of [source, hardlink, symlink]) assert.throws(() => createOutputSession([out], source), /input file|symlink/);
  assert.equal(readFileSync(source, "utf8"), "preserve");
  assert.ok(!existsSync(source + ".unslop-lock"));
});

test("failed multi-output reservation releases locks already acquired", (t) => {
  const root = fixture(t);
  const a = join(root, "a.html"), b = join(root, "b.png");
  const held = createOutputSession([b]);
  try { assert.throws(() => createOutputSession([a, b]), /locked/); }
  finally { held.cleanup(); }
  assert.deepEqual(readdirSync(root), []);
});

test("failed generation leaves original output intact and cleanup is idempotent", (t) => {
  const root = fixture(t);
  const out = join(root, "out.mp4"); writeFileSync(out, "old");
  const session = createOutputSession([out]);
  assert.throws(() => session.commit());
  session.cleanup(); session.cleanup();
  assert.equal(readFileSync(out, "utf8"), "old");
  assert.deepEqual(readdirSync(root), ["out.mp4"]);
});
