import { render, nothing, type TemplateResult } from "lit-html";
import type { UI } from "./UI";
import { syncRungSelects } from "./templates/rungPicker";

/**
 * Editor and inspector panel rendering and placement for {@link UI}, as friend
 * functions taking the UI instance, plus the pure placement helper
 * ({@link anchorBeside}) they build on. Extracted from `UI.ts`; the class
 * keeps thin delegations.
 */

/** Render the editor card for the current selection through lit (E6-S1). lit's
 *  binding diff patches only the values that changed since the last pump, so
 *  the buttons and rename input keep their element identity across refreshes,
 *  a refresh can never land mid-click and swallow it (the old
 *  `key`/`patchVolatile` protocol existed to guarantee exactly this).
 *  `#editor` is lit's container exclusively (one container, one renderer);
 *  never write its innerHTML around lit's back. */
export function renderEditor(ui: UI, tpl: TemplateResult): void {
  render(tpl, ui.el.editor);
  // Selection on a native select must be written after the options attach
  // (see rungPicker.ts); a no-op when the card has no picker or it already
  // agrees with the engine.
  syncRungSelects(ui.el.editor);
  ui.el.editor.classList.remove("hidden");
  // Re-measure after every render so per-frame anchoring keeps reading the
  // cache, never layout. This runs at the ~6 Hz editor pump, not per frame,
  // and the pump's own status-bar writes already leave layout dirty for the
  // coming frame, so the forced read here does work that frame was about to
  // do anyway. (The old builder measured only on a shape-key change and could
  // serve a stale size after a value-width change; this is simpler and fresher.)
  ui.editorSize = { w: ui.el.editor.offsetWidth, h: ui.el.editor.offsetHeight };
}

/** Wire the editor card's single delegated click listener (called once, from
 *  the UI constructor). Delegation on the container survives every lit
 *  re-render, so actions never need rewiring: any `[data-edit]` element
 *  dispatches its action, and the title bar's ✕ closes the card. */
export function wireEditorActions(ui: UI): void {
  ui.el.editor.addEventListener("click", (e) => {
    const target = e.target as Element;
    // Both closest() walks are containment-guarded: closest can escape above
    // the card, and a match outside it must not act.
    const x = target.closest(".ed-close");
    if (x && ui.el.editor.contains(x)) return hideEditor(ui);
    const b = target.closest<HTMLElement>("[data-edit]");
    if (b && ui.el.editor.contains(b)) ui.cb.onEditAction(b.dataset.edit!, ui.el.editor);
  });
  // Selects (the Classic rung picker) commit on `change`, not click; the same
  // delegated pattern so lit re-renders never need rewiring. The handler reads
  // the select's live value out of the card, exactly like the rename input.
  ui.el.editor.addEventListener("change", (e) => {
    const s = (e.target as Element).closest<HTMLSelectElement>("select[data-edit-select]");
    if (s && ui.el.editor.contains(s)) ui.cb.onEditAction(s.dataset.editSelect!, ui.el.editor);
  });
}

export function hideEditor(ui: UI): void {
  ui.el.editor.classList.add("hidden");
  // Clear THROUGH lit, never innerHTML: lit tracks its rendered parts against
  // the container, and an external wipe would strand that bookkeeping and
  // break the next render.
  render(nothing, ui.el.editor);
}

export function isEditorOpen(ui: UI): boolean {
  return !ui.el.editor.classList.contains("hidden");
}

export function isInspectorOpen(ui: UI): boolean {
  return !ui.el.inspector.classList.contains("hidden");
}

/** Anchor the editor card beside a facility's on-screen rect, preferring its
 *  right side, flipping left and clamping so it always stays on screen. */
export function anchorEditor(
  ui: UI,
  rect: { x: number; y: number; w: number },
  viewW: number,
  viewH: number,
): void {
  const { left, top } = anchorBeside(rect, ui.editorSize, viewW, viewH);
  placePanel(ui.el.editor, left, top);
}

/** Anchor the inspector tooltip just off a facility's corner, clamped. */
export function anchorInspector(ui: UI, x: number, y: number, viewW: number, viewH: number): void {
  const { w, h } = ui.inspectorSize;
  const gap = 8;
  const left = Math.max(gap, Math.min(x + 12, viewW - w - gap));
  const top = Math.max(gap, Math.min(y, viewH - h - gap));
  placePanel(ui.el.inspector, left, top);
}

/** Drop the inline anchor so the panels fall back to their CSS-docked layout
 *  (used on mobile, where floating would fight the bottom palette strip). */
export function clearPanelAnchors(ui: UI): void {
  for (const el of [ui.el.editor, ui.el.inspector]) {
    el.style.left = el.style.top = el.style.right = el.style.bottom = "";
  }
}

function placePanel(el: HTMLElement, left: number, top: number): void {
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.style.right = "auto";
  el.style.bottom = "auto";
}

/** Mark the inspector card as a touch "peek" (long-press) so its manual ✕ close
 *  is hidden: a peek dismisses when the finger lifts, exactly like a desktop
 *  hover card dismisses on mouse-away, so the coarse-pointer close button (there
 *  for the docked, no-hover-away cards) would only confuse. */
export function setInspectorPeek(ui: UI, on: boolean): void {
  ui.el.inspector.classList.toggle("peek", on);
}

export function showInspector(ui: UI, tpl: TemplateResult | null): void {
  if (!tpl) {
    // Hide only; the stale card stays in the container (as it always did) and
    // the next show renders over it through lit. Drop any peek marker so a later
    // non-peek card gets its ✕ back.
    ui.el.inspector.classList.add("hidden");
    ui.el.inspector.classList.remove("peek");
    return;
  }
  ui.el.inspector.classList.remove("hidden");
  // lit render, not innerHTML (E6-S2): #inspector is lit's container
  // exclusively; hover picks re-render every move and lit patches the changed
  // text in place.
  render(tpl, ui.el.inspector);
  // ✕ in the title strip (shown on mobile only, via CSS): the docked card has
  // no hover-away to dismiss it there. The card itself stays click-through.
  // Routed through the app so it can latch the dismissal, otherwise the very
  // next hover pick over the same facility re-opens the card. Appended from
  // the one shared recipe AFTER the h4's lit-managed content (the finishModal
  // pattern): a foreign node at the tail survives same-shape re-renders, and
  // a card-shape swap replaces the h4, so re-append whenever it's missing.
  const h4 = ui.el.inspector.querySelector("h4");
  if (h4 && !h4.querySelector(".insp-close")) {
    h4.appendChild(ui.titleBarClose("insp-close btn xs", () => ui.cb.onInspectorClose()));
  }
  ui.inspectorSize = { w: ui.el.inspector.offsetWidth, h: ui.el.inspector.offsetHeight };
}

/**
 * Place a panel of `size` beside a facility's screen `rect`: prefer the rect's
 * right side, flip to the left when there isn't room, and clamp so the panel
 * always stays fully inside the viewport (with an 8px margin). Pure so the
 * placement logic is unit-testable without a DOM.
 */
export function anchorBeside(
  rect: { x: number; y: number; w: number },
  size: { w: number; h: number },
  viewW: number,
  viewH: number,
  gap = 8,
): { left: number; top: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
  let left = rect.x + rect.w + gap; // prefer the facility's right
  if (left + size.w > viewW - gap) left = rect.x - size.w - gap; // no room → flip left
  return {
    left: clamp(left, gap, Math.max(gap, viewW - size.w - gap)),
    top: clamp(rect.y, gap, Math.max(gap, viewH - size.h - gap)),
  };
}
