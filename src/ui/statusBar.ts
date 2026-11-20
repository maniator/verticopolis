import type { GameMode } from "@verticopolis/engine/model/types";
import { appendMessage } from "./iconNodes";
import { RULE_SET_NAME } from "./ruleSetName";

/**
 * The Win95 status bar's two text boxes (index.html `#statusbar`): the tower
 * and its rules, and the newest bulletin line. The picked tool's box is
 * `#tool-info`, which the tool card already draws.
 *
 * The newest line is also spoken through `#sb-news-live` while the Bulletin
 * window is closed (its own log is the live region when it is open).
 *
 * The status pump calls {@link showTowerInStatusBar} on every pass, so it
 * writes only when the name or the rules change. The bulletin calls
 * {@link showNewsInStatusBar} once per batch of new lines.
 */

/** The cell last written and what it shows, so an unchanged pass is two
 *  compares with no lookup and no string built (the pump's per-pass budget). */
let shown: { cell: HTMLElement; name: string; mode: GameMode } | undefined;

/** Show the tower's name and rules, writing only on a change. */
export function showTowerInStatusBar(name: string, mode: GameMode, doc: Document = document): void {
  if (shown && shown.name === name && shown.mode === mode && shown.cell.ownerDocument === doc && shown.cell.isConnected)
    return;
  const cell = doc.getElementById("sb-tower");
  if (!cell) return;
  const text = `${name} · ${RULE_SET_NAME[mode]}`;
  if (cell.textContent !== text) cell.textContent = text;
  shown = { cell, name, mode };
}

/** Show the newest bulletin line (empty clears the box). With `speak`, a
 *  screen reader hears it too while the Bulletin window is closed: the
 *  window's own log speaks when it is open, and a line already shown as a
 *  toast was spoken by the toast rail, so its caller passes false. */
export function showNewsInStatusBar(text: string, doc: Document = document, speak = true): void {
  const live = doc.getElementById("sb-news-live");
  if (live && speak && text && doc.getElementById("bulletin-win")?.hidden !== false) live.textContent = text;
  const cell = doc.getElementById("sb-news");
  if (!cell) return;
  // The bulletin's own icon swap: a known leading emoji becomes a pixel icon,
  // and the rest stays text nodes.
  cell.replaceChildren();
  appendMessage(cell, text);
  cell.title = text;
}
