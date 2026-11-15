import { html, nothing, type TemplateResult } from "lit-html";
import { classMap } from "lit-html/directives/class-map.js";
import { live } from "lit-html/directives/live.js";
import { FILE_NAME_MAX } from "../../storage/fileSpace";
import { fileIcon, folderIcon, warningIcon } from "../fileIcons";

/**
 * The Open and Save As windows over My Towers (owner, 2026-11-15, layout A):
 * a list with Name, Type, Size and Modified columns, a "File name" box and a
 * type filter, as a 1990s program's file dialogs have. On a phone the rows
 * turn into two-line cards (`dialogs.css`). This is the body only: the
 * controller (`../fileDialog.ts`) holds the state and draws it again on each
 * change.
 */

export type FileDialogMode = "open" | "saveAs";
export type FileRowType = "auto" | "tower" | "tdt";
export type FileFilter = "all" | "tower" | "tdt";
export type FileSortKey = "name" | "type" | "size" | "modified";

/** One row of the list: a My Towers file, or the Auto-save. */
export interface FileRow {
  readonly id: string;
  readonly name: string;
  readonly type: FileRowType;
  readonly size?: number;
  readonly modified?: number;
}

/** A question the window asks in a message box on top of itself. */
export interface FileAsk {
  readonly kind: "replace" | "delete";
  readonly name: string;
}

export interface FileDialogView {
  readonly mode: FileDialogMode;
  /** The rows to show, filtered and sorted. */
  readonly rows: readonly FileRow[];
  readonly selected: string | null;
  readonly name: string;
  readonly filter: FileFilter;
  readonly sort: { readonly key: FileSortKey; readonly down: boolean };
  readonly usage: { readonly count: number; readonly bytes: number };
  /** My Towers is still opening, or the old save slots are still coming in. */
  readonly loading: boolean;
  readonly line: { readonly text: string; readonly kind: "bad" | "info" } | null;
  readonly ask: FileAsk | null;
  readonly renaming: string | null;
  readonly menu: { readonly id: string; readonly x: number; readonly y: number } | null;
  readonly canPaste: boolean;
  readonly busy: boolean;
  readonly dropping: boolean;
  /** An autosave this version couldn't read is kept, and can be downloaded. */
  readonly kept: boolean;
}

export interface FileDialogHandlers {
  select(id: string): void;
  activate(id: string): void;
  name(value: string): void;
  filter(value: FileFilter): void;
  sort(key: FileSortKey): void;
  primary(): void;
  cancel(): void;
  rename(): void;
  renameDone(value: string | null): void;
  copy(): void;
  paste(): void;
  duplicate(): void;
  remove(): void;
  answer(yes: boolean): void;
  openMenu(id: string, x: number, y: number): void;
  closeMenu(): void;
  listKey(e: KeyboardEvent): void;
  fromComputer(): void;
  downloadKept(): void;
}

export const FILE_TYPE_LABEL: Readonly<Record<FileRowType, string>> = {
  auto: "Auto-save",
  tower: "Tower",
  tdt: "SimTower 1994",
};

const FILTER_LABEL: Readonly<Record<FileFilter, string>> = {
  all: "All towers",
  tower: "Tower (*.vctower)",
  tdt: "SimTower 1994 (*.TDT)",
};

const COLUMNS: readonly { key: FileSortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "size", label: "Size" },
  { key: "modified", label: "Modified" },
];

/** A size as a file list shows it: KB under a megabyte, then MB. */
export function fileSizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const kb = bytes / 1024;
  return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
}

