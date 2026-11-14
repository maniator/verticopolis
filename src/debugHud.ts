/**
 * The frame statistics overlay behind `?debug=fps` (#645). The boot loads this
 * module lazily only when the flag is on, so it never enters the main bundle,
 * and `vite.config.ts` keeps its chunk out of the offline precache.
 *
 * It is a fixed DOM box, not a drawing on the game canvas, so it adds no draw
 * calls to the numbers it shows. It never hooks the frame loop: a timer reads
 * Excalibur's `stats.prevFrame` (the copy of the last finished frame) a few
 * times a second. The renderer is looked up on every read, so a rebuilt engine
 * (after a lost WebGL context) or a tower opened after the title screen is
 * picked up without remounting.
 *
 * The box sits in the bottom-left corner of the game view (the `#view`
 * canvas), placed again on every refresh, so on a phone, in either
 * orientation, it covers the tower and leaves the toolbars and build palette
 * clear.
 */

/** The fields of an Excalibur frame statistics record the overlay reads. */
export interface FrameStatsLike {
  fps: number;
  elapsed: number;
  duration: { update: number; draw: number };
  graphics: { drawCalls: number; drawnImages: number };
}

/** Whatever holds the running Excalibur engine, if a tower is open. */
export type StatsSource = () => { stats: { prevFrame: FrameStatsLike } } | undefined;

/** How often the overlay refreshes, in milliseconds. */
export const DEBUG_HUD_REFRESH_MS = 250;

/** The overlay element's id. */
export const DEBUG_HUD_ID = "debug-hud";

/** The game view the overlay sits on (the canvas in src/index.html). */
export const DEBUG_HUD_VIEW_ID = "view";

/** The gap between the overlay and the view's corner, in CSS pixels. */
const CORNER_GAP_PX = 4;

/** Stops the overlay that is up, so a second mount replaces the first. */
let stopActive: (() => void) | undefined;

/** The overlay's text for one frame record, or for no renderer yet. */
export function debugHudText(frame: FrameStatsLike | undefined): string {
  if (!frame) return "fps: no tower open";
  const ms = (n: number): string => n.toFixed(1);
  return [
    `fps ${Math.round(frame.fps)}  frame ${ms(frame.elapsed)} ms`,
    `update ${ms(frame.duration.update)} ms  draw ${ms(frame.duration.draw)} ms`,
    `draw calls ${frame.graphics.drawCalls}  images ${frame.graphics.drawnImages}`,
  ].join("\n");
}

/** Put the overlay on the page and start refreshing it. Returns a function that
 *  stops the timer and removes the overlay. */
export function mountDebugHud(source: StatsSource, doc: Document = document): () => void {
  stopActive?.();
  const box = doc.createElement("pre");
  box.id = DEBUG_HUD_ID;
  box.setAttribute("aria-hidden", "true");
  Object.assign(box.style, {
    position: "fixed",
    left: "4px",
    bottom: "4px",
    zIndex: "10000",
    margin: "0",
    padding: "4px 6px",
    font: "11px/1.3 monospace",
    color: "#fff",
    background: "rgba(0, 0, 0, 0.7)",
    pointerEvents: "none",
    whiteSpace: "pre",
    width: "max-content",
    maxWidth: "none",
  });
  const refresh = (): void => {
    box.textContent = debugHudText(source()?.stats.prevFrame);
    placeOnView(box, doc);
  };
  refresh();
  doc.body.append(box);
  const timer = setInterval(refresh, DEBUG_HUD_REFRESH_MS);
  const stop = (): void => {
    clearInterval(timer);
    box.remove();
    if (stopActive === stop) stopActive = undefined;
  };
  stopActive = stop;
  return stop;
}

/** Move the box to the view's bottom-left corner; with no laid-out view it
 *  stays in the page's bottom-left corner. */
function placeOnView(box: HTMLElement, doc: Document): void {
  const view = doc.getElementById(DEBUG_HUD_VIEW_ID)?.getBoundingClientRect();
  const pageHeight = doc.documentElement.clientHeight;
  if (!view || view.width === 0 || view.height === 0) {
    box.style.left = `${CORNER_GAP_PX}px`;
    box.style.bottom = `${CORNER_GAP_PX}px`;
    return;
  }
  box.style.left = `${Math.round(view.left) + CORNER_GAP_PX}px`;
  box.style.bottom = `${Math.max(0, Math.round(pageHeight - view.bottom)) + CORNER_GAP_PX}px`;
}
