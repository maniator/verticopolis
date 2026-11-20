import { html } from "lit-html";
import type { ModalView } from "@verticopolis/components/windows/uiModal";
import type { UI } from "../UI";
import { SCHEMES, SCHEME_NAMES, type SchemeId } from "./appearancePrefs";

/**
 * Options > Appearance… (and the Control Panel's Appearance icon): the period
 * Appearance dialog. Three small window previews, one per scheme, pick the
 * look; OK dresses the game in it and keeps it, Cancel, the ✕ and Escape leave
 * the look as it was. Nothing changes until OK, so every way out of the dialog
 * other than OK needs no undo.
 *
 * The previews are plain markup that styles/game/appearance.css paints in
 * each scheme's fixed colors (`.appearance-sample[data-sample=…]`), so every
 * preview shows its scheme whatever scheme the page wears.
 */

export interface AppearanceHandlers {
  onPick(id: SchemeId): void;
  onOk(): void;
  onCancel(): void;
}

export function appearanceTemplate(picked: SchemeId, h: AppearanceHandlers): ModalView {
  return {
    title: "Appearance",
    body: html`
    <fieldset class="appearance-group">
      <legend>Scheme</legend>
      <div class="appearance-samples" role="radiogroup" aria-label="Scheme">
        ${SCHEMES.map(
          (id) => html`
            <label class="appearance-choice" data-scheme-choice=${id}>
              <input type="radio" name="appearance-scheme" value=${id} .checked=${picked === id} @change=${() => h.onPick(id)} />
              <span class="appearance-sample" data-sample=${id} aria-hidden="true">
                <span class="appearance-sample-title">Tower</span>
                <span class="appearance-sample-body"><span class="appearance-sample-btn">OK</span></span>
              </span>
              <span class="appearance-name">${SCHEME_NAMES[id]}</span>
            </label>
          `,
        )}
      </div>
    </fieldset>
    <p class="appearance-note">Changes the windows, menus and buttons only. Your tower, its rules and its saves stay the same.</p>
    <div class="modal-actions modal-footer">
      <button class="btn primary" data-appearance="ok" @click=${h.onOk}>OK</button>
      <button class="btn" data-appearance="cancel" @click=${h.onCancel}>Cancel</button>
    </div>
  `,
  };
}

/** Open the dialog with `current` picked. `save` hears OK with the pick. */
export function openAppearanceDialog(ui: UI, current: SchemeId, save: (id: SchemeId) => void): void {
  let picked = current;
  const handlers: AppearanceHandlers = {
    onPick: (id) => {
      picked = id;
    },
    onOk: () => {
      ui.closeModal();
      save(picked);
    },
    onCancel: () => ui.closeModal(),
  };
  const box = ui.openModal(appearanceTemplate(picked, handlers), { displaceable: true });
  box.querySelector<HTMLInputElement>(`input[value="${current}"]`)?.focus();
}
