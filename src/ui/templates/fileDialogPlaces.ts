import { html, nothing, type TemplateResult } from "lit-html";
import { classMap } from "lit-html/directives/class-map.js";
import { folderIcon, linkFolderIcon, linkedFolderIcon } from "../fileIcons";

/**
 * The Look in and Save in box of the Open and Save As windows, and the note a
 * linked folder shows when the browser wants the player's OK again (owner,
 * 2026-11-15, design in `docs/architecture/linked-folder.md`). The box names
 * where the list comes from: My Towers, in this browser, or the folder linked
 * on the player's computer. Its menu switches between the two and links or
 * unlinks the folder; a browser that cannot link one says so in gray.
 */

/** Where a window's list comes from. */
export type FilePlace = "local" | "linked";

/** The linked folder as a window shows it. */
export interface LinkedView {
  readonly name: string;
  /** False until the browser has the player's OK for this visit. */
  readonly allowed: boolean;
  /** The Auto-save is copied there too (`game/autosaveMirror.ts`). */
  readonly mirror: boolean;
}

export interface PlacesView {
  readonly mode: "open" | "saveAs";
  readonly place: FilePlace;
  readonly linked: LinkedView | null;
  /** This browser can link a folder. */
  readonly canLink: boolean;
  /** "computer" on a desktop, "device" on a phone or tablet. */
  readonly where: "computer" | "device";
  readonly lookOpen: boolean;
  readonly usage: string;
  readonly busy: boolean;
}

export interface PlacesHandlers {
  toggleLook(e: Event): void;
  lookKey(e: KeyboardEvent): void;
  choose(place: FilePlace): void;
  link(): void;
  unlink(): void;
  /** Turn the Auto-save copy in the linked folder on or off. */
  toggleMirror(): void;
}

function placeLabel(v: PlacesView, place: FilePlace): TemplateResult {
  return place === "linked" && v.linked
    ? html`${linkedFolderIcon()}<span class="fd-look-name">${v.linked.name}</span><span class="fd-look-sub">on this ${v.where}</span>`
    : html`${folderIcon()}<span class="fd-look-name">My Towers</span><span class="fd-look-sub">in this browser</span>`;
}

export function placesTemplate(v: PlacesView, h: PlacesHandlers): TemplateResult {
  const opening = v.mode === "open";
  const item = (label: TemplateResult, run: () => void, cls: Record<string, boolean> = {}, enabled = true) =>
    html`<button type="button" role="menuitem" class=${classMap({ "fd-look-item": true, ...cls })} aria-disabled=${enabled ? "false" : "true"}
      ?disabled=${v.busy && enabled} @click=${(e: Event) => {
        e.stopPropagation();
        if (enabled) run();
      }}>${label}</button>`;
  return html`<div class="fd-where">
    <span class="fd-where-label" id="fd-look-label">${opening ? "Look in:" : "Save in:"}</span>
    <button type="button" class="fd-look field" aria-haspopup="menu" aria-expanded=${v.lookOpen ? "true" : "false"}
      aria-labelledby="fd-look-label fd-look-now" @click=${h.toggleLook} @keydown=${h.lookKey}>
      <span class="fd-look-now" id="fd-look-now">${placeLabel(v, v.place)}</span><span class="fd-look-arrow" aria-hidden="true">▼</span>
    </button>
    <span class="fd-usage">${v.usage}</span>
    ${v.lookOpen
      ? html`<div class="fd-look-pop well" role="menu" aria-label=${opening ? "Look in" : "Save in"} @keydown=${h.lookKey}>
          ${item(placeLabel(v, "local"), () => h.choose("local"), { selected: v.place === "local" })}
          ${v.linked ? item(placeLabel(v, "linked"), () => h.choose("linked"), { selected: v.place === "linked" }) : nothing}
          <div class="fd-look-sep" role="separator"></div>
          ${v.canLink
            ? html`${item(html`${linkFolderIcon()}<span>${v.linked ? "Link a different folder…" : `Link a folder on this ${v.where}…`}</span>`, h.link)}
              ${v.linked ? mirrorItem(v.linked.mirror, v.busy, h.toggleMirror) : nothing}
              ${v.linked ? item(html`<span class="fd-icon-pad"></span><span>Unlink "${v.linked.name}"</span><span class="fd-look-sub">its files stay</span>`, h.unlink) : nothing}`
            : item(html`<span class="fd-icon-pad"></span><span>This browser can't link a folder</span>`, () => {}, { quiet: true }, false)}
        </div>`
      : nothing}
  </div>`;
}

/** The check item that keeps a copy of the Auto-save in the linked folder. */
function mirrorItem(on: boolean, busy: boolean, toggle: () => void): TemplateResult {
  return html`<button type="button" role="menuitemcheckbox" class="fd-look-item fd-mirror" aria-checked=${on ? "true" : "false"} ?disabled=${busy}
    @click=${(e: Event) => {
      e.stopPropagation();
      toggle();
    }}><span class="fd-icon-pad fd-check" aria-hidden="true">${on ? "✓" : ""}</span><span>Keep the Auto-save here too</span></button>`;
}

/** The list's note while the browser wants the player's OK for the linked
 *  folder again: it only asks after a click, so it is a button. */
export function allowNote(v: PlacesView, allow: () => void): TemplateResult {
  return html`<div class="fd-allow">
    ${linkedFolderIcon()}
    <p>Your browser needs your OK to open <b>${v.linked?.name ?? "the folder"}</b> again.</p>
    <button type="button" class="btn primary" ?disabled=${v.busy} @click=${allow}>Allow access…</button>
  </div>`;
}
