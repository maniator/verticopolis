import { render, type TemplateResult } from "lit-html";
import { bulldozeToolInfo, INSPECT_TOOL_INFO, toolInfoFor } from "./templates/toolInfo";
import { bulldozePickerFor, syncBulldozeDragStrip } from "./bulldozeDragStrip";
import { lobbyPickerFor, syncLobbyHeightStrip } from "./lobbyHeightStrip";
import type { Tool, UI } from "./UI";
import { skyBridgeToolInfo } from "./skyBridgePalette";
import { syncSkyBridgeLookStrip } from "./skyBridgeLookStrip";

/** Draw `tool`'s card into the tool-info panel and show the strip that
 *  belongs to it: the Lobby tool's height, or what a bulldoze drag clears.
 *  The Sky Bridge tool shows its look strip. The status bar's cell carries the whole card (its description and notes,
 *  which the bar leaves out) as its tooltip. A phone has no status bar and
 *  shows no card over the tower (owner, 2026-11-15): the tool's button
 *  already names it and its price. */
export function renderToolCard(ui: Pick<UI, "cb" | "tool" | "el">, tool: Tool): void {
  let card: TemplateResult;
  if (tool.type === "build") card = toolInfoFor(ui.cb.getCatalog(), tool.kind, lobbyPickerFor(ui));
  else if (tool.type === "skyBridge") card = skyBridgeToolInfo(ui.cb.getCatalog().rules.skyBridge);
  else card = tool.type === "bulldoze" ? bulldozeToolInfo(bulldozePickerFor(ui)) : INSPECT_TOOL_INFO;
  render(card, ui.el.toolInfo);
  ui.el.toolInfo.title = cardNotes(ui.el.toolInfo);
  syncLobbyHeightStrip(tool, ui.cb.getCatalog(), lobbyPickerFor(ui));
  syncBulldozeDragStrip(tool, bulldozePickerFor(ui));
  syncSkyBridgeLookStrip(tool, ui.cb.getCatalog().rules.skyBridge);
}

/** The card's description and notes, the text the one-line bar leaves out. */
export function cardNotes(card: HTMLElement): string {
  return [...card.querySelectorAll("p")]
    .map((p) => p.textContent?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}
