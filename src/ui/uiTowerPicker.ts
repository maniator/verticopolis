import type { UI } from "./UI";
import { openImport } from "./uiDialogs";
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
  getSlots: () => SlotInfo[];
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
    ui.openModalTemplate(
      towerPickerTemplate(ctx.getSlots(), error, {
        // A failed load re-renders the picker with the reason IN it. It
        // deliberately does not toast: the title screen sits above the toast
        // rail's stacking position for most of its own life, and a dialog's top
        // layer paints over the rail regardless, so a toast raised from here is
        // feedback the player would never see. Re-opening over a live modal is
        // the same move the saves manager makes after a slot write.
        onLoad: (slot) => {
          const ok = ctx.onLoad(slot);
          if (!ok) open("That tower couldn't be read. It may have been saved by a newer version.");
          return ok;
        },
        // Close first: the OS file picker replaces this dialog rather than
        // stacking on it, and the .TDT fidelity report refuses to open while
        // another modal is live.
        onFile: () => {
          ui.closeModal();
          openImport(ui);
        },
        onBack: () => ui.closeModal(),
      }),
    );
  };
  open(null);
}
