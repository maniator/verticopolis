import { isDialogOpen, isEngineStopped, isSplashUp } from "./interactionState";

/** What the File menu's keys run: the same calls its items make. */
export interface FileCommands {
  /** File > Open…: choose a tower file. */
  open(): void;
  /** File > Save: the quick save into the Auto-save. */
  save(): void;
  /** File > Save As…: download the tower as a file. */
  saveAs(): void;
}

/** The File menu's keys, as its items print them. */
export const FILE_SHORTCUT = {
  open: "Ctrl+O",
  save: "Ctrl+S",
  saveAs: "Ctrl+Shift+S",
} as const;

/** Which File command a key press names, if any: Ctrl (Cmd on a Mac) with O,
 *  S, or Shift and S. Alt is left to the menu bar's own keys. */
export function fileCommandFor(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): keyof FileCommands | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === "o" && !e.shiftKey) return "open";
  if (k === "s") return e.shiftKey ? "saveAs" : "save";
  return null;
}

/** Input types that take no typing, so the File keys still work from them. */
const NOT_TYPED = new Set(["button", "checkbox", "radio", "range", "color", "file", "submit", "reset", "image"]);

/** Whether a key press lands in a place that takes typing (a text box, such
 *  as Rename Slot's, a text area, a list box or editable text). The File keys
 *  leave those alone: the command does not run and the browser keeps the key. */
export function typesText(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLInputElement) return !NOT_TYPED.has(target.type);
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLElement && target.isContentEditable;
}

/**
 * Ctrl+O, Ctrl+S and Ctrl+Shift+S run File > Open…, Save and Save As…
 * (owner, 2026-11-15). The browser's own Open and Save Page never show over
 * the game: the press is taken either way, except in a place that takes
 * typing (`typesText`), which keeps its key. New Tower and Close have no
 * keys: Ctrl+N and Ctrl+W belong to the browser. The keys follow the menu's gray:
 * Save and Save As need a tower (not on the title screen), nothing runs over
 * an open dialog, and nothing runs once the engine has stopped. One key
 * listener; a press does two compares before it knows it is not one of these.
 * `report` hears each press that reached a command, grayed or not, for its
 * analytics.
 */
export function wireFileShortcuts(
  commands: FileCommands,
  target: Pick<Window, "addEventListener"> = window,
  report: (command: keyof FileCommands, grayed: boolean) => void = () => {},
): void {
  target.addEventListener("keydown", (e) => {
    const command = fileCommandFor(e);
    if (!command || typesText(e.target)) return;
    e.preventDefault();
    if (e.repeat || isDialogOpen() || isEngineStopped()) return;
    const grayed = command !== "open" && isSplashUp();
    report(command, grayed);
    if (!grayed) commands[command]();
  });
}
