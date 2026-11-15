import { render } from "lit-html";
import { html } from "lit-html";
import type { UI } from "./UI";
import { cleanFileName, type TowerFileEntry } from "../storage/fileSpace";
import type { FilePlace } from "./templates/fileDialogPlaces";
import { lastPlace, pickFolderFiles, placeHandlers, rememberPlace, whereWords, type LinkedPlaceCtx } from "./fileDialogPlaces";
import {
  fileDialogTemplate,
  rowDomId,
  type FileAsk,
  type FileDialogMode,
  type FileDialogView,
  type FileFilter,
  type FileRow,
  type FileSortKey,
} from "./templates/fileDialog";

/**
 * The controller for the Open and Save As windows over My Towers
 * (`templates/fileDialog.ts`). It keeps the window's state (the selection,
 * the typed name, the filter and sort, a question asked in place, a rename
 * under way) and draws the body again on each change, and on each change to
 * the folder from this tab or another while it is open. What a command does
 * to the folder or the tower is the caller's (`FileDialogCtx`), so this file
 * holds no storage and no engine.
 *
 * Keys in the list: arrows, Home and End move; Enter opens or saves; F2
 * renames; Delete deletes; Ctrl+C and Ctrl+V copy and paste a tower (the
 * paste is a copy beside it); the context menu key or Shift+F10 opens the
 * right-click menu. Tower files dropped on the window are added to the folder.
 */

/** A line the window shows under its fields. */
export interface FileNote {
  readonly text: string;
  readonly kind: "bad" | "info";
}

export interface FileDialogCtx {
  readonly mode: FileDialogMode;
  /** The name the File name box starts with. */
  readonly initialName: string;
  /** The Auto-save row (Open only), or null when there is none. */
  auto(): FileRow | null;
  files(): readonly TowerFileEntry[];
  usage(): { count: number; bytes: number };
  /** True while My Towers is still opening or the old save slots are still
   *  being copied in; the list fills in when it is done. */
  loading(): boolean;
  onChange(listener: () => void): () => void;
  /** Open a row. The window is closed before this runs, since an import may
   *  open a window of its own. */
  open(row: FileRow): void;
  /** Save the tower as `name`. `replace` is true once the window has asked
   *  about a file of that name; false refuses one that appeared meanwhile.
   *  Null once saved; the window then closes. */
  save(name: string, replace: boolean): Promise<FileNote | null>;
  rename(id: string, name: string): Promise<FileNote | null>;
  duplicate(id: string): Promise<FileNote | null>;
  remove(id: string): Promise<FileNote | null>;
  /** Files dropped on the window (`drop`), or the towers of a folder the
   *  player picked with From a folder… (`folder`), added to My Towers. */
  add(files: readonly File[], how?: "drop" | "folder"): Promise<FileNote | null>;
  /** The folder linked on the player's computer, where the browser can link
   *  one (`linkedFolderCommands.ts`); null where it can't. */
  linked?: LinkedPlaceCtx | null;
  /** Where linking is not possible: offer From a folder…, which copies a
   *  picked folder's towers into My Towers once. */
  canPickFolder?: boolean;
  /** The place the window starts in, when the caller knows better than the
   *  last one the player looked in (Save As for a tower from the folder). */
  startIn?: FilePlace;
  /** The window asked before replacing or deleting a file (analytics). */
  asked?(kind: FileAsk["kind"]): void;
  /** The way to or from a file on the device. The window is closed first. */
  fromComputer(): void;
  /** Download the autosave this version couldn't read, when one is kept
   *  (Open only). The window is closed first, so a failure is seen. */
  downloadKept: (() => void) | null;
}

/** The tower Copy put on the clipboard, by id. Kept between openings, as a
 *  desktop's clipboard is. */
let copied: string | null = null;

/** Forget the clipboard, for tests. */
export function clearFileClipboardForTests(): void {
  copied = null;
}

const TYPE_ORDER: Readonly<Record<FileRow["type"], number>> = { auto: 0, tower: 1, tdt: 2 };

/** The window's tower count and size, with the Auto-save when it is listed,
 *  so the header counts every tower the window shows. */
export function withAuto(usage: { count: number; bytes: number }, auto: FileRow | null): { count: number; bytes: number } {
  return auto ? { count: usage.count + 1, bytes: usage.bytes + (auto.size ?? 0) } : usage;
}

/** The rows a window shows: the Auto-save first, then the files that pass
 *  the filter, in the chosen order. */
