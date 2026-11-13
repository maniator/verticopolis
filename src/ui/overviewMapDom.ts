import { iconElement } from "./icons";

/**
 * The overview MAP window's elements (#343): the window with its title bar,
 * the two stacked canvases and the text summary, plus the Map button that
 * opens it, plus `ContextWatch`, which tracks whether the canvases' 2D
 * contexts are lost. `OverviewMapWindow` wires them.
 */

/** The ids of the window's parts, which the CSS and the tests name. */
export const MAP_DOM_ID = {
  window: "overview-map",
  title: "overview-map-title",
  toggle: "btn-map",
  summary: "overview-map-summary",
} as const;

export interface MapDom {
  readonly root: HTMLElement;
  /** The title bar; the View dropdown goes right after it. */
  readonly title: HTMLElement;
  readonly close: HTMLButtonElement;
  readonly body: HTMLElement;
  readonly towerCanvas: HTMLCanvasElement;
  readonly viewCanvas: HTMLCanvasElement;
  readonly summary: HTMLElement;
  readonly toggle: HTMLButtonElement;
}

/** Build the window (hidden) and its button. The caller puts them in the page. */
export function buildMapDom(doc: Document): MapDom {
  const root = doc.createElement("div");
  root.id = MAP_DOM_ID.window;
  root.className = "win overview-map";
  root.hidden = true;
  root.setAttribute("role", "region");
  root.setAttribute("aria-labelledby", MAP_DOM_ID.title);
  const title = doc.createElement("div");
  title.className = "win-title";
  const name = doc.createElement("span");
  name.id = MAP_DOM_ID.title;
  name.textContent = "Map";
  const close = doc.createElement("button");
  close.type = "button";
  close.className = "btn xs overview-map-close";
  close.setAttribute("aria-label", "Close the map");
  close.textContent = "✕";
  title.append(name, close);
  const body = doc.createElement("div");
  body.className = "overview-map-body";
  const towerCanvas = doc.createElement("canvas");
  towerCanvas.className = "overview-map-tower";
  towerCanvas.setAttribute("aria-hidden", "true");
  const viewCanvas = doc.createElement("canvas");
  viewCanvas.className = "overview-map-view";
  viewCanvas.tabIndex = 0;
  viewCanvas.setAttribute("role", "application");
  viewCanvas.setAttribute("aria-label", "Tower map. Arrow keys move the view, Home and End go to the top and bottom.");
  viewCanvas.setAttribute("aria-describedby", MAP_DOM_ID.summary);
  const summary = doc.createElement("p");
  summary.id = MAP_DOM_ID.summary;
  summary.className = "visually-hidden";
  // Heard only while the map has focus (the window turns it on and off), and
  // written only when the words change: moving the view with the map's keys
  // is announced, and panning the world with the map open stays quiet.
  summary.setAttribute("aria-live", "off");
  body.append(towerCanvas, viewCanvas);
  root.append(title, body, summary);
  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.id = MAP_DOM_ID.toggle;
  toggle.className = "btn overview-map-toggle";
  // The glyph shows on desktop only (the phone pill keeps its word alone).
  toggle.append(iconElement("map"), "Map");
  toggle.title = "Show the tower map";
  toggle.setAttribute("aria-controls", MAP_DOM_ID.window);
  return { root, title, close, body, towerCanvas, viewCanvas, summary, toggle };
}

/** What a frame finds of the canvases' 2D contexts (see `ContextWatch.poll`). */
export type MapContextState = "ready" | "lost" | "restored";

/**
 * Whether either canvas has lost its 2D context. The `contextlost` and
 * `contextrestored` events count where the browser fires them, and each frame
 * also asks each context `isContextLost()` (at most two calls), since a
 * browser may blank a canvas without the events. A lost context blanks its
 * canvas, and a restored one starts blank at its default state.
 */
export class ContextWatch {
  /** Canvases a `contextlost` event reported and no `contextrestored` has. */
  private readonly lostByEvent = new Set<HTMLCanvasElement>();
  /** The last poll found a context lost. */
  private lost = false;
  /** A restore came since the last poll: a `contextrestored` fired, or every
   *  context answered `isContextLost()` with false while a loss event was
   *  still open (a loss and its restore can both fall between two frames). */
  private restoredByEvent = false;

  /** `changed` hears each event at once, before the next frame polls. */
  constructor(
    private readonly canvases: ReadonlyArray<HTMLCanvasElement>,
    private readonly contexts: ReadonlyArray<CanvasRenderingContext2D | null>,
    changed: () => void,
  ) {
    for (const canvas of canvases) {
      canvas.addEventListener("contextlost", () => {
        this.lostByEvent.add(canvas);
        changed();
      });
      canvas.addEventListener("contextrestored", () => {
        this.lostByEvent.delete(canvas);
        this.restoredByEvent = true;
        changed();
      });
    }
  }

  /** Read once per open frame: "lost" while any context is lost, "restored"
   *  on the first frame they are all back, and "ready" otherwise. */
  poll(): MapContextState {
    // Where every context answers `isContextLost()`, its answer wins, so a
    // context given back without a `contextrestored` event still counts as
    // back. An engine without the method (older browsers) has the events.
    let answers = true;
    let lostNow = false;
    for (const ctx of this.contexts) {
      if (ctx === null) continue;
      if (typeof ctx.isContextLost !== "function") answers = false;
      else if (ctx.isContextLost()) lostNow = true;
    }
    if (answers && !lostNow && this.lostByEvent.size > 0) {
      this.lostByEvent.clear();
      this.restoredByEvent = true;
    }
    const lost = lostNow || this.lostByEvent.size > 0;
    const restored = !lost && (this.lost || this.restoredByEvent);
    this.lost = lost;
    if (!lost) this.restoredByEvent = false;
    if (lost) return "lost";
    return restored ? "restored" : "ready";
  }

  /** Clear every canvas whose context is there. */
  clear(): void {
    this.canvases.forEach((c, i) => this.contexts[i]?.clearRect(0, 0, c.width, c.height));
  }
}
