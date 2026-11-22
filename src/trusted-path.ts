import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { StartupError } from "./startup-error.js";

export type TrustCode = "policyFile" | "stateDir";

export const contains = (root: string, candidate: string) => {
  const tail = relative(root, candidate);
  return tail === "" || (!tail.startsWith("..") && !isAbsolute(tail));
};

const uid = () => process.getuid?.() ?? -1;

// Writable by someone else: group/world write, except sticky shared directories (e.g. /tmp).
function exposed(info: Stats, directory: boolean) {
  const sticky = directory && (info.mode & 0o1000) !== 0;
  return (info.mode & 0o022) !== 0 && !sticky;
}

// Every ancestor must be a real directory owned by root or the invoking user that no one else can
// modify, and the parent must not be reached through a symlink. Usable before the leaf exists.
export function requireTrustedParents(path: string, code: TrustCode) {
  const fail = () => new StartupError(code);
  if (!isAbsolute(path) || resolve(path) !== path || /[\x00-\x1f\x7f]/.test(path)) throw fail();
  try {
    if (realpathSync(dirname(path)) !== dirname(path)) throw fail();
    for (let dir = dirname(path); ; dir = dirname(dir)) {
      const info = lstatSync(dir);
      if (!info.isDirectory() || ![0, uid()].includes(info.uid) || exposed(info, true))
        throw fail();
      if (dirname(dir) === dir) return;
    }
  } catch (error) {
    throw error instanceof StartupError ? error : fail();
  }
}

// The path itself must not traverse a symlink (bind mounts are not detectable by realpath) and the
// workspace must not contain it or be contained by it.
export function requireTrustedPath(path: string, workspace: string, code: TrustCode) {
  requireTrustedParents(path, code);
  try {
    const real = realpathSync(workspace);
    if (realpathSync(path) !== path || contains(real, path) || contains(path, real))
      throw new StartupError(code);
  } catch (error) {
    throw error instanceof StartupError ? error : new StartupError(code);
  }
}

export function requireOwnedPrivate(info: Stats, mode: number, code: TrustCode) {
  if (info.uid !== uid() || (info.mode & 0o7777) !== mode) throw new StartupError(code);
}

// Read once through one descriptor so the checked file is the file read.
export function readTrustedFile(path: string, workspace: string, limit: number) {
  requireTrustedPath(path, workspace, "policyFile");
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fstatSync(fd);
    const named = lstatSync(path);
    if (
      !info.isFile() ||
      named.isSymbolicLink() ||
      info.ino !== named.ino ||
      info.dev !== named.dev ||
      info.nlink !== 1 ||
      info.uid !== uid() ||
      exposed(info, false) ||
      info.size > limit
    )
      throw new StartupError("policyFile");
    return readFileSync(fd, "utf8");
  } catch (error) {
    throw error instanceof StartupError ? error : new StartupError("policyFile");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
