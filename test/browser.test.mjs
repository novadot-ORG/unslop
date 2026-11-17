import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { closeBrowser, launchBrowser } from "../skills/unslop/scripts/browser.mjs";

test("browser closure is bounded when the browser stops responding", async () => {
  await assert.rejects(closeBrowser({ close: () => new Promise(() => {}) }, 20), /shutdown timed out/);
});

test("repeated cleanup closes a browser only once", async () => {
  let calls = 0;
  const browser = { close: async () => { calls++; } };
  await Promise.all([closeBrowser(browser), closeBrowser(browser)]);
  assert.equal(calls, 1);
  await closeBrowser(undefined);
});

test("a stalled owned browser is force-terminated without touching other processes", async () => {
  let killed = 0;
  const server = { wsEndpoint: () => "ws://127.0.0.1/fixture", close: () => new Promise(() => {}), kill: async () => { killed++; } };
  const browser = await launchBrowser({ launchServer: async (options) => { assert.equal(options.host, "127.0.0.1"); return server; }, connect: async () => ({}) }, {});
  await closeBrowser(browser, 20);
  assert.equal(killed, 1);
});

test("failed browser connection terminates the newly launched browser", async () => {
  let killed = 0;
  const server = { wsEndpoint: () => "ws://127.0.0.1/fixture", kill: async () => { killed++; } };
  await assert.rejects(launchBrowser({ launchServer: async () => server, connect: async () => { throw new Error("connect failed"); } }, {}), /connect failed/);
  assert.equal(killed, 1);
});

test("owned process exit completes cleanup even when transport shutdown never resolves", async () => {
  const child = new EventEmitter(); child.exitCode = null; child.signalCode = null;
  const server = {
    process: () => child,
    wsEndpoint: () => "ws://127.0.0.1/fixture",
    close: () => new Promise(() => { child.exitCode = 0; child.emit("exit", 0); }),
    kill: () => { throw new Error("An exited process must not be killed again"); },
  };
  const browser = await launchBrowser({ launchServer: async () => server, connect: async () => ({}) }, {});
  await closeBrowser(browser, 20);
  assert.equal(child.listenerCount("exit"), 0);
});
