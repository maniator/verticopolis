import { html, nothing, type TemplateResult } from "lit-html";
import type { SlotInfo } from "../../storage/SaveGame";
import { slotDetail, slotName } from "./saves";

/**
 * The title screen's LOAD-ONLY tower picker (SPEC-splash-load-tower CAP-2 to
 * CAP-4). It resembles the in-game Saved Towers manager (`./saves.ts`) and
 * shares its row chrome and summary renderer, with one deliberate difference
 * that is a correctness rule rather than a matter of taste:
 *
 * **There is no Save, no Delete, and no Export here.** While the title screen
 * is up the live simulation may be the throwaway boot sim (`main.ts` falls back
 * to `Simulation.newGame` when the autosave is absent or corrupt), and the
 * standing invariant, stated in `saveLoad.ts`'s `saveBeforeUpdate` comment and
 * enforced by the 30 second autosave timer's `#splash` check, is that nothing
 * mutates the sim while the splash is up. A Save control here would not even
 * fail loudly: `saveToSlot` reads `viewState()` from an engine that is paused
 * but alive, so it would succeed and write an empty tower carrying a genuine
 * timestamp. Do not "unify" this template with `savesTemplate` by adding the
 * missing buttons back.
 *
 * Rows come in three variants, keyed on RAW presence (`SlotInfo.present`)
 * rather than the parse-based `exists`, so a slot that is present but
 * unreadable is shown and labeled instead of vanishing. An unreadable row
 * carries no control at all, not a disabled one: a disabled button invites a
 * tap that can never work.
 *
 * Unlike `savesTemplate`, every action binds inline through lit `@click`, so
 * the controller (`showTowerPicker`) needs no `wireActions` pass. The
 * `data-picker` attributes remain for tests.
 */
export interface TowerPickerHandlers {
  /** Load a device slot. Returns false when the slot could not be read, which
   *  re-renders the picker with an inline error rather than closing it. */
  onLoad: (slot: number | "auto") => boolean;
  /** Open the OS file picker (a `.vctower` export or a 1994 `.TDT` save). */
  onFile: () => void;
  /** Return to the title screen, changing nothing. */
  onBack: () => void;
}

export function towerPickerTemplate(
  slots: SlotInfo[],
  error: string | null,
  h: TowerPickerHandlers,
): TemplateResult {
  // "Anything on this device" is raw presence, so a storage full of corrupt
  // slots still renders those rows (and the recovery route beneath them)
  // rather than collapsing to the nothing-saved line.
  const anyPresent = slots.some((s) => s.present);
  return html`
      <h2>Load a Tower</h2>
      ${error ? html`<p class="picker-error" role="alert">${error}</p>` : nothing}
      <div class="slots well">
        ${anyPresent
          ? slots.map((s) => pickerRow(s, h))
          : html`<p class="picker-none">No towers saved on this device.</p>`}
        ${fileRow(h)}
      </div>
      <div class="modal-actions">
        <button class="btn primary" data-picker="back" @click=${h.onBack}>Back</button>
      </div>`;
}

function pickerRow(s: SlotInfo, h: TowerPickerHandlers): TemplateResult {
  const name = slotName(s);
  // Absent: nothing was ever written here.
  if (!s.present) {
    return html`<div class="slot"><div class="slot-head"><b>${name}</b><div class="slot-detail slot-empty">empty</div></div></div>`;
  }
  // Present but unreadable. The copy says "this version" rather than
  // "corrupt" on purpose: a save written by a NEWER build is unreadable here
  // and may load fine later, which is exactly why the bytes are kept.
  if (!s.exists) {
    return html`<div class="slot"><div class="slot-head"><b>${name}</b><div class="slot-detail slot-unreadable">Couldn't be read by this version.</div></div></div>`;
  }
  return html`<div class="slot"><div class="slot-head"><b>${name}</b>${slotDetail(s)}</div><div class="slot-actions"><button class="btn" data-picker="load" data-slot="${s.slot}" @click=${() => h.onLoad(s.slot)}>Load</button></div></div>`;
}

/** Always present, always last, in every state including the empty one: a
 *  player on a fresh install or a new device has nothing in storage and a
 *  `.vctower` in their downloads, and this row is their only way in. The
 *  accepted formats are named in TEXT because the OS picker's own filter is
 *  unreliable on Android, where an unknown extension can be greyed out. */
function fileRow(h: TowerPickerHandlers): TemplateResult {
  return html`<div class="slot slot-file"><div class="slot-head"><b>Load from a file...</b><div class="slot-detail">A .vctower export, or an original SimTower .TDT save.</div></div><div class="slot-actions"><button class="btn" data-picker="file" @click=${h.onFile}>Choose file</button></div></div>`;
}
