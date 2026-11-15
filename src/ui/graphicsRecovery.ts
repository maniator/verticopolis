/**
 * The card shown while the game restarts its graphics in place after the
 * device dropped them (#321). The canvas is frozen for that wait (up to about
 * eight seconds, longer in a background tab), so the card holds the page the
 * way the crash card does: a modal `<dialog>` makes the menus, the palette and
 * the speed buttons inert, and the game's own key handlers read
 * `isRecoveringGraphics` (`src/game/interactionState.ts`) from its element.
 * Nothing can change the tower blind while the picture is gone.
 */
export const GRAPHICS_RECOVERY_ID = "graphics-recovery";

/** Put the card up and return the function that takes it down. */
export function showGraphicsRecovery(): () => void {
  document.getElementById(GRAPHICS_RECOVERY_ID)?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = GRAPHICS_RECOVERY_ID;
  dialog.className = "win crash-card";
  dialog.setAttribute("aria-labelledby", "graphics-recovery-title");
  dialog.innerHTML = `
      <h2 id="graphics-recovery-title" class="win-title">Recovering graphics</h2>
      <p role="status">The device reset the game's graphics. The game is restarting them, which takes a few seconds. Your tower is safe.</p>`;
  // Esc would close a modal dialog; the wait ends only when the recovery does.
  dialog.addEventListener("cancel", (e) => e.preventDefault());
  document.body.append(dialog);
  try {
    dialog.showModal();
  } catch {
    dialog.setAttribute("open", "");
  }
  return () => {
    if (dialog.open) dialog.close();
    dialog.remove();
  };
}
