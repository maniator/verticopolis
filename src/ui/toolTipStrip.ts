import { html, render, type TemplateResult } from "lit-html";
import { trackAppAction } from "../analytics";

/**
 * The phone's tool card (party, 2026-11-14). A phone has no status bar, so a
 * picked tool's name, price and description would be nowhere. Each pick shows
 * the card in `#tool-tip`, over the tower at the bottom left above the lobby
 * height and bulldoze drag strips (`#tool-strip`): the name and numbers on one
 * row, the description and notes under it, cut to a few lines by the
 * stylesheet. The first placement folds it away (the player has learned the
 * tool by using it), and so do its close button and the next pick, which
 * shows the new tool's card instead.
 *
 * A placement is read as the undo depth moving (`uiStatus.setHistoryButtons`
 * passes it each pump). At the engine's undo cap a placement leaves the depth
 * where it was, so there the card waits for its close button or the next pick.
 *
 * The stylesheet shows it on the phone layouts only; a desktop reads the same
 * card in the status bar. Cost: one render per pick, one number compare per
 * pump while the card is up.
 */

/** The undo depth the card was first seen at, once a pump has read it. */
let seenAtDepth: number | undefined;
/** The card while it is up, so a pump with no card up does no lookup. */
let upTip: HTMLElement | null = null;

/** Show `card` as the picked tool's card, folding away any card before it. */
export function showToolTip(card: TemplateResult, doc: Document = document): void {
  const tip = doc.getElementById("tool-tip");
  if (!tip) return;
  render(
    html`<button type="button" class="tt-close" aria-label="Close the tool card" @click=${() => closeToolTip(doc)}>✕</button><div class="tt-body">${card}</div>`,
    tip,
  );
  tip.hidden = false;
  upTip = tip;
  seenAtDepth = undefined;
}

/** The card's ✕: fold it away and count the close (`tool_card_close`). */
function closeToolTip(doc: Document): void {
  trackAppAction("tool_card_close");
  hideToolTip(doc);
}

/** Fold the card away. */
export function hideToolTip(doc: Document = document): void {
  const tip = doc.getElementById("tool-tip");
  if (tip) tip.hidden = true;
  upTip = null;
}

/** Fold the card away once the undo depth moves from where the first pump
 *  after the pick saw it: the player placed something (or undid a step). */
export function noteUndoDepth(depth: number, doc: Document = document): void {
  if (!upTip || upTip.hidden || upTip.ownerDocument !== doc) return;
  if (seenAtDepth === undefined) seenAtDepth = depth;
  else if (depth !== seenAtDepth) hideToolTip(doc);
}
