import { createRequire } from "node:module";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createOutputSession } from "./output.mjs";
import { closeBrowser, evaluateIsolated, launchBrowser } from "./browser.mjs";

const usage = "usage: node snapshot.mjs <url or local file> <out.html> [pass label] [--dark | --light] [--width 1440] [--height 810] [--timeout 60000]";
const args = process.argv.slice(2);
const positionals = [];
let width = 1440;
let height = 810;
let timeout = 60_000;
const size = (name, value) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 8192) {
    console.error(`--${name} must be a whole number above 0 and at most 8192, got "${value}"`);
    process.exit(1);
  }
  return n;
};
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  const match = /^--(width|height|timeout)(?:=(.*))?$/.exec(arg);
  if (match) {
    const value = match[2] ?? args[++i];
    if (value === undefined || value.startsWith("--")) {
      console.error(`--${match[1]} needs a value, like --${match[1]} 1440`);
      process.exit(1);
    }
    if (match[1] === "timeout") {
      timeout = Number(value);
      if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120_000) {
        console.error("--timeout must be a whole number from 1000 to 120000 milliseconds."); process.exit(1);
      }
    } else if (match[1] === "width") width = size("width", value);
    else height = size("height", value);
  } else if (arg === "--dark" || arg === "--light") {
    continue;
  } else if (!arg.startsWith("--")) {
    positionals.push(arg);
  } else {
    console.error(`Unknown option: ${arg}`);
    process.exit(1);
  }
}
const [url, out, label] = positionals;
const scheme = args.includes("--dark") ? "dark" : args.includes("--light") ? "light" : "no-preference";
if (!url || !out || positionals.length > 3) {
  console.error(usage);
  process.exit(1);
}
if (args.includes("--dark") && args.includes("--light")) {
  console.error("Choose only one of --dark and --light.");
  process.exit(1);
}
if (width * height > 33_554_432) {
  console.error("The viewport may not exceed 33,554,432 pixels.");
  process.exit(1);
}
let input;
let target;
try {
  if (/^https?:/i.test(url)) {
    target = new URL(url).href;
  } else {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^file:/i.test(url)) throw new Error("Input must be an HTTP(S) URL or a local HTML file.");
    input = /^file:/i.test(url) ? fileURLToPath(url) : resolve(url);
    if (!statSync(input).isFile()) throw new Error("Input must be a regular HTML file.");
    target = pathToFileURL(input).href;
  }
} catch (error) {
  console.error(`Invalid input: ${error.message}`);
  process.exit(1);
}

async function browserKit() {
  for (const name of ["playwright", "playwright-core"]) {
    try {
      return await import(name);
    } catch {}
    try {
      return createRequire(join(process.cwd(), "package.json"))(name);
    } catch {}
  }
  throw new Error("Playwright is not installed. In your project, run `npm install -D playwright` followed by `npx playwright install chromium`.");
}

