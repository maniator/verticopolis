import type { UI } from "./UI";

/**
 * Editor and inspector panel rendering and placement for {@link UI}, as friend
 * functions taking the UI instance, plus the two pure placement helpers
 * ({@link anchorBeside}, {@link patchVolatile}) they build on. Extracted from
 * `UI.ts`; the class keeps thin delegations.
 */

/** Render the editor for a selection. If its shape (`key`) is unchanged, only
 *  the volatile `data-field` cells are patched in place — the buttons and rename
 *  input keep their identity, so a refresh can never land mid-click and swallow
 *  it. A new shape does a full (re)build. */
export function renderEditor(
  ui: UI,
  key: string,
  build: () => string,
  volatile: Record<string, string>,
): void {
  if (key !== ui.editorKey) {
    showEditor(ui, build());
    ui.editorKey = key;
  } else {
    patchVolatile(ui.el.editor, volatile);
  }
}

/** Show the editor card for a selected facility with type-specific actions. */
export function showEditor(ui: UI, html: string): void {
  ui.el.editor.innerHTML = html;
  ui.el.editor.classList.remove("hidden");
  ui.el.editor.querySelectorAll<HTMLElement>("[data-edit]").forEach((b) => {
    b.addEventListener("click", () => ui.cb.onEditAction(b.dataset.edit!, ui.el.editor));
  });
  ui.el.editor.querySelector(".ed-close")?.addEventListener("click", () => hideEditor(ui));
  ui.editorSize = { w: ui.el.editor.offsetWidth, h: ui.el.editor.offsetHeight };
}

export function hideEditor(ui: UI): void {
  ui.el.editor.classList.add("hidden");
  ui.el.editor.innerHTML = "";
  ui.editorKey = null; // force a full rebuild when it's next opened
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

export function showInspector(ui: UI, html: string | null): void {
  if (!html) {
    ui.el.inspector.classList.add("hidden");
    return;
  }
  ui.el.inspector.classList.remove("hidden");
  ui.el.inspector.innerHTML = html;
  // ✕ in the title strip (shown on mobile only, via CSS): the docked card has
  // no hover-away to dismiss it there. The card itself stays click-through.
  // Routed through the app so it can latch the dismissal — otherwise the very
  // next hover pick over the same facility re-opens the card.
  const h4 = ui.el.inspector.querySelector("h4");
  h4?.appendChild(ui.titleBarClose("insp-close btn xs", () => ui.cb.onInspectorClose()));
  ui.inspectorSize = { w: ui.el.inspector.offsetWidth, h: ui.el.inspector.offsetHeight };
}

/**
 * Update the volatile cells of a container in place: for each `data-field` key
 * in `volatile`, set that cell's innerHTML (only when it actually changed).
 * Buttons, inputs and static rows are untouched, so an in-flight click is never
 * clobbered. Pure over its `container`, so it's unit-testable without the app.
 */
export function patchVolatile(container: HTMLElement, volatile: Record<string, string>): void {
  for (const field in volatile) {
    const node = container.querySelector<HTMLElement>(`[data-field="${field}"]`);
    if (node && node.innerHTML !== volatile[field]) node.innerHTML = volatile[field];
  }
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
