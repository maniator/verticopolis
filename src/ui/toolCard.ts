import { render } from "lit-html";
import { bulldozeToolInfo, INSPECT_TOOL_INFO, toolInfoFor } from "./templates/toolInfo";
import { bulldozePickerFor, syncBulldozeDragStrip } from "./bulldozeDragStrip";
import { lobbyPickerFor, syncLobbyHeightStrip } from "./lobbyHeightStrip";
import type { Tool, UI } from "./UI";

/** Draw `tool`'s card into the tool-info panel and show the phone strip that
 *  belongs to it: the Lobby tool's height, or what a bulldoze drag clears. */
export function renderToolCard(ui: Pick<UI, "cb" | "tool" | "el">, tool: Tool): void {
  if (tool.type === "build") render(toolInfoFor(ui.cb.getCatalog(), tool.kind, lobbyPickerFor(ui)), ui.el.toolInfo);
  else render(tool.type === "bulldoze" ? bulldozeToolInfo(bulldozePickerFor(ui)) : INSPECT_TOOL_INFO, ui.el.toolInfo);
  syncLobbyHeightStrip(tool, ui.cb.getCatalog(), lobbyPickerFor(ui));
  syncBulldozeDragStrip(tool, bulldozePickerFor(ui));
}
