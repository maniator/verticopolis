import type { UI } from "./UI";
import { starUpTemplate, type StarUpScreen } from "./templates/starUp";

/**
 * Open the star-up message box. The frame loop stops time while it is up
 * (`hasBlockingModal`), as the 1994 game's message boxes did. OK, Esc and the
 * title-bar ✕ close it; a click outside it does nothing, like any Windows
 * message box. A dialog opened over it replaces it. `onClosed` runs once,
 * however the box goes.
 */
export function showStarUp(ui: UI, screen: StarUpScreen, onClosed: () => void): void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onClosed();
  };
  const ok = () => {
    if (done) return;
    ui.closeModal();
    finish();
  };
  ui.openModalTemplate(starUpTemplate(screen, ok), { onDisplaced: finish });
  const dialog = ui.el.modal as HTMLDialogElement;
  dialog.oncancel = (e) => {
    e.preventDefault();
    ok();
  };
  dialog.onclick = null;
}
