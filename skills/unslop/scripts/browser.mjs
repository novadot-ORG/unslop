const closing = new WeakMap();
const owners = new WeakMap();

function within(operation, timeout) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Browser shutdown timed out.")), timeout);
  });
  return Promise.race([Promise.resolve().then(operation), deadline]).finally(() => clearTimeout(timer));
}

async function closeOwned(owner, timeout) {
  const child = owner.process?.();
  let exited;
  const stopped = new Promise((resolve) => {
    exited = resolve;
    if (child?.exitCode != null || child?.signalCode != null) resolve();
    else child?.once("exit", resolve);
  });
  try {
    // Chromium can exit while Playwright is still awaiting transport cleanup.
    // The owned child process's exit is independent evidence of shutdown.
    try { await within(() => Promise.race([owner.close(), stopped]), timeout); }
    catch { await within(() => Promise.race([owner.kill(), stopped]), 5000); }
  } finally { child?.off("exit", exited); }
}

export async function launchBrowser(chromium, options) {
  const server = await chromium.launchServer({ ...options, host: "127.0.0.1" });
  try {
    const browser = await chromium.connect(server.wsEndpoint(), { timeout: 30_000 });
    owners.set(browser, server);
    return browser;
  } catch (error) {
    await within(() => server.kill(), 5000).catch(() => {});
    throw error;
  }
}

// Source pages may replace DOM/fetch APIs in their main JavaScript realm.
// Chromium's isolated world shares the document, but has clean native wrappers.
export async function evaluateIsolated(page, fn, arg) {
  const session = await page.context().newCDPSession(page);
  try {
    const { frameTree } = await session.send("Page.getFrameTree");
    const { executionContextId } = await session.send("Page.createIsolatedWorld", {
      frameId: frameTree.frame.id,
      worldName: "unslop-capture",
    });
    const result = await session.send("Runtime.callFunctionOn", {
      executionContextId,
      functionDeclaration: fn.toString(),
      arguments: arg === undefined ? [] : [{ value: arg }],
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  } finally { await session.detach().catch(() => {}); }
}

// Browser shutdown can stall after a crash. Bound it independently of capture.
export function closeBrowser(browser, timeout = 5000) {
  if (!browser) return Promise.resolve();
  if (!closing.has(browser)) {
    const owner = owners.get(browser);
    const result = owner
      ? closeOwned(owner, timeout)
      : within(() => browser.close(), timeout);
    closing.set(browser, result);
  }
  return closing.get(browser);
}
