import { html, nothing, render, type TemplateResult } from "lit-html";
import { classMap } from "lit-html/directives/class-map.js";
import type { TowerVersion } from "../storage/fileVersions";
import type { UI } from "./UI";
import type { FileNote } from "./fileDialog";
import { fileIcon } from "./fileIcons";
import { fileSizeText } from "./templates/fileDialog";

/**
 * Previous Versions (owner, 2026-11-16; save-model party verdict item 3,
 * #2380): the earlier versions My Towers keeps of one tower
 * (`storage/fileVersions.ts`), newest first, from right-click > Previous
 * versions… in the Open and Save As windows. The window takes the place of
 * the one it was opened from, the way Windows' own Previous Versions does,
 * and closing it (Cancel, the ✕, Esc or a click beside it) puts that window
 * back as the player left it. Open makes the picked version a new tower file
 * beside the tower and opens it; the tower itself is never changed.
 */
export interface VersionsCtx {
  /** The tower's file name. */
  readonly name: string;
  /** Its versions, newest first. */
  readonly versions: readonly TowerVersion[];
  /** Open version `v` as a new file. A note says why it couldn't. */
  open(v: TowerVersion): Promise<FileNote | null>;
  /** Put back the window this one was opened from. Without it, closing
   *  this window closes it. */
  back?(): void;
}

/** When a version was written, the way Windows lists one: "Today, 3:04 PM". */
export function versionWhen(at: number, now = Date.now()): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = new Date(now);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, day)) return `Today, ${time}`;
  day.setDate(day.getDate() - 1);
  if (sameDay(d, day)) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

export function showVersionsDialog(ui: Pick<UI, "openModalTemplate" | "closeModal">, ctx: VersionsCtx): void {
  const state = { selected: ctx.versions[0]?.key ?? null, busy: false, line: null as FileNote | null };
  const box = ui.openModalTemplate(html`<h2>Previous Versions</h2><div class="pv-host"></div>`);
  box.classList.add("pv-window");
  const host = box.querySelector<HTMLElement>(".pv-host")!;
  const picked = () => ctx.versions.find((v) => v.key === state.selected) ?? null;
  // Every way out but Open goes back to the window this one came from. Not
  // while a version is opening: that closes this window on its own.
  const dismiss = (): void => {
    if (state.busy) return;
    if (ctx.back) ctx.back();
    else ui.closeModal();
  };
  const dialog = box.closest("dialog");
  if (dialog) {
    // Esc and the ✕. A browser may refuse to keep the dialog open on an Esc
    // with no click or key since the last one it kept; that Esc closes.
    dialog.oncancel = (e) => {
      if (!e.cancelable) return ui.closeModal();
      e.preventDefault();
      dismiss();
    };
    dialog.onclick = (e) => {
      if (e.target === dialog) dismiss();
    }; // a click beside the window
  }

  async function open(v: TowerVersion | null): Promise<void> {
    if (!v || state.busy) return;
    state.busy = true;
    draw();
    const note = await ctx.open(v);
    state.busy = false;
    // Opened: the window closed as the tower came in.
    if (!note) return;
    state.line = note;
    draw();
  }

  function draw(): void {
    if (!box.isConnected) return;
    render(
      versionsTemplate(ctx, state, {
        select: (key) => ((state.selected = key), draw()),
        open,
        cancel: dismiss,
        picked,
      }),
      host,
    );
  }
  draw();
  host.querySelector<HTMLElement>(".pv-row.selected")?.focus();
}

interface VersionsHandlers {
  select(key: string): void;
  open(v: TowerVersion | null): void;
  cancel(): void;
  picked(): TowerVersion | null;
}

/** How a version came to be, as the How column says it. */
function versionHow(v: TowerVersion): string {
  if (v.manual) return "Saved by you";
  if (v.original) return "Original";
  return "Autosaved";
}

function versionsTemplate(
  ctx: VersionsCtx,
  state: { selected: string | null; busy: boolean; line: FileNote | null },
  h: VersionsHandlers,
): TemplateResult {
  const rows = ctx.versions.map(
    (v) => html`<button type="button" role="option" aria-selected=${v.key === state.selected ? "true" : "false"}
      class=${classMap({ "fd-row": true, "pv-row": true, selected: v.key === state.selected })}
      @click=${() => h.select(v.key)} @dblclick=${() => h.open(v)}>
      ${fileIcon("tower")}
      <span class="fd-cell">${versionWhen(v.at)}</span>
      <span class="fd-cell pv-how">${versionHow(v)}</span>
      <span class="fd-cell fd-size-cell">${fileSizeText(v.size)}</span>
    </button>`,
  );
  return html`<div class="pv">
    <p class="pv-intro">Earlier versions of "${ctx.name}". Open one to make it a new tower file beside this one; the tower itself doesn't change.</p>
    <div class="fd-list well">
      <div class="fd-rows pv-rows" role="listbox" aria-label="Previous versions of ${ctx.name}">
        ${
          rows.length > 0
            ? rows
            : html`<div class="fd-empty">No earlier versions yet. The game keeps one every 10 minutes while you play, and the last one you saved with File > Save.</div>`
        }
      </div>
    </div>
    ${state.line ? html`<p class=${`fd-line fd-line-${state.line.kind}`} role="alert">${state.line.text}</p>` : nothing}
    <div class="pv-buttons">
      <button type="button" class="btn primary" ?disabled=${!h.picked() || state.busy} @click=${() => h.open(h.picked())}>Open</button>
      <button type="button" class="btn" @click=${h.cancel}>Cancel</button>
    </div>
  </div>`;
}
