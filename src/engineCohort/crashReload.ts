import { CRASH_LOOP_PAGES } from "./crashMarker";
import { remove, writeChecked, type KeyValueStore } from "./records";

/**
 * The Rust engine's crash reload (#1422, owner 2026-10-28). A trap in the
 * running engine never hands the tower to the TypeScript engine mid-game:
 * the page reloads, and the tower comes back from its last autosave on Rust.
 * This tab counts those crashes per build, and at `CRASH_LOOP_PAGES` its next
 * boots run TypeScript, with a line that says why, so a crash that repeats
 * cannot reload forever. The count lives in `sessionStorage`: it holds across
 * the reload and ends with the tab, and a `?engine=wasm` test visit, which
 * leaves the player's own records alone, is held all the same.
 */

/** This tab's Rust crashes on one build. */
export const RUST_CRASHES_KEY = "vc.rustCrashes";

interface CrashCount {
  v: 1;
  sha: string;
  count: number;
}

function countOf(store: KeyValueStore | null, sha: string): number {
  try {
    const raw = store?.getItem(RUST_CRASHES_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as Partial<CrashCount>;
    return parsed.v === 1 &&
      parsed.sha === sha &&
      Number.isInteger(parsed.count)
      ? parsed.count!
      : 0;
  } catch {
    return 0;
  }
}

/** Count one crash on this build and return the tab's count, or null when
 *  storage did not keep it: that reload could not be counted, so the caller
 *  must not reload. */
export function countRustCrash(
  store: KeyValueStore | null,
  sha: string,
): number | null {
  const count = countOf(store, sha) + 1;
  const record: CrashCount = { v: 1, sha, count };
  return writeChecked(store, RUST_CRASHES_KEY, record) ? count : null;
}

/** Whether this tab crashed often enough on this build that Rust stays off. */
export function crashReloadsSpent(count: number): boolean {
  return count >= CRASH_LOOP_PAGES;
}

/** Whether this tab's boots run TypeScript after its crashes on this build. */
export function heldAfterCrashes(
  store: KeyValueStore | null,
  sha: string,
): boolean {
  return crashReloadsSpent(countOf(store, sha));
}

/** Forget this tab's crashes (the player's retry in Settings). */
export function clearRustCrashes(store: KeyValueStore | null): void {
  remove(store, RUST_CRASHES_KEY);
}

/** The tab's `sessionStorage`, or null where reading the property throws. */
export function tabStore(): KeyValueStore | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** What a crash does: reload on Rust, reload onto TypeScript once this tab's
 *  crashes are spent, or stop where neither can happen (a count storage did
 *  not keep, or a wasm-only build, which has no TypeScript engine). */
export type CrashOutcome = "reload" | "reload-on-ts" | "stop";

export function crashOutcome(
  count: number | null,
  wasmOnly: boolean,
): CrashOutcome {
  if (count === null) return "stop";
  if (!crashReloadsSpent(count)) return "reload";
  return wasmOnly ? "stop" : "reload-on-ts";
}

/** The cover line while the page reloads after a crash. */
export const CRASH_RELOAD_LINE: Record<
  Exclude<CrashOutcome, "stop">,
  string
> = {
  reload:
    "The Rust engine hit an error. Reloading your tower from its last autosave.",
  "reload-on-ts":
    "The Rust engine hit an error again. Reloading your tower from its last autosave on the TypeScript engine.",
};

/** How long the cover line shows before the reload. */
export const CRASH_RELOAD_DELAY_MS = 2_000;

/** Reload the page once the cover line has had time to be read. */
export function reloadSoon(): void {
  setTimeout(() => globalThis.location.reload(), CRASH_RELOAD_DELAY_MS);
}
