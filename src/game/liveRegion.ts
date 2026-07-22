/**
 * The polite screen-reader live region (`#a11y-live`). Extracted so the
 * clear-then-set announce behavior is unit-testable without booting `main.ts`.
 */

/**
 * Announce `msg` to `#a11y-live`. Clears the region first, then sets the text on
 * the next frame, so an IDENTICAL consecutive message still re-fires: most
 * screen readers do not re-speak a live region whose text is replaced with the
 * same string. Mirrors `showUpdateChip`'s pattern. No-op if the region is absent.
 *
 * Limitation: two announces within the same animation frame coalesce, so only the
 * later one speaks. Announces are user-action driven (save, cancel), so two in one
 * frame is rare; if it ever matters, queue messages instead of overwriting.
 */
export function announceLive(msg: string): void {
  const el = document.getElementById("a11y-live");
  if (!el) return;
  el.textContent = "";
  const set = (): void => {
    el.textContent = msg;
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(set);
  else set();
}
