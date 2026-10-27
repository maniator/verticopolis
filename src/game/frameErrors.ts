import type { GameApp } from "../main";

/** Ring-buffer depth for the failures (frame guard and traffic chip) included
 *  in a crash report. */
export const MAX_FRAME_ERRORS = 5;

/** What failed: the frame guard's thrown frame, or the traffic chip's refresh. */
export type FrameErrorSource = "frame" | "traffic";

/** The prefix each source's entries carry in the ring (the frame guard's are
 *  untagged, as they always were). */
const TAG: Record<FrameErrorSource, string> = { frame: "", traffic: "[traffic] " };

/** When each app last logged each source, by the page clock. */
const lastLogged = new WeakMap<object, Partial<Record<FrameErrorSource, number>>>();

/** The source of each ring entry this module wrote, kept beside the entry
 *  rather than read back from its text, so an error whose own message starts
 *  like a tag cannot pass for another source. An entry from anywhere else
 *  counts as the frame guard's. */
const entrySource = new WeakMap<object, FrameErrorSource>();

/**
 * Record a failure the game carries on through: the frame guard's thrown frame
 * (`engineWiring.ts`), and a traffic chip refresh that failed (`trafficHud.ts`:
 * a failed answer, a port that throws as it is asked, or a failed draw). Both
 * run every frame or every UI tick, so each source logs at most once per two
 * seconds, and a source that keeps failing replaces its own oldest entry in
 * the ring before anyone else's: a failure that repeats can neither spam the
 * console (which would itself tank performance) nor push another source's
 * last failure out of the crash report. Never throws, since it runs inside
 * the guards that keep the game going.
 *
 * The window only holds while the ring still has an entry from that source
 * and the clock has not gone back: a ring emptied for another tower
 * (`GameApp.adoptSim`) logs that tower's first failure at once, and so does a
 * clock swapped for one that starts again from 0 (the screenshot tooling's
 * stepped clock).
 */
export function noteFrameError(
  app: Pick<GameApp, "frameErrors">,
  err: unknown,
  source: FrameErrorSource = "frame",
): void {
  try {
    record(app, err, source);
  } catch {
    // A clock or date that throws must not take down the guard that called.
  }
}

function record(app: Pick<GameApp, "frameErrors">, err: unknown, source: FrameErrorSource): void {
  const ring = app.frameErrors;
  const now = globalThis.performance ? performance.now() : Date.now();
  const last = lastLogged.get(app) ?? {};
  const prev = last[source];
  if (prev !== undefined && now >= prev && now - prev <= 2000 && ring.some((e) => sourceOf(e) === source)) {
    return;
  }
  last[source] = now;
  lastLogged.set(app, last);
  try {
    console.error(`[tick] ${source} error, continuing:`, err);
  } catch {
    // A console (or a wrapper around it) that cannot print this value still
    // leaves the ring entry below.
  }
  const entry = { at: new Date().toISOString(), message: TAG[source] + formatError(err) };
  entrySource.set(entry, source);
  ring.push(entry);
  if (ring.length > MAX_FRAME_ERRORS) {
    // The entry just pushed is the source's own, so `own` is never -1.
    const own = ring.findIndex((e) => sourceOf(e) === source);
    ring.splice(own < ring.length - 1 ? own : 0, 1);
  }
}

function sourceOf(entry: object): FrameErrorSource {
  return entrySource.get(entry) ?? "frame";
}

/** The error's message and stack, or its string, or a placeholder for a value
 *  that throws when read. */
function formatError(err: unknown): string {
  try {
    return err instanceof Error ? `${err.message}\n${err.stack ?? ""}`.trim() : String(err);
  } catch {
    return "unprintable error";
  }
}
