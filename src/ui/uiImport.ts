import type { UI } from "./UI";
import { TOWER_FILE_EXT } from "../storage/SaveGame";
import { looksLikeLegacyTower } from "../storage/tdtImportHelpers";
import { isMobileDevice } from "./bugReport";

/**
 * The file-picker entry point, in its own module so both the in-game Saved
 * Towers manager (`./uiDialogs`) and the title screen's tower picker
 * (`./uiTowerPicker`) can reach it. Keeping it here breaks what would otherwise
 * be an import cycle: `uiDialogs` re-exports `uiTowerPicker`, so the picker
 * importing `uiDialogs` back would only work by accident of every reference
 * sitting inside a function body. `uiDialogs` re-exports this, so its existing
 * callers are unchanged.
 */

/** The two kinds of file the picker offers: our own `.vctower`, and an
 *  original 1994 SimTower save (`.TDT`). */
const LEGACY_TOWER_EXT = ".tdt";

const READ_FAILED = "Couldn't read that file. Please try again.";

/** The `accept` list for the plain `<input type="file">` picker. A desktop
 *  picker filters by extension, so it gets exactly the two tower extensions.
 *  A phone or tablet picker filters by file type instead, and a `.vctower` has
 *  no registered type there, so it only stays pickable through the generic
 *  `application/octet-stream` entry (Android, and iOS maps it to "any data").
 *  That entry widens the filter, so it is offered on phones and tablets only. */
export function towerFileAccept(mobile: boolean): string {
  const extensions = [TOWER_FILE_EXT, LEGACY_TOWER_EXT, LEGACY_TOWER_EXT.toUpperCase()];
  if (mobile) extensions.splice(1, 0, "application/octet-stream");
  return extensions.join(",");
}

/** The slice of the File System Access API the import uses. It is missing
 *  from TypeScript's DOM types, and from most browsers (Chromium desktop has
 *  it; Firefox, Safari and phones do not). */
interface TowerFilePickerOptions {
  id: string;
  multiple: false;
  excludeAcceptAllOption: true;
  types: { description: string; accept: Record<string, string[]> }[];
}
type ShowOpenFilePicker = (options: TowerFilePickerOptions) => Promise<{ getFile(): Promise<File> }[]>;

/** The file type the native picker filters on. Chromium adds every extension
 *  a platform maps to a key's MIME type, so a known type such as
 *  `application/octet-stream` would also list `.bin`, `.exe` and `.com`. A
 *  type no platform knows leaves only the two extensions listed with it. */
export const TOWER_PICKER_MIME = "application/x-verticopolis-tower";

/** Options for the native picker: only tower files, and no "All files" escape
 *  hatch, so the dialog filters for the player. The `id` lets the browser
 *  reopen the folder a tower was last picked from. */
export const TOWER_FILE_PICKER_OPTIONS: TowerFilePickerOptions = {
  id: "tower-import",
  multiple: false,
  excludeAcceptAllOption: true,
  types: [
    {
      description: "Tower files (.vctower, .TDT)",
      accept: { [TOWER_PICKER_MIME]: [TOWER_FILE_EXT, LEGACY_TOWER_EXT] },
    },
  ],
};

/** Import goes straight to the file picker, exports are .vctower downloads
 *  now, so there is deliberately no paste-a-save textarea anymore. Where the
 *  browser has a native picker that can hide every other file (Chromium on a
 *  desktop), that picker opens; everywhere else the `<input>` picker opens with
 *  the tightest filter that platform honors. Either way the content is still
 *  validated on load, and a 1994 save renamed to another extension (where a
 *  picker still lets one through) routes right via the header-magic sniff. */
export function openImport(ui: UI): void {
  const showPicker = nativePicker();
  if (!showPicker) {
    openInputPicker(ui);
    return;
  }
  void openNativePicker(ui, showPicker);
}