export function fileRows(auto: FileRow | null, files: readonly TowerFileEntry[], filter: FileFilter, sort: FileDialogView["sort"]): FileRow[] {
  const rows: FileRow[] = files
    .filter((f) => filter === "all" || f.kind === filter)
    .map((f) => ({ id: f.id, name: f.name, type: f.kind, size: f.size, modified: f.modified }));
  const by: Record<FileSortKey, (a: FileRow, b: FileRow) => number> = {
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
    type: (a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type],
    size: (a, b) => (a.size ?? 0) - (b.size ?? 0),
    modified: (a, b) => (a.modified ?? 0) - (b.modified ?? 0),
  };
  rows.sort((a, b) => (sort.down ? -1 : 1) * by[sort.key](a, b) || by.name(a, b));
  return auto && filter === "all" ? [auto, ...rows] : rows;
}

/** Whether a drag carries files from the device. */
const carriesFiles = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");

export function showFileDialog(ui: Pick<UI, "openModalTemplate" | "closeModal">, ctx: FileDialogCtx): void {
  const opening = ctx.mode === "open";
  const state = {
    selected: null as string | null,
    name: ctx.initialName,
    filter: "all" as FileFilter,
    sort: { key: "modified" as FileSortKey, down: true },
    line: null as FileNote | null,
    ask: null as FileAsk | null,
    renaming: null as string | null,
    menu: null as FileDialogView["menu"],
    busy: false,
    dropping: false,
    place: (ctx.startIn ?? lastPlace()) as FilePlace,
    look: false,
  };
  const linked = ctx.linked ?? null;
  /** The list shows the linked folder (one is linked and chosen). */
  const inLinked = (): boolean => state.place === "linked" && !!linked?.state();
  const placeFiles = (): readonly TowerFileEntry[] => (inLinked() ? linked!.files() : ctx.files());
  const allowed = (): boolean => !inLinked() || linked!.state()?.access === "granted";
  const placeName = (): string => (inLinked() ? `"${linked!.state()!.name}"` : "My Towers");
  const box = ui.openModalTemplate(html`<h2>${opening ? "Open" : "Save As"}</h2><div class="fd-host"></div>`, { displaceable: opening });
  const host = box.querySelector<HTMLElement>(".fd-host")!;
  box.classList.add("fd-window");
  let rows: FileRow[] = [];

  const rowOf = (id: string | null) => rows.find((r) => r.id === id) ?? null;
  const fileOf = (id: string | null) => {
    const r = rowOf(id);
    return r && r.type !== "auto" ? r : null;
  };

  function draw(): void {
    if (!box.isConnected) {
      off();
      return;
    }
    const here = inLinked();
    const auto = opening && !here ? ctx.auto() : null;
    rows = fileRows(auto, placeFiles(), state.filter, state.sort);
    if (state.selected !== null && !rowOf(state.selected)) state.selected = null;
    const folder = linked?.state() ?? null;
    const view = {
      ...state,
      mode: ctx.mode,
      rows,
      usage: here ? linked!.usage() : withAuto(ctx.usage(), auto),
      loading: !here && ctx.loading(),
      canPaste: copied !== null,
      kept: ctx.downloadKept !== null,
      place: here ? ("linked" as const) : ("local" as const),
      linked: folder ? { name: folder.name, allowed: folder.access === "granted" } : null,
      canLink: !!linked?.canLink,
      canPickFolder: !!ctx.canPickFolder,
      where: whereWords(),
      lookOpen: state.look,
    };
    render(fileDialogTemplate(view, handlers), host);
  }
  const offFiles = ctx.onChange(draw);
  const offLinked = linked?.onChange(draw);
  const off = () => {
    offFiles();
    offLinked?.();
  };

  function set(change: Partial<typeof state>): void {
    Object.assign(state, change);
    draw();
  }

  /** Run a folder command with the buttons grayed, then show its note. */
  async function run(command: () => Promise<FileNote | null>): Promise<FileNote | null> {
    set({ busy: true, line: null, menu: null });
    let note: FileNote | null;
    try {
      note = await command();
    } catch (err) {
      note = { text: err instanceof Error ? err.message : String(err), kind: "bad" };
    }
    if (box.isConnected) set({ busy: false, line: note });
    return note;
  }

  function select(id: string): void {
    const r = rowOf(id);
    if (!r) return;
    set({ selected: id, name: r.name, menu: null, line: null });
    document.getElementById(rowDomId(id))?.scrollIntoView?.({ block: "nearest" });
  }

  function activate(id: string): void {
    const r = rowOf(id);
    if (!r) return;
    if (opening) {
      ui.closeModal();
      if (inLinked()) linked!.open(r);
      else ctx.open(r);
      return;
    }
    if (r.type === "auto") return;
    set({ selected: id, name: r.name });
    primary();
  }

  function primary(): void {
    // Not before the list is in: a name check against half a list could
    // save over a tower without asking.
    if (state.busy || state.ask || (!inLinked() && ctx.loading()) || !allowed()) return;
    const name = cleanFileName(state.name);
    if (!name) {
      set({ line: { text: "Type a name for the tower.", kind: "bad" } });
      return;
    }
    const match = rows.find((r) => r.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (opening) {
      if (match) activate(match.id);
      else set({ line: { text: `There's no tower named "${name}" in ${placeName()}.`, kind: "bad" } });
      return;
    }
    // Saving writes a .vctower, so in the linked folder only another
    // .vctower of that name is replaced; a .TDT beside it stays.
    const taken = placeFiles().some((f) => (!inLinked() || f.kind === "tower") && f.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (taken) ask({ kind: "replace", name });
    else void save(name, false);
  }

  async function save(name: string, replace: boolean): Promise<void> {
    const note = await run(() => (inLinked() ? linked!.save(name, replace) : ctx.save(name, replace)));
    if (note === null && box.isConnected) ui.closeModal();
  }

  /** Put a question in its message box, with the focus on No: both
   *  questions guard a step that can't be taken back. */
  function ask(question: FileAsk): void {
    set({ ask: question, menu: null });
    host.querySelector<HTMLElement>('[data-fd-ask="no"]')?.focus();
    ctx.asked?.(question.kind);
  }

  function answer(yes: boolean): void {
    const asked = state.ask;
    set({ ask: null });
    if (!yes || !asked) {
      focusAfterAsk(asked);
      return;
    }
    if (asked.kind === "replace") void save(asked.name, true);
    else {
      const target = fileOf(state.selected);
      if (target) void run(() => ctx.remove(target.id));
    }
  }

  function startRename(): void {
    const target = fileOf(state.selected);
    // The game never renames a file on the player's computer.
    if (!target || state.busy || inLinked()) return;
    set({ renaming: target.id, menu: null, line: null });
    const input = host.querySelector<HTMLInputElement>(".fd-rename");
    input?.focus();
    input?.select();
  }

  function renameDone(value: string | null): void {
    const id = state.renaming;
    if (id === null) return;
    set({ renaming: null });
    focusList();
    const was = rowOf(id);
    if (value === null || !was || cleanFileName(value) === was.name) return;
    void run(() => ctx.rename(id, value)).then((note) => {
      if (note === null && box.isConnected) set({ name: cleanFileName(value) });
    });
  }

  function remove(): void {
    const target = fileOf(state.selected);
    // Nor deletes one (owner, 2026-11-15).
    if (target && !state.busy && !inLinked()) ask({ kind: "delete", name: target.name });
  }

  function copy(): void {
    const target = fileOf(state.selected);
    if (!target || inLinked()) return;
    copied = target.id;
    set({ line: { text: `Copied "${target.name}". Paste makes a copy of it here.`, kind: "info" }, menu: null });
  }

  function paste(): void {
    const id = copied;
    if (id === null || state.busy || inLinked()) return;
    if (!ctx.files().some((f) => f.id === id)) {
      copied = null;
      set({ line: { text: "The tower you copied has been deleted.", kind: "bad" } });
      return;
    }
    void run(() => ctx.duplicate(id));
  }

  function duplicate(): void {
    const target = fileOf(state.selected);
    if (target && !state.busy) void run(() => (inLinked() ? linked!.duplicate(target.id) : ctx.duplicate(target.id)));
  }

  function focusList(): void {
    host.querySelector<HTMLElement>(".fd-rows")?.focus();
  }

  /** Back where the question came from once it is dropped: the File name box
   *  after Save As asked about a name, else the list. */
  function focusAfterAsk(asked: FileAsk | null): void {
    if (asked?.kind === "replace") host.querySelector<HTMLElement>("#fd-name")?.focus();
    else focusList();
  }

  function listKey(e: KeyboardEvent): void {
    const at = rows.findIndex((r) => r.id === state.selected);
    const move = (i: number) => {
      e.preventDefault();
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (r) select(r.id);
    };
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at < 0 ? 0 : at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(rows.length - 1);
    else if (e.key === "Enter" && state.selected) {
      e.preventDefault();
      activate(state.selected);
    } else if (e.key === "F2") {
      e.preventDefault();
      startRename();
    } else if (e.key === "Delete") {
      e.preventDefault();
      remove();
    } else if (ctrl && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copy();
    } else if (ctrl && e.key.toLowerCase() === "v") {
      e.preventDefault();
      paste();
    } else if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && state.selected) {
      e.preventDefault();
      const rect = document.getElementById(rowDomId(state.selected))?.getBoundingClientRect();
      openMenu(state.selected, rect ? rect.left + 24 : 0, rect ? rect.bottom : 0);
    }
  }

  /** The menu opens at the pointer, placed within the window's body. */
  /** The right-click menu at (x, y) on the screen, kept inside the window:
   *  a press near the right or bottom edge (a phone's long-press) opens it
   *  to the left of or above the finger instead of off the edge. */
  function openMenu(id: string, x: number, y: number): void {
    const frame = (host.querySelector(".fd") ?? box).getBoundingClientRect();
    set({ selected: id, name: rowOf(id)?.name ?? state.name, menu: { id, x: x - frame.left, y: y - frame.top } });
    const menu = host.querySelector<HTMLElement>(".fd-menu");
    if (menu) {
      const inside = (at: number, size: number, room: number) => Math.max(0, Math.min(at, room - size));
      const kept = { id, x: inside(x - frame.left, menu.offsetWidth, frame.width), y: inside(y - frame.top, menu.offsetHeight, frame.height) };
      if (kept.x !== state.menu?.x || kept.y !== state.menu?.y) set({ menu: kept });
    }
    host.querySelector<HTMLElement>(".fd-menu .mb-item")?.focus();
  }

  const handlers = {
    select,
    activate,
    name: (value: string) => {
      const r = rowOf(state.selected);
      set({ name: value, selected: r && r.name === value ? r.id : null, line: null });
    },
    filter: (value: FileFilter) => set({ filter: value }),
    sort: (key: FileSortKey) => set({ sort: { key, down: state.sort.key === key ? !state.sort.down : key === "modified" } }),
    primary,
    cancel: () => ui.closeModal(),
    rename: startRename,
    renameDone,
    copy,
    paste,
    duplicate,
    remove,
    answer,
    openMenu,
    closeMenu: () => {
      if (state.menu || state.look) set({ menu: null, look: false });
    },
    listKey,
    fromComputer: () => {
      ui.closeModal();
      ctx.fromComputer();
    },
    downloadKept: () => {
      ui.closeModal();
      ctx.downloadKept?.();
    },
    fromFolder: () =>
      pickFolderFiles((files) => {
        if (!box.isConnected) return;
        if (files.length === 0) set({ line: { text: "There are no tower files (.vctower or .TDT) in that folder.", kind: "bad" } });
        else void run(() => ctx.add(files, "folder")).then(() => set({ place: "local" }));
      }),
    allow: () => void run(() => linked!.allow()),
    places: placeHandlers({
      state: () => state,
      set,
      linked,
      run,
      host,
      focusList,
      remember: rememberPlace,
    }),
  };

  // Esc closes what is open inside the window before the window itself, and
  // Tab stays inside a message box until it is answered.
  box.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && state.ask) {
      e.preventDefault();
      const [yes, no] = [...host.querySelectorAll<HTMLElement>(".fd-ask .btn")];
      (document.activeElement === yes ? no : yes)?.focus();
      return;
    }
    if (e.key !== "Escape" || !(state.menu || state.ask || state.look)) return;
    e.preventDefault();
    e.stopPropagation();
    const asked = state.ask;
    const looking = state.look && !asked;
    set({ menu: null, ask: null, look: false });
    if (looking) host.querySelector<HTMLElement>(".fd-look")?.focus();
    else focusAfterAsk(asked);
  });
  box.addEventListener("dragenter", (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    if (!state.dropping) set({ dropping: true });
  });
  box.addEventListener("dragover", (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  box.addEventListener("dragleave", (e) => {
    if (state.dropping && !(e.relatedTarget instanceof Node && box.contains(e.relatedTarget))) set({ dropping: false });
  });
  box.addEventListener("drop", (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    set({ dropping: false });
    const files = Array.from(e.dataTransfer?.files ?? []);
    // Dropped files go to My Towers, so the list shows them there.
    if (files.length > 0) void run(() => ctx.add(files, "drop")).then(() => set({ place: "local" }));
  });

  draw();
  // The folder is read back only when a window shows it, and its files may
  // have changed on disk since it was last read.
  if (inLinked()) void linked!.refresh().catch(() => {});
  if (opening) focusList();
  else {
    const input = host.querySelector<HTMLInputElement>("#fd-name");
    input?.focus();
    input?.select();
  }
}
