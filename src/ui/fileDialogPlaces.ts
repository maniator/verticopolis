import type { TowerFileEntry } from "../storage/fileSpace";
import { linkedFileKind, type LinkedFolderState } from "../storage/linkedFolder";
import type { FileNote } from "./fileDialog";
import type { FileRow } from "./templates/fileDialog";
import type { FilePlace, PlacesHandlers } from "./templates/fileDialogPlaces";

/**
 * The Open and Save As windows' two places (`fileDialog.ts`): My Towers, in
 * the browser, and the folder linked on the player's computer
 * (`docs/architecture/linked-folder.md`). This holds what the Look in box
 * does: switching place, linking a folder, unlinking it, and the keys of its
 * menu. What a command does to the folder is the caller's
 * ({@link LinkedPlaceCtx}), so this file holds no storage.
 */

/** What the windows do with the linked folder. Each answers a note to show,
 *  or null once done. */
export interface LinkedPlaceCtx {
  /** This browser can link a folder at all. */
  readonly canLink: boolean;
  state(): LinkedFolderState | null;
  files(): readonly TowerFileEntry[];
  usage(): { count: number; bytes: number };
  onChange(listener: () => void): () => void;
  /** Read the folder again (its files may have changed on disk). */
  refresh(): Promise<void>;
  /** Ask for a folder and link it. Calls the browser's picker before its
   *  first await, so the click that asked still counts. */
  link(): Promise<"linked" | "cancel" | FileNote>;
  /** Ask the browser for the player's OK again. Run it from a click; see
   *  `linkedFolder.allow` for when it can ask. */
  allow(): Promise<FileNote | null>;
  unlink(): Promise<FileNote | null>;
  /** Whether the Auto-save is copied into the folder too. */
  mirror(): boolean;
  /** Turn that copy on (writing it now) or off. */
  setMirror(on: boolean): Promise<FileNote | null>;
  /** Open a row. The window is closed before this runs. */
  open(row: FileRow): void;
  save(name: string, replace: boolean): Promise<FileNote | null>;
  duplicate(id: string): Promise<FileNote | null>;
}

/** The place the player last looked in, kept between openings this visit. */
let last: FilePlace = "local";

export function lastPlace(): FilePlace {
  return last;
}

export function rememberPlace(place: FilePlace): void {
  last = place;
}

/** Forget the last place, for tests. */
export function resetFilePlaceForTests(): void {
  last = "local";
}

/** "device" where the main pointer is a finger, else "computer". */
export function whereWords(): "computer" | "device" {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? "device" : "computer";
}

/** Let the player pick a folder and answer its tower files (by extension),
 *  for From a folder…; nothing when they cancel. */
export function pickFolderFiles(take: (files: File[]) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.setAttribute("webkitdirectory", "");
  input.addEventListener("change", () => take(Array.from(input.files ?? []).filter((f) => linkedFileKind(f.name) !== null)), { once: true });
  input.click();
}

/** What {@link placeHandlers} needs of the window. */
export interface PlaceDeps {
  state(): { readonly look: boolean };
  set(change: { place?: FilePlace; look?: boolean; selected?: null; line?: null; menu?: null }): void;
  readonly linked: LinkedPlaceCtx | null;
  run(command: () => Promise<FileNote | null>): Promise<FileNote | null>;
  readonly host: HTMLElement;
  focusList(): void;
  remember(place: FilePlace): void;
}

/** The Look in box's handlers. */
export function placeHandlers(d: PlaceDeps): PlacesHandlers {
  const items = () => [...d.host.querySelectorAll<HTMLElement>('.fd-look-item:not([aria-disabled="true"])')];
  const focusItem = (i: number) => {
    const list = items();
    list[(i + list.length) % list.length]?.focus();
  };
  const openLook = () => {
    d.set({ look: true, menu: null });
    focusItem(0);
  };
  return {
    toggleLook(e) {
      // The window's own click would close it again.
      e.stopPropagation();
      if (d.state().look) d.set({ look: false });
      else openLook();
    },
    lookKey(e) {
      const at = items().indexOf(document.activeElement as HTMLElement);
      const STEPS: Readonly<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };
      const step = STEPS[e.key] ?? 0;
      if (!d.state().look) {
        if (step !== 0 || e.key === "F4") {
          e.preventDefault();
          openLook();
        }
        return;
      }
      if (step !== 0) {
        e.preventDefault();
        focusItem(at < 0 ? 0 : at + step);
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        focusItem(e.key === "Home" ? 0 : -1);
      } else if (e.key === "Tab") d.set({ look: false });
    },
    choose(place) {
      d.remember(place);
      d.set({ place, look: false, selected: null, line: null });
      if (place === "linked") void d.linked?.refresh().catch(() => {});
      d.focusList();
    },
    link() {
      const linked = d.linked;
      if (!linked) return;
      d.set({ look: false });
      void d.run(async () => {
        const result = await linked.link();
        if (result !== "linked") return result === "cancel" ? null : result;
        d.remember("linked");
        d.set({ place: "linked", selected: null });
        return null;
      });
    },
    unlink() {
      const linked = d.linked;
      const name = linked?.state()?.name;
      if (!linked || !name) return;
      d.set({ look: false });
      void d.run(async () => {
        const note = await linked.unlink();
        if (note) return note;
        d.remember("local");
        d.set({ place: "local", selected: null });
        return { text: `Unlinked "${name}". Its files are still there.`, kind: "info" };
      });
    },
    toggleMirror() {
      const linked = d.linked;
      if (!linked?.state()) return;
      d.set({ look: false });
      void d.run(() => linked.setMirror(!linked.mirror()));
    },
  };
}