async function openNativePicker(ui: UI, showPicker: ShowOpenFilePicker): Promise<void> {
  let handles: Awaited<ReturnType<ShowOpenFilePicker>>;
  try {
    handles = await showPicker(TOWER_FILE_PICKER_OPTIONS);
  } catch (err) {
    // Closing the picker without choosing a file is not an error.
    if (err instanceof DOMException && err.name === "AbortError") return;
    // A picker the page may not open (an embedded frame, a browser policy)
    // falls back to the plain picker, which every browser has.
    openInputPicker(ui);
    return;
  }
  const handle = handles[0];
  if (!handle) return;
  let file: File;
  try {
    file = await handle.getFile();
  } catch {
    // The file was picked but moved, deleted or locked before it opened.
    ui.sayVisibly(READ_FAILED);
    return;
  }
  readPickedFile(ui, file);
}

/** The native picker, on a desktop browser that has one. Phones and tablets
 *  keep the `<input>` picker and its file-type filter: an Android picker
 *  filters by type, and a `.vctower` has none registered there. An Android
 *  tablet asking for the desktop site reports a desktop user agent, so the
 *  platform hint catches it where the browser still gives it. */
function nativePicker(): ShowOpenFilePicker | undefined {
  if (usesTypePicker()) return undefined;
  const picker = (window as { showOpenFilePicker?: ShowOpenFilePicker }).showOpenFilePicker;
  return typeof picker === "function" ? picker.bind(window) : undefined;
}

/** Whether this device's picker filters by file type (a phone or tablet,
 *  Android in desktop-site mode included) rather than by extension. */
function usesTypePicker(): boolean {
  const hints = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  return isMobileDevice(navigator) || hints?.platform === "Android";
}

function openInputPicker(ui: UI): void {
  const input = document.getElementById("import-file") as HTMLInputElement;
  input.accept = towerFileAccept(usesTypePicker());
  input.value = "";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) readPickedFile(ui, file);
  };
  input.click();
}

/** `VCTOWER2` and a newline: a binary `.vctower` file. */
const BINARY_TOWER_FILE = new TextEncoder().encode("VCTOWER2\n");

/** Whether `bytes` start as a binary `.vctower` file does. */
export function isBinaryTowerFile(bytes: Uint8Array): boolean {
  return bytes.length >= BINARY_TOWER_FILE.length && BINARY_TOWER_FILE.every((b, i) => bytes[i] === b);
}

/** A text tower file's bytes as text. BOM sniffing keeps the old readAsText
 *  behavior, so a UTF-16 re-save still decodes. */
export function decodeTowerText(b: Uint8Array): string {
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b);
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b);
  return new TextDecoder().decode(b); // UTF-8; strips a UTF-8 BOM itself
}

/** Open a file picked or dropped from the device. */
export function readPickedFile(ui: UI, file: File): void {
  const reader = new FileReader();
  // A file that vanishes or errors mid-read must not fail silently: the
  // launching dialog is already gone by the time the read runs.
  reader.onerror = () => ui.sayVisibly(READ_FAILED);
  // Every pick is read as bytes and routed through ONE heuristic
  // (looksLikeLegacyTower): extension first, then the header-magic sniff, so a
  // renamed original save still lands on the legacy importer. Everything else
  // decodes as text for the .vctower path. The file's name and bytes go along,
  // so a tower that opens is kept in My Towers.
  reader.onload = () => {
    const buffer = reader.result as ArrayBuffer;
    const bytes = new Uint8Array(buffer);
    const from = { name: file.name, bytes };
    if (looksLikeLegacyTower(file.name, bytes)) ui.cb.onImportLegacy(buffer, file.name);
    // A binary tower file goes to the engine as it is: decoding it as text
    // would change its bytes.
    else if (isBinaryTowerFile(bytes)) ui.cb.onImport(bytes, from);
    else ui.cb.onImport(decodeTowerText(bytes), from);
  };
  reader.readAsArrayBuffer(file);
}