/** When a file was written, short: month/day and the time. */
export function fileWhenText(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "12 towers, 2.1 MB". */
export function usageText(usage: { count: number; bytes: number }): string {
  const towers = usage.count === 1 ? "1 tower" : `${usage.count} towers`;
  return usage.count === 0 ? "No towers yet" : `${towers}, ${fileSizeText(usage.bytes)}`;
}

/** The row element's id, for the list's active descendant. */
export const rowDomId = (id: string): string => `fd-row-${id}`;

export function fileDialogTemplate(v: FileDialogView, h: FileDialogHandlers): TemplateResult {
  const opening = v.mode === "open";
  const selectedRow = v.rows.find((r) => r.id === v.selected) ?? null;
  const fileSelected = !!selectedRow && selectedRow.type !== "auto";
  return html`
    <div class=${classMap({ fd: true, "fd-dropping": v.dropping })}>
      <div class="fd-where">
        <span class="fd-where-label">${opening ? "Look in:" : "Save in:"}</span>
        <span class="fd-folder field">${folderIcon()}My Towers</span>
        <span class="fd-usage">${v.loading ? "Opening My Towers…" : usageText(v.usage)}</span>
      </div>
      <div class="fd-list well" @click=${h.closeMenu}>
        <div class="fd-head" role="presentation">
          ${COLUMNS.map(
            (c) => html`<button type="button" class="fd-col fd-col-${c.key}" @click=${() => h.sort(c.key)}
              aria-label="Sort by ${c.label}">${c.label}${sortMark(v, c.key)}</button>`,
          )}
        </div>
        <div class="fd-rows" role="listbox" tabindex="0" aria-label="My Towers"
          aria-activedescendant=${selectedRow ? rowDomId(selectedRow.id) : nothing} @keydown=${h.listKey}>
          ${v.rows.length === 0 ? html`<div class="fd-empty">${emptyText(v)}</div>` : v.rows.map((r) => row(r, v, h))}
        </div>
        ${v.dropping ? html`<div class="fd-drop-note">Drop tower files here to add them to My Towers</div>` : nothing}
      </div>
      ${v.menu ? contextMenu(v, h) : nothing}
      ${v.kept && opening ? keptNote(h) : nothing}
      <div class="fd-fields">
        <label class="fd-label" for="fd-name">File name:</label>
        <input id="fd-name" class="field fd-name" type="text" maxlength=${FILE_NAME_MAX} autocomplete="off" spellcheck="false" placeholder="File name"
          .value=${live(v.name)} @input=${(e: Event) => h.name((e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              e.preventDefault();
              h.primary();
            }
          }} />
        <button type="button" class="btn primary fd-primary" ?disabled=${v.busy || v.loading} @click=${h.primary}>${opening ? "Open" : "Save"}</button>
        <label class="fd-label" for="fd-type">${opening ? "Files of type:" : "Save as type:"}</label>
        ${opening
          ? html`<select id="fd-type" class="field fd-type" .value=${v.filter}
              @change=${(e: Event) => h.filter((e.target as HTMLSelectElement).value as FileFilter)}>
              ${(Object.keys(FILTER_LABEL) as FileFilter[]).map((f) => html`<option value=${f} ?selected=${v.filter === f}>${FILTER_LABEL[f]}</option>`)}
            </select>`
          : html`<select id="fd-type" class="field fd-type"><option>${FILTER_LABEL.tower}</option></select>`}
        <button type="button" class="btn fd-cancel" @click=${h.cancel}>Cancel</button>
      </div>
      ${v.line ? html`<p class=${`fd-line fd-line-${v.line.kind}`} role="alert">${v.line.text}</p>` : nothing}
      ${tools(opening, fileSelected, v, h)}
      ${v.ask ? askBox(v.ask, h) : nothing}
    </div>`;
}

/** The autosave this version couldn't read stays on the device, and the Open
 *  window is where the player can take it to a newer version. */
function keptNote(h: FileDialogHandlers): TemplateResult {
  return html`<p class="fd-kept">
    An autosave this version couldn't read is kept. If a newer version of the game wrote it, update the game and open it again.
    <button type="button" class="btn" @click=${h.downloadKept}>Download it</button>
  </p>`;
}

/** The arrow on the column the list is sorted by. */
function sortMark(v: FileDialogView, key: FileSortKey): string {
  if (v.sort.key !== key) return "";
  return v.sort.down ? " ▼" : " ▲";
}

function emptyText(v: FileDialogView): string {
  if (v.loading) return "Opening My Towers…";
  if (v.filter !== "all") return "No towers of this type.";
  return v.mode === "open" ? "No towers yet. Add one from a file, or drop it here." : "No towers yet.";
}

function row(r: FileRow, v: FileDialogView, h: FileDialogHandlers): TemplateResult {
  const selected = r.id === v.selected;
  const label = r.type === "auto" ? r.name : `${r.name}, ${FILE_TYPE_LABEL[r.type]}`;
  return html`<div id=${rowDomId(r.id)} role="option" aria-selected=${selected ? "true" : "false"} aria-label=${label}
    class=${classMap({ "fd-row": true, [`fd-row-${r.type}`]: true, selected })}
    draggable="false"
    @click=${() => h.select(r.id)} @dblclick=${() => h.activate(r.id)}
    @contextmenu=${(e: MouseEvent) => {
      e.preventDefault();
      h.openMenu(r.id, e.clientX, e.clientY);
    }}>
    ${fileIcon(r.type)}
    ${v.renaming === r.id ? renameBox(r, h) : html`<span class="fd-cell fd-name-cell">${r.name}</span>`}
    <span class="fd-cell fd-type-cell">${FILE_TYPE_LABEL[r.type]}</span>
    <span class="fd-cell fd-size-cell">${r.size === undefined ? "" : fileSizeText(r.size)}</span>
    <span class="fd-cell fd-when-cell">${r.modified === undefined ? "" : fileWhenText(r.modified)}</span>
  </div>`;
}

function renameBox(r: FileRow, h: FileDialogHandlers): TemplateResult {
  return html`<input class="field fd-rename" type="text" maxlength=${FILE_NAME_MAX} aria-label="New name for ${r.name}" .value=${r.name}
    @click=${(e: Event) => e.stopPropagation()}
    @dblclick=${(e: Event) => e.stopPropagation()}
    @keydown=${(e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") h.renameDone((e.target as HTMLInputElement).value);
      else if (e.key === "Escape") {
        e.preventDefault();
        h.renameDone(null);
      }
    }}
    @blur=${(e: Event) => h.renameDone((e.target as HTMLInputElement).value)} />`;
}

function tools(opening: boolean, fileSelected: boolean, v: FileDialogView, h: FileDialogHandlers): TemplateResult {
  return html`<div class="fd-tools">
    <button type="button" class="btn" ?disabled=${!fileSelected || v.busy} @click=${h.rename}>Rename</button>
    <button type="button" class="btn" ?disabled=${!fileSelected || v.busy} @click=${h.duplicate}>Duplicate</button>
    <button type="button" class="btn" ?disabled=${!fileSelected || v.busy} @click=${h.remove}>Delete</button>
    <button type="button" class="btn fd-computer" @click=${h.fromComputer}>
      <span class="fd-on-desktop">${opening ? "From a file on your computer…" : "To a file on your computer…"}</span>
      <span class="fd-on-phone">${opening ? "From your device…" : "To your device…"}</span>
    </button>
  </div>`;
}

/**
 * The question as a 1995 message box: a small window with its own title bar,
 * a warning sign, the question and Yes and No, centered over the window on a
 * layer that blocks everything under it until it is answered (owner,
 * 2026-11-15: a strip along the bottom was easy to miss).
 */
function askBox(ask: FileAsk, h: FileDialogHandlers): TemplateResult {
  const replacing = ask.kind === "replace";
  const [title, line1, line2] = replacing
    ? ["Save As", `"${ask.name}" already exists.`, "Do you want to replace it?"]
    : ["Confirm File Delete", `Are you sure you want to delete "${ask.name}"?`, "It can't be undone."];
  return html`<div class="fd-ask-layer" @click=${(e: Event) => e.stopPropagation()}>
    <div class="win fd-ask" role="alertdialog" aria-modal="true" aria-labelledby="fd-ask-title" aria-describedby="fd-ask-text">
      <div class="win-title" id="fd-ask-title">${title}</div>
      <div class="fd-ask-body">
        ${warningIcon()}
        <p id="fd-ask-text">${line1}<br />${line2}</p>
      </div>
      <div class="fd-ask-buttons">
        <button type="button" class="btn" data-fd-ask="yes" @click=${() => h.answer(true)}>Yes</button>
        <button type="button" class="btn" data-fd-ask="no" @click=${() => h.answer(false)}>No</button>
      </div>
    </div>
  </div>`;
}

function contextMenu(v: FileDialogView, h: FileDialogHandlers): TemplateResult {
  const menu = v.menu!;
  const isFile = v.rows.find((r) => r.id === menu.id)?.type !== "auto";
  const item = (label: string, run: () => void, enabled = true) =>
    html`<button type="button" role="menuitem" class="mb-item" aria-disabled=${enabled ? "false" : "true"}
      @click=${() => {
        h.closeMenu();
        if (enabled) run();
      }}>${label}</button>`;
  return html`<div class="mb-pop fd-menu" role="menu" aria-label="File" style="left:${menu.x}px;top:${menu.y}px">
    ${item(v.mode === "open" ? "Open" : "Save", () => h.activate(menu.id))}
    ${isFile ? item("Rename", h.rename) : nothing}
    ${isFile ? item("Copy", h.copy) : nothing}
    ${item("Paste", h.paste, v.canPaste)}
    ${isFile ? item("Duplicate", h.duplicate) : nothing}
    ${isFile ? item("Delete", h.remove) : nothing}
  </div>`;
}
