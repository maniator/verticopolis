import type { EngineBootFailure } from "@verticopolis/components/host/engineBoot";
import type { KeyValueStore } from "./crashReload";

/**
 * The one reload a page takes when its engine files belong to another build.
 *
 * A browser can hand a returning player a cached copy of an older page while
 * the engine files come from the newer build that is live: the byte check
 * then refuses the pair at boot (`package-mismatch`, kind `mismatch`). In the
 * field this showed up on builds from 3.1 to 4.11, and the players who
 * pressed Reload on the stop screen landed on the live build. So the page
 * reloads once by itself before it shows that screen, when no service worker
 * controls it. A controlled page
 * would get the same pair from the same precache, and a reload does not
 * activate a waiting worker, so it keeps the stop screen, which takes the
 * waiting worker at once and offers Repair. The tab remembers every build it
 * reloaded from in `sessionStorage`, so it reloads at most once per build:
 * a page that comes back as a build it already reloaded from stops with the
 * screen, even when builds alternate.
 */

/** The builds (`__APP_SHA__`) this tab already reloaded from for mismatched
 *  files, as a JSON array of strings. */
export const MISMATCH_RELOAD_KEY = "vc.engineMismatchReload";

/** At most this many builds are remembered; a longer list is spent. */
const MAX_REMEMBERED_BUILDS = 16;

/** The cover line while the page reloads for matching files. */
export const MISMATCH_RELOAD_LINE = "Loading the latest version of the game.";

/** Whether a boot failure is engine files the byte check found to be from
 *  another build, on a page no service worker controls. A file that did not
 *  arrive, a package that cannot save, a link error after the bytes matched,
 *  a failure past the load and a controlled page are not: a fresh copy of the
 *  page does not change them. */
export function engineFilesFromAnotherBuild(failure: EngineBootFailure): boolean {
  return (
    failure.stage === "load" &&
    failure.reason === "package-mismatch" &&
    failure.cause === undefined &&
    failure.package?.kind === "mismatch" &&
    failure.package.controlled === false
  );
}

/** The builds the tab already reloaded from, or null when the stored value
 *  is not a short list of strings (read as spent, like storage that throws). */
function reloadedBuilds(raw: string | null): string[] | null {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const ok =
      Array.isArray(parsed) && parsed.length < MAX_REMEMBERED_BUILDS && parsed.every((b) => typeof b === "string");
    return ok ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

/** Whether this boot should reload for matching files. True at most once per
 *  build per tab: it adds `sha` to the tab's list and reads it back, so
 *  storage that throws, keeps nothing or holds something else never reloads,
 *  and the screen shows as before. */
export function claimMismatchReload(store: KeyValueStore | null, sha: string, failure: EngineBootFailure): boolean {
  if (!store || !engineFilesFromAnotherBuild(failure)) return false;
  try {
    const builds = reloadedBuilds(store.getItem(MISMATCH_RELOAD_KEY));
    if (builds === null || builds.includes(sha)) return false;
    const next = JSON.stringify([...builds, sha]);
    store.setItem(MISMATCH_RELOAD_KEY, next);
    return store.getItem(MISMATCH_RELOAD_KEY) === next;
  } catch {
    return false;
  }
}

/** Reload the page. Its own function so a test can see the call. */
export function reloadForMatchingFiles(): void {
  globalThis.location.reload();
}
