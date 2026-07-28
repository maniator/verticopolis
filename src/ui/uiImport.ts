import type { UI } from "./UI";
import { TOWER_FILE_EXT } from "../storage/SaveGame";
import { looksLikeLegacyTower } from "../storage/tdtImport";

/**
 * The file-picker entry point, in its own module so both the in-game Saved
 * Towers manager (`./uiDialogs`) and the title screen's tower picker
 * (`./uiTowerPicker`) can reach it. Keeping it here breaks what would otherwise
 * be an import cycle: `uiDialogs` re-exports `uiTowerPicker`, so the picker
 * importing `uiDialogs` back would only work by accident of every reference
 * sitting inside a function body. `uiDialogs` re-exports this, so its existing
 * callers are unchanged.
 */

/** Import goes straight to the file picker, exports are .vctower downloads
 *  now, so there is deliberately no paste-a-save textarea anymore. */
export function openImport(ui: UI): void {
  const input = document.getElementById("import-file") as HTMLInputElement;
  // Single source of truth for our own extension; the octet-stream entry keeps
  // .vctower selectable on pickers that filter by MIME type (Android). Original
  // 1994 SimTower saves (.TDT) import too; content is validated on load either
  // way, and a renamed save still routes right via the header-magic sniff.
  input.accept = `${TOWER_FILE_EXT},application/octet-stream,.tdt,.TDT`;
  input.value = "";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    // A file that vanishes or errors mid-read must not fail silently: the
    // launching dialog is already gone by the time the read runs.
    reader.onerror = () => ui.toast("Couldn't read that file. Please try again.", "bad");
    // Every pick is read as bytes and routed through ONE heuristic
    // (looksLikeLegacyTower): extension first, then the header-magic sniff, so a
    // renamed original save still lands on the legacy importer. Everything else
    // decodes as text for the .vctower path. BOM sniffing preserves the old
    // readAsText behavior (UTF-16 re-saves must keep decoding).
    const decodeText = (b: Uint8Array): string => {
      if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b);
      if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b);
      return new TextDecoder().decode(b); // UTF-8; strips a UTF-8 BOM itself
    };
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer;
      const bytes = new Uint8Array(buffer);
      if (looksLikeLegacyTower(file.name, bytes)) ui.cb.onImportLegacy(buffer, file.name);
      else ui.cb.onImport(decodeText(bytes));
    };
    reader.readAsArrayBuffer(file);
  };
  input.click();
}
