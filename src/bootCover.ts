/**
 * The startup screen's end (owner, 2026-11-15). The boot cover in index.html
 * opens at night and the sun comes up while the game loads, as CSS animations
 * that start on the first frame (styles/game/splash.css). When the first real
 * screen is up, this fills the bar, plays whatever is left of the sunrise in a
 * moment (so a fast load is a quick dawn, and the title never waits on the
 * show), lets clicks through at once and fades the cover out.
 *
 * Cost: runs once per page load. It reads the cover's few animations, changes
 * their rate and removes the cover when they and the fade are done.
 */

/** How long what is left of the sunrise may take once the game is ready. */
export const BOOT_DAWN_REST_MS = 300;
/** The fade's length (`#boot-cover.boot-ready` in splash.css) plus a margin,
 *  after which the cover goes even if no `transitionend` came. */
export const BOOT_FADE_MS = 400;
/** The class Settings > Reduced motion puts on `<html>`. */
const REDUCE_MOTION_CLASS = "reduce-motion";
/** The class that lets clicks through and fades the cover. */
export const BOOT_READY_CLASS = "boot-ready";

/** Finish the startup screen and take it away. Idempotent; with no animation
 *  support (or reduced motion) it removes the cover at once. */
export function finishBootCover(doc: Document = document): void {
  const cover = doc.getElementById("boot-cover");
  if (!cover || cover.classList.contains(BOOT_READY_CLASS)) return;
  const win = doc.defaultView;
  const reduce =
    !!win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    doc.documentElement.classList.contains(REDUCE_MOTION_CLASS);
  if (reduce || typeof cover.getAnimations !== "function") {
    cover.remove();
    return;
  }
  cover.style.setProperty("--boot-done", "1");
  for (const a of cover.getAnimations({ subtree: true })) {
    const timing = a.effect?.getComputedTiming();
    const end = Number(timing?.endTime ?? 0);
    const now = Number(a.currentTime ?? 0);
    const left = end - now;
    if (left > BOOT_DAWN_REST_MS) a.updatePlaybackRate(left / BOOT_DAWN_REST_MS);
  }
  cover.classList.add(BOOT_READY_CLASS);
  const remove = () => cover.remove();
  cover.addEventListener("transitionend", (e) => {
    if (e.target === cover && e.propertyName === "opacity") remove();
  });
  win?.setTimeout(remove, BOOT_DAWN_REST_MS + BOOT_FADE_MS);
}
