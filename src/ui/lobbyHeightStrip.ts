import { html, nothing, render } from "lit-html";
import type { Catalog } from "../catalog/catalogTypes";
import { lobbyHeightButtons, toolInfoFor, type LobbyHeightPicker } from "./templates/toolInfo";
import type { UI } from "./UI";

/**
 * The phone's lobby height strip (#308). On a phone the tool card sits in
 * the ☰ drawer, out of sight while the player builds, so while the Lobby
 * tool is armed a small strip over the tower offers the same 1 / 2 / 3 story
 * choice. The stylesheet shows it on the phone layout only; on a wider
 * screen the Lobby card's picker is in view and the strip stays hidden.
 */

/** The Lobby card's and the strip's height picker for `ui`: a pick redraws
 *  the card and the strip. */
export function lobbyPickerFor(ui: Pick<UI, "cb" | "tool" | "el">): LobbyHeightPicker {
  const choice = ui.cb.lobbyHeight();
  const redraw = (): void => {
    if (ui.tool.type !== "build") return;
    const catalog = ui.cb.getCatalog();
    render(toolInfoFor(catalog, ui.tool.kind, lobbyPickerFor(ui)), ui.el.toolInfo);
    syncLobbyHeightStrip(ui.tool, catalog, lobbyPickerFor(ui));
  };
  return {
    picked: choice.picked,
    pick: (h) => {
      choice.pick(h);
      redraw();
    },
  };
}

/** Show the strip while the Lobby tool is armed, with `lobby`'s choice. */
export function syncLobbyHeightStrip(tool: { type: string; kind?: string }, catalog: Catalog, lobby: LobbyHeightPicker): void {
  const strip = document.getElementById("lobby-height-strip");
  if (!strip) return;
  const armed = tool.type === "build" && tool.kind === "lobby";
  strip.hidden = !armed;
  render(armed ? html`<span>Lobby height</span>${lobbyHeightButtons(catalog, lobby)}` : nothing, strip);
}
