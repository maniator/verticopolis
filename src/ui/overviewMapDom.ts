/**
 * The overview MAP window's elements (#343): the window with its title bar,
 * the two stacked canvases and the text summary, plus the Map button that
 * opens it. Building them is all this does; `OverviewMapWindow` wires them.
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
  toggle.textContent = "Map";
  toggle.title = "Show the tower map";
  toggle.setAttribute("aria-controls", MAP_DOM_ID.window);
  return { root, close, body, towerCanvas, viewCanvas, summary, toggle };
}
