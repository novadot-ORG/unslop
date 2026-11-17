import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname } from "node:path";
import { resolveStoryFile } from "./story-path.mjs";

const types = {
  ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".avif": "image/avif", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav",
};

// The story workspace is trusted local input, not a hostile-writer sandbox.
// Opening the resolved file without following a final symlink and checking the
// descriptor prevents common replacement races; portable Node APIs cannot pin
// every parent directory against a malicious same-user writer.
function readRegularFile(target) {
  const fd = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = fstatSync(fd);
    const current = statSync(target);
    if (!opened.isFile() || opened.dev !== current.dev || opened.ino !== current.ino || realpathSync(target) !== target) return null;
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

export async function startStoryServer({ root, file, stage }) {
  const mainFile = realpathSync(file);
  const token = randomBytes(24).toString("hex");
  const prefix = `/${token}/`;
  let authority;
  const server = createServer((request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "SAMEORIGIN");
    response.setHeader("Content-Security-Policy", "frame-ancestors 'self'; object-src 'none'; base-uri 'none'");
    response.setHeader("Cache-Control", "no-store");
    const end = (status, body = "", type = "text/plain; charset=utf-8") => {
      response.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body) });
      response.end(request.method === "HEAD" ? undefined : body);
    };
    try {
      if (request.headers.host !== authority) return end(404);
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        return end(405);
      }
      if (request.headers.origin && request.headers.origin !== `http://${authority}`) return end(403);
      if (!request.url?.startsWith("/") || request.url.startsWith("//")) return end(400);
      const path = decodeURIComponent(new URL(request.url, `http://${authority}`).pathname);
      if (/[\\\0]/.test(path)) return end(400);
      if (!path.startsWith(prefix)) return end(404);
      const route = path.slice(prefix.length - 1);
      if (route === "/__stage.html") return end(200, stage, "text/html; charset=utf-8");
      const target = resolveStoryFile(root, route);
      if (target === null) return end(404);
      const type = target === mainFile ? "text/html; charset=utf-8" : types[extname(target).toLowerCase()];
      if (!type) return end(404);
      const body = readRegularFile(target);
      if (body === null) return end(404);
      return end(200, body, type);
    } catch (error) {
      return end(error instanceof URIError || error instanceof TypeError ? 400 : 404);
    }
  });
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", fail);
      done();
    });
  });
  authority = `127.0.0.1:${server.address().port}`;
  let closing;
  return {
    base: `http://${authority}/${token}`,
    close() {
      closing ??= new Promise((done, fail) => {
        server.close((error) => error ? fail(error) : done());
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
