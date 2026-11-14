import { html, nothing, render } from "lit-html";
import { bulldozeDragButtons, bulldozeToolInfo, type BulldozeDragPicker } from "./templates/toolInfo";
import type { UI } from "./UI";

/**
 * The Bulldoze card's "Drag clears" choice and the phone's strip for it. A
 * bulldoze drag removes only the kind it starts on by default (#644); the
 * player can pick Everything so one drag clears all it crosses. On a phone
 * the tool card sits in the ☰ drawer, so while the bulldozer is armed a small
 * strip over the tower offers the same choice. The stylesheet shows it on
 * the phone layout only, like the lobby height strip.
 */

/** The card's and the strip's picker for `ui`: a pick redraws both. */
export function bulldozePickerFor(ui: Pick<UI, "cb" | "tool" | "el">): BulldozeDragPicker {
  const choice = ui.cb.bulldozeDrag();
  return {
    clears: choice.clears,
    pick: (clears) => {
      choice.pick(clears);
      if (ui.tool.type !== "bulldoze") return;
      render(bulldozeToolInfo(bulldozePickerFor(ui)), ui.el.toolInfo);
      syncBulldozeDragStrip(ui.tool, bulldozePickerFor(ui));
    },
  };
}

/** Show the strip while the bulldozer is armed, with `drag`'s choice. */
export function syncBulldozeDragStrip(tool: { type: string }, drag: BulldozeDragPicker): void {
  const strip = document.getElementById("bulldoze-drag-strip");
  if (!strip) return;
  const armed = tool.type === "bulldoze";
  strip.hidden = !armed;
  render(armed ? html`<span>Drag clears</span>${bulldozeDragButtons(drag)}` : nothing, strip);
}
