import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Link a folder (or a missing path that stands for one) at `path`.
 *  `target` must be absolute. On Windows a folder symlink needs elevation or
 *  Developer Mode, so the link is a junction there: it needs neither, and Node
 *  reports it as a symbolic link (`lstat().isSymbolicLink()`), which is what the
 *  code under test looks for. Elsewhere it is an ordinary symlink. */
export function linkFolder(target: string, path: string): void {
  symlinkSync(target, path, process.platform === "win32" ? "junction" : undefined);
}

/** Link a file with a symlink, keeping `target` as given (relative or not).
 *  Windows may refuse (EPERM) without elevation; check `FILE_LINKS` first. */
export function linkFile(target: string, path: string): void {
  symlinkSync(target, path, "file");
}

/** Whether this session can create a file symlink: always on Linux and macOS,
 *  and on Windows only when elevated or in Developer Mode. A test that needs a
 *  file link uses `it.skipIf(!FILE_LINKS)`, so the skip shows in the run's output
 *  and happens only where the operating system refuses the link. */
export const FILE_LINKS: boolean = (() => {
  const dir = mkdtempSync(join(tmpdir(), "vc-file-link-probe-"));
  try {
    writeFileSync(join(dir, "a"), "");
    linkFile("a", join(dir, "b"));
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EPERM") return false;
    throw e;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();
