import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";

// Resolve a story-server request path to a file inside root, or null
// when the path does not name a file under it. The request path has
// already had its query string stripped and its escapes decoded.
//
// A bare `target.startsWith(root)` is not enough: a sibling directory
// whose name starts with the root's (`/a/site` vs `/a/site-private`)
// passes it, and so does a symlink inside root that points outside.
// Both sides are resolved to their real paths first. Serve only visible,
// regular files; directories, named pipes and hidden symlink targets stay out.
export function resolveStoryFile(root, requestPath) {
  if (typeof requestPath !== "string" || !requestPath.startsWith("/__story/") || /[\\\0]/.test(requestPath)) return null;
  const path = requestPath.slice("/__story/".length);
  const hidden = (value) => value.split(/[\\/]/).some((part) => part.startsWith(".") && part !== "." && part !== "..");
  if (hidden(path)) return null;
  const target = normalize(join(root, path));
  let realRoot;
  let realTarget;
  try {
    realRoot = realpathSync(root);
    realTarget = realpathSync(target);
    if (!statSync(realTarget).isFile()) return null;
  } catch {
    return null;
  }
  const rel = relative(realRoot, realTarget);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || hidden(rel)) return null;
  return realTarget;
}
