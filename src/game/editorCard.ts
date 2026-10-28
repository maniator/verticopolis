import type { UI } from "../ui/UI";
import { unitEditorTemplate, transportEditorTemplate } from "../ui/templates/editor";
import { clockOf } from "../simport/headerClock";
import type { ViewReader } from "../simport/viewReader";
import type { CardKit } from "./cardKit";

/** What {@link refreshEditorCard} reads off the app. */
export interface EditorCardApp {
  readonly selected: { type: "unit" | "transport"; id: number } | null;
  readonly engine: { selectedId: number | null };
  readonly ui: Pick<UI, "renderEditor">;
  readonly mobileMq: { readonly matches: boolean };
  readonly cardKit: CardKit;
  readonly reader: Pick<ViewReader, "header">;
  clearSelection(): void;
}

/**
 * Render the selected facility's editor card from the port's card for it. The
 * template is a pure function of (card, catalog, hour, mobile); lit's binding
 * diff patches only the values that changed since the last pump, so the
 * buttons and rename input keep their identity across stat ticks, and a shape
 * change (a condo sells and loses its price adjuster, a cinema finishes
 * construction and gains its "Now showing" row, the viewport crosses the
 * mobile breakpoint) restructures just the affected rows. Mobile folds the
 * inspector card's diagnostics into the editor (one panel, no hover). A card
 * the port no longer has means the facility is gone, so the selection clears.
 */
export function refreshEditorCard(app: EditorCardApp): void {
  const sel = app.selected;
  if (!sel) return;
  const mobile = app.mobileMq.matches;
  const kit = app.cardKit;
  if (sel.type === "unit") {
    const u = kit.cards.unit(sel.id);
    if (!u) return app.clearSelection();
    app.engine.selectedId = u.id;
    const diag = mobile ? kit.diagnostics.unit(u.id) : [];
    app.ui.renderEditor(unitEditorTemplate(u, kit.catalog(), clockOf(app.reader.header).hour, mobile, diag));
  } else {
    const t = kit.cards.shaft(sel.id);
    if (!t) return app.clearSelection();
    app.engine.selectedId = t.id; // outlines the shaft + shows extend arrows
    app.ui.renderEditor(transportEditorTemplate(t, kit.catalog(), mobile ? kit.diagnostics.transport(t.id) : []));
  }
}