const chrome = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((path) => path && existsSync(path));
let browser;
let outputs;
let deadline;
let timedOut = false;
try {
  outputs = createOutputSession([resolve(out), resolve(out).replace(/\.html?$/i, "") + ".live.png"], input);
  const { chromium } = await browserKit();
  browser = await launchBrowser(chromium, chrome ? { executablePath: chrome } : {});
  deadline = setTimeout(() => {
    timedOut = true;
    void closeBrowser(browser).catch(() => {}).finally(() => {
      outputs.cleanup();
      console.error(`Snapshot timed out after ${timeout} milliseconds.`);
      process.exit(1);
    });
  }, timeout);
  deadline.unref();
  const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, colorScheme: scheme });
  await page.goto(target, { waitUntil: "networkidle" });
  await evaluateIsolated(page, () => document.fonts.ready);
  await page.waitForTimeout(600);
  await evaluateIsolated(page, async () => {
    const pause = (ms) => new Promise((done) => setTimeout(done, ms));
    const root = document.scrollingElement || document.documentElement;
    let last = root.scrollHeight;
    for (let step = 0; step < 30 && root.scrollTop < 20_000; step++) {
      window.scrollBy(0, window.innerHeight);
      await pause(150);
      const grown = root.scrollHeight;
      if (grown <= last && root.scrollTop + window.innerHeight >= grown) break;
      last = grown;
    }
    window.scrollTo(0, 0);
    const loaded = (image) =>
      new Promise((done) => {
        image.addEventListener("load", done, { once: true });
        image.addEventListener("error", done, { once: true });
      });
    const pending = [...document.images].filter((image) => !image.complete);
    await Promise.race([Promise.all(pending.map(loaded)), pause(5000)]);
  });
  const html = await evaluateIsolated(page, async ([label, scheme]) => {
    const LIMIT = 3_000_000;
    const absolute = (value, base = location.href) => {
      try {
        return new URL(value, base).href;
      } catch {
        return value;
      }
    };
    const inlined = new Map();
    const bounded = async (href) => {
      const response = await fetch(href, { signal: AbortSignal.timeout(5000) });
      if (!response.ok || Number(response.headers.get("content-length")) > LIMIT) {
        await response.body?.cancel();
        return null;
      }
      const reader = response.body?.getReader();
      if (!reader) return null;
      const parts = [];
      let length = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > LIMIT) { await reader.cancel(); return null; }
        parts.push(value);
      }
      return new Blob(parts, { type: response.headers.get("content-type") || "application/octet-stream" });
    };
    const inline = async (href) => {
      if (!href || href.startsWith("data:")) return href;
      if (!inlined.has(href)) {
        inlined.set(
          href,
          bounded(href)
            .then((blob) =>
              blob && blob.size < LIMIT
                ? new Promise((done) => {
                    const reader = new FileReader();
                    reader.onload = () => done(reader.result);
                    reader.onerror = () => done(href);
                    reader.readAsDataURL(blob);
                  })
                : href,
            )
            .catch(() => href),
        );
      }
      return inlined.get(href);
    };
    const urls = async (css, base) => {
      const found = [...css.matchAll(/url\((['"]?)(?!data:)([^)'"]+)\1\)/g)];
      let result = css;
      for (const [whole, , value] of found) {
        if (/^(#|%23)/.test(value.trim())) continue;
        const data = await inline(absolute(value.trim(), base));
        result = result.split(whole).join(`url("${data}")`);
      }
      return result;
    };

    const css = [];
    for (const sheet of document.styleSheets) {
      const owner = sheet.ownerNode;
      let text = "";
      let base = location.href;
      if (sheet.href) {
        base = sheet.href;
        text = await bounded(sheet.href).then((blob) => blob ? blob.text() : "").catch(() => "");
      } else if (owner && owner.textContent.trim()) {
        text = owner.textContent;
      }
      if (!text) {
        try {
          text = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
        } catch {}
      }
      const media = sheet.media && sheet.media.mediaText;
      css.push(media && media !== "all" ? `@media ${media} {\n${text}\n}` : text);
      css[css.length - 1] = await urls(css[css.length - 1], base);
    }

    const copy = document.documentElement.cloneNode(true);
    // Freeze the browser's selected image before removing responsive markup.
    const images = document.querySelectorAll("img");
    copy.querySelectorAll("img").forEach((node, index) => {
      const selected = images[index].currentSrc;
      if (selected) node.setAttribute("src", selected);
    });
    copy.querySelectorAll("script, noscript, link, style, base, iframe, frame, frameset, object, embed, portal, meta[http-equiv]").forEach((node) => node.remove());
    for (const node of [copy, ...copy.querySelectorAll("*")]) {
      for (const attr of [...node.attributes]) {
        const name = attr.name.toLowerCase();
        const value = attr.value.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
        if (name.startsWith("on") || ["srcdoc", "action", "formaction", "ping"].includes(name) ||
            (["href", "xlink:href", "src"].includes(name) && /^(javascript|vbscript):/.test(value)) ||
            (["href", "xlink:href"].includes(name) && /^(data|file|blob):/.test(value))) node.removeAttribute(attr.name);
      }
    }
    copy.querySelectorAll("[srcset]").forEach((node) => node.removeAttribute("srcset"));
    copy.querySelectorAll("source").forEach((node) => node.remove());
    copy.querySelectorAll("[loading]").forEach((node) => node.removeAttribute("loading"));
    for (const node of copy.querySelectorAll("img[src], video[poster], image")) {
      const attr = node.tagName === "VIDEO" ? "poster" : node.tagName.toLowerCase() === "image" ? "href" : "src";
      const value = node.getAttribute(attr);
      if (value) node.setAttribute(attr, await inline(absolute(value)));
    }
    copy.querySelectorAll("a[href]").forEach((node) => {
      const href = node.getAttribute("href");
      if (!href.startsWith("#")) node.setAttribute("href", absolute(href));
    });
    for (const node of copy.querySelectorAll("[style*='url(']")) {
      node.setAttribute("style", await urls(node.getAttribute("style"), location.href));
    }
    const style = document.createElement("style");
    let text = css.join("\n");
    if (scheme === "dark" || scheme === "light") {
      const other = scheme === "dark" ? "light" : "dark";
      text = text
        .replace(new RegExp(`prefers-color-scheme\\s*:\\s*${scheme}`, "g"), "min-width: 0px")
        .replace(new RegExp(`prefers-color-scheme\\s*:\\s*${other}`, "g"), "max-width: 0px");
      const meta = document.createElement("meta");
      meta.name = "color-scheme";
      meta.content = scheme;
      copy.querySelector("head").prepend(meta);
    }
    style.textContent = text.replace(/<\/style/gi, "<\\/style");
    copy.querySelector("head").appendChild(style);
    const policy = document.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content = "script-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
    copy.querySelector("head").prepend(policy);
    if (label) {
      const meta = document.createElement("meta");
      meta.name = "unslop-pass";
      meta.content = label;
      copy.querySelector("head").prepend(meta);
    }
    return "<!doctype html>\n" + copy.outerHTML;
  }, [label ?? "", scheme]);
  writeFileSync(outputs.staged[0], html);
  await evaluateIsolated(page, () => window.scrollTo(0, 0));
  await page.screenshot({ path: outputs.staged[1] });
  outputs.commit();
  console.log(`saved ${resolve(out)}${label ? ` as ${label}` : ""}`);
} catch (error) {
  console.error(timedOut ? `Snapshot timed out after ${timeout} milliseconds.` : error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  outputs?.cleanup();
  try { await closeBrowser(browser); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
process.exit(process.exitCode ?? 0);
