import { html, nothing, type TemplateResult } from "lit-html";
import { iconTemplate } from "@verticopolis/components/windows/icons";
import { renderDetached } from "@verticopolis/components/windows/detached";

/**
 * The overview MAP window's elements (#343): the window with its title bar,
 * the two stacked canvases and the text summary, plus the Map button that
 * opens it, plus `ContextWatch`, which tracks whether the canvases' 2D
 * contexts are lost. `OverviewMapWindow` hears their events through
 * `MapDomEvents`.
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

/** What the window hears from its elements. */
export interface MapDomEvents {
  readonly toggle: (e: MouseEvent) => void;
  readonly close: (e: MouseEvent) => void;
  readonly key: (e: KeyboardEvent) => void;
  readonly mouseDown: (e: MouseEvent) => void;
  readonly wheel: (e: WheelEvent) => void;
  readonly mapFocus: () => void;
  readonly mapBlur: () => void;
  readonly pointerDown: (e: PointerEvent) => void;
  readonly pointerMove: (e: PointerEvent) => void;
  readonly pointerUp: (e: PointerEvent) => void;
  /** A pointercancel or lostpointercapture: the press ends unreleased. */
  readonly pointerEnd: (e: PointerEvent) => void;
  readonly contextLost: (e: Event) => void;
  readonly contextRestored: (e: Event) => void;
}

/** What the views put in the window: the View dropdown, drawn right after
 *  the title bar, and the legends, drawn in the body over the canvases. */
export interface MapDomParts {
  readonly picker?: Node;
  readonly legends?: ReadonlyArray<Node>;
}

const preventDefault = (e: Event): void => e.preventDefault();

/** The window (hidden) and its button, side by side. */
export function mapTemplate(on: MapDomEvents, parts: MapDomParts = {}): TemplateResult {
  // A pinch or Ctrl+wheel over the window never zooms the page, which takes a
  // listener that is not passive.
  const wheel = { handleEvent: on.wheel, passive: false };
  // The summary is heard only while the map has focus (the window turns it on
  // and off), and written only when the words change: moving the view with
  // the map's keys is announced, and panning the world with the map open
  // stays quiet. The toggle's glyph shows on desktop only (the phone pill
  // keeps its word alone).
  return html`<div id=${MAP_DOM_ID.window} class="win win-closable overview-map" hidden role="region" aria-labelledby=${MAP_DOM_ID.title}
      @keydown=${on.key} @contextmenu=${preventDefault} @mousedown=${on.mouseDown} @wheel=${wheel}
    ><div class="win-title"><span id=${MAP_DOM_ID.title}>Map</span><button type="button" class="btn xs overview-map-close" aria-label="Close the map" @click=${on.close}>✕</button></div>${parts.picker ?? nothing}<div class="overview-map-body"
      ><canvas class="overview-map-tower" aria-hidden="true" @contextlost=${on.contextLost} @contextrestored=${on.contextRestored}></canvas><canvas
        class="overview-map-view" tabindex="0" role="application"
        aria-label="Tower map. Arrow keys move the view, Home and End go to the top and bottom." aria-describedby=${MAP_DOM_ID.summary}
        @contextlost=${on.contextLost} @contextrestored=${on.contextRestored}
        @focus=${on.mapFocus} @blur=${on.mapBlur}
        @pointerdown=${on.pointerDown} @pointermove=${on.pointerMove} @pointerup=${on.pointerUp}
        @pointercancel=${on.pointerEnd} @lostpointercapture=${on.pointerEnd}
      ></canvas>${parts.legends ?? nothing}</div
    ><p id=${MAP_DOM_ID.summary} class="visually-hidden" aria-live="off"></p></div
  ><button type="button" id=${MAP_DOM_ID.toggle} class="btn overview-map-toggle" title="Show the tower map" aria-controls=${MAP_DOM_ID.window} @click=${on.toggle}
    >${iconTemplate("map", {})}Map</button
  >`;
}

/** Draw the window (hidden) and its button. The caller puts them in the page. */
export function buildMapDom(doc: Document, on: MapDomEvents, parts: MapDomParts = {}): MapDom {
  const [root, toggle] = renderDetached(doc, mapTemplate(on, parts)).elements as [HTMLElement, HTMLButtonElement];
  const part = <T extends Element>(selector: string): T => root.querySelector<T>(selector)!;
  return {
    root,
    title: part(".win-title"),
    close: part(".overview-map-close"),
    body: part(".overview-map-body"),
    towerCanvas: part(".overview-map-tower"),
    viewCanvas: part(".overview-map-view"),
    summary: part(`#${MAP_DOM_ID.summary}`),
    toggle,
  };
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
    private readonly changed: () => void,
  ) {}

  /** A canvas's `contextlost` event. */
  lostEvent(canvas: EventTarget | null): void {
    if (!this.canvases.includes(canvas as HTMLCanvasElement)) return;
    this.lostByEvent.add(canvas as HTMLCanvasElement);
    this.changed();
  }

  /** A canvas's `contextrestored` event. */
  restoredEvent(canvas: EventTarget | null): void {
    if (!this.canvases.includes(canvas as HTMLCanvasElement)) return;
    this.lostByEvent.delete(canvas as HTMLCanvasElement);
    this.restoredByEvent = true;
    this.changed();
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
