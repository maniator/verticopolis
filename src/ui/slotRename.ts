import { trackAppAction } from "../analytics";
import { setSlotLabel } from "../storage/slotLabels";
import type { UI } from "./UI";
import { SAVES_DRAW } from "./savesDraw";
import { slotRenameTemplate } from "./templates/saves";

/** What the player reads when the browser would not keep the name. */
export const RENAME_FAILED = "Couldn't keep that name: the browser refused to store it. Free some browser storage and try again.";

/**
 * Saved Towers…' Rename…: ask for slot `slot`'s name, keep it, and go back to
 * the redrawn list, which then shows it (as File > Load and the title
 * screen's picker do). A refused write is said in the dialog, which stays up.
 */
export function renameSlot(ui: UI, slot: number): void {
  const back = (): void => ui.cb.onShowSaves(SAVES_DRAW.redraw);
  const box = ui.openModalTemplate(
    slotRenameTemplate(slot, {
      onCancel: back,
      onSave: (name) => {
        if (!setSlotLabel(slot, name)) {
          ui.sayVisibly(RENAME_FAILED);
          return;
        }
        trackAppAction("rename_slot", name.trim() ? "named" : "cleared");
        back();
      },
    }),
    { displaceable: true },
  );
  const field = box.querySelector<HTMLInputElement>("input");
  field?.focus();
  field?.select();
}
