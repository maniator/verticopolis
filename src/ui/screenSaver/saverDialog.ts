import { html } from "lit-html";
import type { ModalView } from "@verticopolis/components/windows/uiModal";
import type { UI } from "../UI";
import { runScene } from "./screenSaver";
import type { SaverScene } from "./saverScene";
import {
  NO_SAVER,
  SAVERS,
  SAVER_NAMES,
  WAIT_MINUTES,
  type SaverChoice,
  type SaverId,
  type SaverPrefs,
} from "./saverPrefs";

/**
 * Options > Screen Saver…: the period Screen Saver dialog. A small monitor
 * plays the picked saver, the list picks one (or none), Wait sets the
 * minutes, a box says whether it also shows on the way back to the tab, and
 * Preview plays it full screen and comes back to the dialog. OK keeps the
 * choices; Cancel, the ✕ and Escape drop them.
 *
 * The monitor's scene runs only while its canvas is on the page
 * (`runScene` stops itself once the canvas is gone, whatever closed the
 * dialog).
 */

export interface SaverDialogPorts {
  /** Build a saver's scene for a canvas this size. */
  makeScene(id: SaverId, w: number, h: number): SaverScene;
  /** One still frame instead of motion. */
  still(): boolean;
  /** Keep the choices (OK). */
  save(p: SaverPrefs): void;
  /** Play a saver full screen, then call `back` when the player ends it. */
  preview(id: SaverId, back: () => void): void;
}

/** The monitor's canvas size, in its own pixels (the frame is 2x that). */
export const MONITOR_W = 88;
export const MONITOR_H = 66;

export interface SaverDialogHandlers {
  onPick(choice: SaverChoice): void;
  onWait(minutes: number): void;
  onReturn(on: boolean): void;
  onPreview(): void;
  onOk(): void;
  onCancel(): void;
}

export function screenSaverTemplate(p: SaverPrefs, h: SaverDialogHandlers): ModalView {
  const none = p.saver === NO_SAVER;
  return {
    title: "Screen Saver",
    body: html`
    <div class="saver-monitor" aria-hidden="true">
      <div class="saver-bezel"><canvas class="saver-screen" width=${MONITOR_W} height=${MONITOR_H}></canvas></div>
      <div class="saver-stand"></div>
    </div>
    <fieldset class="saver-group">
      <legend>Screen saver</legend>
      <div class="saver-row">
        <select id="saver-pick" aria-label="Screen saver" @change=${(e: Event) => h.onPick((e.target as HTMLSelectElement).value as SaverChoice)}>
          <option value=${NO_SAVER} .selected=${none}>(None)</option>
          ${SAVERS.map((id) => html`<option value=${id} .selected=${p.saver === id}>${SAVER_NAMES[id]}</option>`)}
        </select>
        <button class="btn" data-saver="preview" ?disabled=${none} @click=${h.onPreview}>Preview</button>
      </div>
      <div class="saver-row">
        <label for="saver-wait">Wait:</label>
        <select id="saver-wait" ?disabled=${none} @change=${(e: Event) => h.onWait(Number((e.target as HTMLSelectElement).value))}>
          ${WAIT_MINUTES.map((m) => html`<option value=${m} .selected=${p.waitMinutes === m}>${m}</option>`)}
        </select>
        <span>minutes, while the tower is paused</span>
      </div>
      <label class="saver-check">
        <input type="checkbox" id="saver-return" ?disabled=${none} .checked=${p.onReturn} @change=${(e: Event) => h.onReturn((e.target as HTMLInputElement).checked)} />
        Also when I come back to this tab after that long
      </label>
    </fieldset>
    <p class="saver-note">Any key, click or tap, or moving the mouse, brings your tower back, and that input never builds anything.</p>
    <div class="modal-actions modal-footer">
      <button class="btn primary" data-saver="ok" @click=${h.onOk}>OK</button>
      <button class="btn" data-saver="cancel" @click=${h.onCancel}>Cancel</button>
    </div>
  `,
  };
}

/** Open the dialog over the tower with `start` as its first choices. */
export function openScreenSaverDialog(ui: UI, start: SaverPrefs, ports: SaverDialogPorts): void {
  const draft: SaverPrefs = { ...start };
  let stopMonitor = () => {};
  let box: HTMLElement | null = null;
  const play = () => {
    stopMonitor();
    const canvas = box?.querySelector<HTMLCanvasElement>(".saver-screen");
    if (!canvas) return;
    if (draft.saver === NO_SAVER) {
      const c = canvas.getContext("2d");
      if (c) {
        c.fillStyle = "#000";
        c.fillRect(0, 0, MONITOR_W, MONITOR_H);
      }
      stopMonitor = () => {};
      return;
    }
    stopMonitor = runScene(canvas, ports.makeScene(draft.saver, MONITOR_W, MONITOR_H), ports.still());
  };
  const close = () => {
    stopMonitor();
    ui.closeModal();
  };
  const handlers: SaverDialogHandlers = {
    onPick: (choice) => {
      draft.saver = choice;
      mount();
    },
    onWait: (m) => {
      draft.waitMinutes = m;
    },
    onReturn: (on) => {
      draft.onReturn = on;
    },
    onPreview: () => {
      if (draft.saver === NO_SAVER) return;
      const id = draft.saver;
      close();
      ports.preview(id, () => openScreenSaverDialog(ui, draft, ports));
    },
    onOk: () => {
      ports.save({ ...draft });
      close();
    },
    onCancel: close,
  };
  function mount(): void {
    box = ui.openModal(screenSaverTemplate(draft, handlers), { displaceable: true });
    // Set the lists from the draft once their options are in place: an
    // option marked selected before it joins its list does not hold in every
    // DOM.
    const pick = box.querySelector<HTMLSelectElement>("#saver-pick");
    const wait = box.querySelector<HTMLSelectElement>("#saver-wait");
    if (pick) pick.value = draft.saver;
    if (wait) wait.value = String(draft.waitMinutes);
    play();
  }
  mount();
}
