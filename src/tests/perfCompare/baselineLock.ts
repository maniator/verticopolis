import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The lock folder, beside `.perf-ts-baseline/` in the repository root (gitignored). */
export const BASELINE_LOCK = ".perf-ts-baseline.lock";

/** A lock with no readable holder this old is a crash between creating the folder and naming the holder. */
const ORPHAN_LOCK_MS = 60_000;

/** Whether a process with this id is running. A process this one may not signal still is. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface LockEnv {
  pid?: number;
  alive?: (pid: number) => boolean;
  now?: () => number;
}

/**
 * Holds `.perf-ts-baseline.lock` for the build of the pinned baseline, so two `perf:compare` runs do not
 * install into and build over the same `.perf-ts-baseline/` and `dist-perf-ts/`. Returns the release function.
 * A lock whose holder has died (or that never named one) is taken over; a live holder fails the run with
 * a message that says who has it and how to clear it.
 */
export function acquireBaselineLock(repo: string, env: LockEnv = {}): () => void {
  const { pid = process.pid, alive = pidAlive, now = Date.now } = env;
  const lock = join(repo, BASELINE_LOCK);
  const release = (): void => rmSync(lock, { recursive: true, force: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, "pid"), `${pid}\n`);
      return release;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const holder = Number(readHolder(lock));
    const named = Number.isInteger(holder) && holder > 0;
    if (named ? alive(holder) : now() - modifiedAt(lock) < ORPHAN_LOCK_MS) {
      throw new Error(
        `another perf run is building the TypeScript baseline${named ? ` (process ${holder})` : ""}; wait for it to finish, or delete ${BASELINE_LOCK} if it died`,
      );
    }
    release(); // the holder is gone: take the lock over on the next pass
  }
  throw new Error(`could not take ${BASELINE_LOCK}; delete it and run again`);
}

function readHolder(lock: string): string {
  try {
    return readFileSync(join(lock, "pid"), "utf8").trim();
  } catch {
    return "";
  }
}

function modifiedAt(lock: string): number {
  try {
    return statSync(lock).mtimeMs;
  } catch {
    return 0;
  }
}
