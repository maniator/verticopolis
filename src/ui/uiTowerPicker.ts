import type { UI } from "./UI";
import { openImport } from "./uiImport";
import { towerPickerTemplate } from "./templates/towerPicker";
import type { SlotInfo } from "../storage/SaveGame";

/**
 * Controller for the title screen's load-only tower picker
 * (SPEC-splash-load-tower CAP-2 to CAP-5). It lives in its own module, like the
 * batch-pricing and elevator-schedule controllers, and is re-exported from
 * `./uiDialogs` so `dialogs.showTowerPicker` callers stay unchanged.
 */

export interface TowerPickerCtx {
  /** Read the device slots. A THUNK, not a snapshot: a re-render after a failed
   *  load must reflect storage as it is now, not as it was when the picker
   *  opened. The caller owns the read, including guarding a storage backend
   *  that throws outright. */
  getSlots: () => { slots: SlotInfo[]; storageBlocked: boolean };
  /** Adopt a slot, returning whether a tower actually arrived. False re-renders
   *  the picker with the reason in it. */
  onLoad: (slot: number | "auto") => boolean;
}

export function showTowerPicker(ui: UI, ctx: TowerPickerCtx): void {
  // The picker never tears the title screen down itself. A successful adoption
  // does that, from the onboarding controller's own adoptSim, which is the one
  // point every arrival (slot load, .vctower import, .TDT import) passes
  // through. So Back, Esc, an OS-picker cancel, and a failed load all leave the
  // player exactly where they were.
  const open = (error: string | null): void => {
    const { slots, storageBlocked } = ctx.getSlots();
    const box = ui.openModalTemplate(
      towerPickerTemplate(slots, error, {
        // A failed load re-renders the picker with the reason IN it. It
        // deliberately does not toast: the title screen sits above the toast
        // rail's stacking position for most of its own life, and a dialog's top
        // layer paints over the rail regardless, so a toast raised from here is
        // feedback the player would never see. Re-opening over a live modal is
        // the same move the saves manager makes after a slot write.
        onLoad: (slot) => {
          const ok = ctx.onLoad(slot);
          if (!ok) {
            open("That tower couldn't be read. It may have been saved by a newer version.");
            return false;
          }
          // The dialog must be closed EXPLICITLY on success. Adoption takes the
          // title screen down, but the shared <dialog> is a separate surface in
          // the browser's top layer: leaving it open would drop the player onto
          // their tower behind a live modal that also paints over the
          // "Press play to resume" toast. Same order the saves manager's own
          // Load uses (dispatch, then close).
          ui.closeModal();
          return true;
        },
        // Close first: the OS file picker replaces this dialog rather than
        // stacking on it, and the .TDT fidelity report refuses to open while
        // another modal is live.
        onFile: () => {
          ui.closeModal();
          openImport(ui);
        },
        // Hand focus back to the plate that opened the picker, so a keyboard or
        // screen-reader user is not dropped on document.body with the splash's
        // focus trap still armed.
        onBack: () => {
          ui.closeModal();
          document.querySelector<HTMLElement>('#splash [data-splash="load"]')?.focus();
        },
      },
      storageBlocked),
      // Load-only and read-only: nothing here is unsaved and nothing is a
      // pending decision, so a fidelity report arriving behind it may take the
      // dialog rather than wait for it.
      { displaceable: true },
    );
    // Re-rendering replaces the dialog's DOM, so the Load button that had focus
    // is gone. Move focus onto the alert rather than leaving a keyboard user
    // with nothing focused inside an open modal.
    if (error) box.querySelector<HTMLElement>(".picker-error")?.focus();
  };
  open(null);
}
