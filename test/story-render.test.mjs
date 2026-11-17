import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "unslop", "scripts", "story.mjs");
const execute = promisify(execFile);

test("failed browser startup preserves existing frame directories and cleans temporary output", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "unslop-story-failure-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "story.html");
  mkdirSync(join(root, ".story-frames")); writeFileSync(join(root, ".story-frames", "keep.txt"), "keep");
  writeFileSync(file, '<!doctype html><html><head><meta name="unslop-steps" content="Color"></head><body>Test</body></html>');
  const out = join(root, "out.mp4");
  const result = spawnSync(process.execPath, [script, file, out], { encoding: "utf8", timeout: 15_000, killSignal: "SIGKILL", env: { ...process.env, CHROME_PATH: process.execPath } });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(readFileSync(join(root, ".story-frames", "keep.txt"), "utf8"), "keep");
  assert.ok(!existsSync(out));
  assert.deepEqual(readdirSync(root).sort(), [".story-frames", "story.html"]);
});

test("concurrent square and wide renders produce valid videos without sharing frames or executing labels", { timeout: 300_000 }, async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0 || spawnSync("ffprobe", ["-version"]).status !== 0) {
    t.skip("ffmpeg and ffprobe are required for the video integration test"); return;
  }
  try { await import("playwright"); } catch { t.skip("Playwright is required for the video integration test"); return; }
  const root = mkdtempSync(join(tmpdir(), "unslop-story-render-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const temp = join(root, "temporary"); mkdirSync(temp);
  const marker = join(root, ".story-frames"); mkdirSync(marker); writeFileSync(join(marker, "keep.txt"), "keep");
  let unexpectedRequests = 0;
  const observer = createServer((request, response) => { unexpectedRequests++; response.end("unexpected"); });
  await new Promise((done) => observer.listen(0, "127.0.0.1", done));
  const file = join(root, "story.html");
  writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><meta name="unslop-steps" content="Color"><meta name="unslop-frame" content="0 0 960">
    <style>body{margin:0;padding:32px;background:#161719;color:#f4f4f0;font-family:Arial}.card{padding:24px;background:#26282b;border-radius:16px}.s1 .card{background:#214d43}</style></head>
    <body><main class="card" data-slop="&lt;img src='http://127.0.0.1:${observer.address().port}/xss'&gt;"><h1>Rendering test</h1><p>Concurrent output remains independent.</p></main></body></html>`);
  try {
    const outputs = [join(root, "square.mp4"), join(root, "wide.mp4")];
    const results = await Promise.allSettled(outputs.map((out, i) => execute(process.execPath, [script, file, out, ...(i ? ["--wide"] : [])], {
      timeout: 260_000, killSignal: "SIGKILL", env: { ...process.env, TMPDIR: temp },
    })));
    for (let i = 0; i < outputs.length; i++) {
      assert.equal(results[i].status, "fulfilled", results[i].reason?.stack || results[i].reason?.message);
      assert.match(results[i].value.stdout, /saved .*1 steps/);
      const { stdout } = await execute("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,nb_frames,duration", "-of", "json", outputs[i]]);
      const stream = JSON.parse(stdout).streams[0];
      assert.equal(stream.codec_name, "h264");
      assert.equal(stream.width, i ? 3840 : 2160); assert.equal(stream.height, 2160);
      assert.ok(Number(stream.nb_frames) > 200); assert.ok(Number(stream.duration) > 3);
      const pixel = (time) => {
        const result = spawnSync("ffmpeg", ["-v", "error", "-ss", time, "-i", outputs[i], "-frames:v", "1", "-vf", "crop=2:2:1800:400,scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]);
        assert.equal(result.status, 0, result.stderr.toString());
        assert.equal(result.stdout.length, 3);
        return [...result.stdout];
      };
      const initial = pixel("0"), final = pixel("3.8");
      assert.ok(initial[1] < 50, "initial card must retain its neutral color");
      assert.ok(final[1] > 65 && final[1] > initial[1] + 20 && final[1] > final[0] + 20, "the final frame must contain the applied green design step");
    }
    assert.equal(unexpectedRequests, 0, "data-slop was interpreted as executable markup");
    assert.equal(readFileSync(join(marker, "keep.txt"), "utf8"), "keep");
    assert.ok(!readdirSync(root).some((name) => name.endsWith(".unslop-lock") || name.startsWith(".unslop-output-")));
    assert.ok(!readdirSync(temp).some((name) => name.startsWith("unslop-story-frames-")));
    if (process.env.UNSLOP_TEST_ARTIFACT_DIR) {
      mkdirSync(process.env.UNSLOP_TEST_ARTIFACT_DIR, { recursive: true });
      outputs.forEach((file, i) => copyFileSync(file, join(process.env.UNSLOP_TEST_ARTIFACT_DIR, i ? "wide.mp4" : "square.mp4")));
    }
  } finally { observer.closeAllConnections(); await new Promise((done) => observer.close(done)); }
});
