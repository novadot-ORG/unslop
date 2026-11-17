import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

// Serialize writers to the same destinations and publish only completed files.
// Locks are deliberately not stolen: after SIGKILL, verify no writer is alive
// before manually removing the named .unslop-lock file.
export function createOutputSession(destinations, input) {
  const locks = [];
  let temporary;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (temporary) rmSync(temporary, { recursive: true, force: true });
    for (const { path, fd } of locks.reverse()) {
      try {
        const held = fstatSync(fd);
        const current = lstatSync(path);
        if (held.dev === current.dev && held.ino === current.ino) unlinkSync(path);
      } catch {}
      try { closeSync(fd); } catch {}
    }
    process.off("exit", cleanup);
  };
  try {
    const source = input ? statSync(input) : null;
    const paths = destinations.map((destination) => {
      const path = resolve(destination);
      mkdirSync(dirname(path), { recursive: true });
      return join(realpathSync(dirname(path)), basename(path));
    });
    if (new Set(paths).size !== paths.length) throw new Error("Output paths must be different.");
    for (const path of [...paths].sort()) {
      if (existsSync(path) || lstatSync(path, { throwIfNoEntry: false })) {
        const target = lstatSync(path);
        if (!target.isFile() || target.isSymbolicLink()) throw new Error(`Output must be a regular file, not a directory or symlink: ${path}`);
        if (source && source.dev === target.dev && source.ino === target.ino) throw new Error("Output must not overwrite the input file.");
      }
      const lockPath = path + ".unslop-lock";
      let fd;
      try { fd = openSync(lockPath, "wx", 0o600); }
      catch (error) {
        if (error.code === "EEXIST") throw new Error(`Output is locked by another run: ${lockPath}. If a prior run was killed, verify it has stopped before removing this lock.`);
        throw error;
      }
      locks.push({ path: lockPath, fd });
      writeFileSync(fd, `${process.pid}\n`);
    }
    temporary = mkdtempSync(join(dirname(paths[0]), ".unslop-output-"));
    const staged = paths.map((path, i) => join(temporary, `${i}-${basename(path)}`));
    process.once("exit", cleanup);
    return {
      paths,
      staged,
      cleanup,
      commit() {
        for (const path of staged) if (!statSync(path).isFile()) throw new Error("An output file was not generated.");
        // Each rename is atomic. A snapshot's two files are published separately.
        for (let i = 0; i < paths.length; i++) renameSync(staged[i], paths[i]);
      },
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
