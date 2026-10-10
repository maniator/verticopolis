/**
 * The runner side of the dialog phase watch (#762 / #843): arming it around a
 * shot's setup, capturing a watched shot outside the gallery, judging the
 * watch after the capture, and promoting the capture only when it passes. A
 * shot opts in with `Shot.phaseWatch` (see screenshot-env.ts); the in-page
 * half is src/tests/screenshotPhaseWatch.ts.
 *
 * Why it exists: 27c's dialog used to move by a fraction of a pixel after its
 * first render, and its composited sticky layers kept the subpixel phase of
 * their first raster, so whether a frame rendered before the move decided
 * which raster the capture got. The scene now stages in one task; this check
 * is the tripwire that names the cause on any run where a move after first
 * render comes back.
 *
 * Keep this file ERASABLE (type annotations / `as` only) and import siblings
 * with an explicit `.ts` extension, like every other scripts/ module.
 */
import type { Page } from "playwright";
import { copyFileSync, mkdirSync, rmdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ROOT } from "./screenshot-env.ts";
import { pgMarkModalPhaseTarget, pgStopModalPhaseWatch, pgWatchModalPhase } from "./screenshot-builders.ts";

/** Arm the watch before a watched shot's setup, so it sees the dialog's very
 *  first frame. The dialog must survive the runner's transient sweep, so the
 *  shot has to keep its dialogs; anything else would always fail as "closed". */
export async function armPhaseWatch(page: Page, keepDialogs: boolean): Promise<void> {
  if (!keepDialogs) throw new Error("phaseWatch needs a shot that keeps its dialog (keepDialogs)");
  await page.evaluate(pgWatchModalPhase);
}

/** After setup: mark the dialog setup staged as the one the watch must judge,
 *  so a different dialog open at capture time (an event modal the sim popped)
 *  fails the shot. */
export async function markPhaseTarget(page: Page): Promise<void> {
  if (!(await page.evaluate(pgMarkModalPhaseTarget))) {
    throw new Error("phaseWatch is set but setup left no open dialog (or the watch was lost) to judge");
  }
}

/** Where a watched shot captures: under determinism-diff/ (gitignored, and the
 *  capture workflow uploads it on failure), never in the gallery, so a failed
 *  check, a crash or a kill cannot leave a bad or stray file under
 *  docs/screenshots, and a failing capture survives as evidence. Keyed by pid
 *  and output dir so the two determinism legs and same-named shots never
 *  collide; cleared first so a reused pid cannot pass off an old capture. */
export function phaseCapturePath(path: string, outDir: string): string {
  const evidenceDir = join(ROOT, "determinism-diff", "phase-watch", `${process.pid}-${outDir}`);
  mkdirSync(evidenceDir, { recursive: true });
  const capturePath = join(evidenceDir, basename(path));
  rmSync(capturePath, { force: true });
  return capturePath;
}

/** Judge the watch AFTER the capture, so the check covers every frame through
 *  the captured one, then promote the capture into the gallery. More than one
 *  phase means the dialog or one of its sticky layers moved by a fraction of a
 *  device pixel after it first rendered, which leaves the sticky raster phase
 *  to a compositor race. A null reading means the in-page watch was lost (a
 *  reload or navigation), which must not pass as a clean check. Throws with
 *  the cause and leaves the capture in place as evidence on any failure. */
export async function judgeAndPromote(page: Page, capturePath: string, path: string): Promise<void> {
  const watch = await page.evaluate(pgStopModalPhaseWatch);
  let verdict: string | null = null;
  if (!watch) {
    verdict = "the dialog phase watch was armed but is gone at capture time (did the page reload?), so it checked nothing";
  } else if (watch.error) {
    verdict = `the dialog phase watch failed while sampling (${watch.error}), so it checked nothing reliable`;
  } else if (watch.target === "closed") {
    verdict = `"${watch.title}" closed before the capture, so there was no staged dialog to capture`;
  } else if (watch.target === "displaced") {
    verdict = `"${watch.title}" was replaced by another dialog before the capture, so the capture is not the staged dialog`;
  } else if (watch.phases.length === 0) {
    verdict = `the dialog phase watch never saw "${watch.title}" render, so it checked nothing`;
  } else if (watch.phases.length > 1) {
    verdict =
      `"${watch.title}" rendered at ${watch.phases.length} subpixel phases, in thousandths of a device pixel ` +
      `(${watch.phases.join(" | ")}): it moved by a fraction of a pixel after it first rendered, so its ` +
      "sticky layers' raster phase is a race (#762, #843)";
  }
  if (verdict) throw new Error(`${verdict}. Capture kept at ${capturePath}`);
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(capturePath, path);
  rmSync(capturePath, { force: true });
  // Drop the per-run evidence dir once it is empty (a passing shot).
  try {
    rmdirSync(dirname(capturePath));
  } catch {
    /* still holds another shot's evidence */
  }
}

/** Cleanup for a watched shot that threw: stop the rAF loop so it cannot run
 *  into the next shot. A no-op when the shot already stopped it; a cleanup
 *  failure is logged and leaves the shot's own error in place. */
export async function stopPhaseWatch(page: Page): Promise<void> {
  await page.evaluate(pgStopModalPhaseWatch).catch((e) => {
    console.error(`  phase watch cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
  });
}
