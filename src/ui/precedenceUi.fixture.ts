import { vi } from "vitest";
import { ModalPrecedence, type ModalOpts } from "./modalPrecedence";
import type { UI } from "./UI";

/**
 * A stand-in for the UI's one shared dialog, for unit tests of the report
 * dialogs' waiting rules. The precedence rules are the real
 * {@link ModalPrecedence}; the dialog itself is a flag, and the calls the
 * report makes on it are `vi.fn` spies. It follows `UI.openModalTemplate` and
 * `UI.closeModal` in the one way that matters here: opening tells the
 * precedence whether a dialog was displaced, and closing tells it whether one
 * was open, which is what fires or keeps a waiting report.
 */
export function precedenceUi() {
  const precedence = new ModalPrecedence();
  let open = false;
  const spies = {
    precedence,
    isModalOpen: vi.fn(() => open),
    openModalTemplate: vi.fn((_template: unknown, opts: ModalOpts = {}) => {
      precedence.opening(open, opts);
      open = true;
      return document.createElement("div");
    }),
    closeModal: vi.fn(() => {
      const wasOpen = open;
      open = false;
      precedence.closed(wasOpen);
    }),
    wireActions: vi.fn(),
    sayVisibly: vi.fn(),
  };
  return {
    ui: spies as unknown as UI,
    spies,
    /** Put up a dialog that owns pending work (the precedence's fail-safe
     *  default), the kind a report has to wait behind. */
    openBlocking: () => spies.openModalTemplate(null),
  };
}
