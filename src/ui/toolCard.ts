import { render, type TemplateResult } from "lit-html";
import { bulldozeToolInfo, INSPECT_TOOL_INFO, toolInfoFor } from "./templates/toolInfo";
import { bulldozePickerFor, syncBulldozeDragStrip } from "./bulldozeDragStrip";
import { lobbyPickerFor, syncLobbyHeightStrip } from "./lobbyHeightStrip";
import { hideToolTip, showToolTip } from "./toolTipStrip";
import type { Tool, UI } from "./UI";

/** Draw `tool`'s card into the tool-info panel, show it on the phone's tool
 *  card, and show the strip that belongs to it: the Lobby tool's height, or
 *  what a bulldoze drag clears. The status bar's cell carries the whole card
 *  (its description and notes, which the bar leaves out) as its tooltip. */
export function renderToolCard(ui: Pick<UI, "cb" | "tool" | "el">, tool: Tool): void {
  let card: TemplateResult;
  if (tool.type === "build") card = toolInfoFor(ui.cb.getCatalog(), tool.kind, lobbyPickerFor(ui));
  else card = tool.type === "bulldoze" ? bulldozeToolInfo(bulldozePickerFor(ui)) : INSPECT_TOOL_INFO;
  render(card, ui.el.toolInfo);
  ui.el.toolInfo.title = cardNotes(ui.el.toolInfo);
  // Inspect is the resting tool (the game starts on it): no card to teach.
  if (tool.type === "inspect") hideToolTip();
  else showToolTip(card);
  syncLobbyHeightStrip(tool, ui.cb.getCatalog(), lobbyPickerFor(ui));
  syncBulldozeDragStrip(tool, bulldozePickerFor(ui));
}

/** The card's description and notes, the text the one-line bar leaves out. */
export function cardNotes(card: HTMLElement): string {
  return [...card.querySelectorAll("p")].map((p) => p.textContent?.trim() ?? "").filter(Boolean).join(" ");
}
