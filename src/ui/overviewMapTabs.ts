/**
 * The overview MAP window's tab row (#343 S6): one tab per view in
 * `MAP_VIEWS`, under the title bar. A real tab control: a tablist of tabs
 * with `aria-selected`, one tab in the Tab order at a time, the arrow keys
 * and Home and End moving within the row (selection follows focus), and the
 * map body as the tab panel. The tabs are one row, as in the original, on a
 * desktop and on a phone alike.
 *
 * A mouse or touch press never moves focus onto a tab, so a click on a tab
 * leaves focus where it was: the game keeps its keys, and a focused map keeps
 * its arrow keys.
 */
import { DEFAULT_MAP_VIEW, MAP_VIEWS, type MapViewEntry, type MapViewId } from "../render/overviewMap/views";

/** The ids and classes the CSS and the tests name. */
export const MAP_TABS_DOM = {
  list: "overview-map-tabs",
  panel: "overview-map-panel",
  tabPrefix: "overview-map-tab-",
} as const;

/** The keys that move between tabs. */
export const MAP_TAB_KEY = {
  previous: ["ArrowLeft", "ArrowUp"],
  next: ["ArrowRight", "ArrowDown"],
  first: "Home",
  last: "End",
} as const;

/** The tab id for a view. */
export function tabId(view: MapViewId): string {
  return `${MAP_TABS_DOM.tabPrefix}${view}`;
}

/** Where a key moves within `count` tabs from `at`, wrapping at the ends, or
 *  null for a key the row does not answer. */
export function tabStep(key: string, at: number, count: number): number | null {
  if (count < 1) return null;
  if ((MAP_TAB_KEY.previous as ReadonlyArray<string>).includes(key)) return (at - 1 + count) % count;
  if ((MAP_TAB_KEY.next as ReadonlyArray<string>).includes(key)) return (at + 1) % count;
  if (key === MAP_TAB_KEY.first) return 0;
  if (key === MAP_TAB_KEY.last) return count - 1;
  return null;
}

export class MapTabs {
  readonly list: HTMLElement;
  private readonly tabs = new Map<MapViewId, HTMLButtonElement>();
  private selectedView: MapViewId = DEFAULT_MAP_VIEW;

  /** `onSelect` hears every change of view, from a click or a key. */
  constructor(
    doc: Document,
    private readonly panel: HTMLElement,
    private readonly onSelect: (view: MapViewId) => void,
    private readonly views: ReadonlyArray<MapViewEntry> = MAP_VIEWS,
  ) {
    const list = doc.createElement("div");
    list.id = MAP_TABS_DOM.list;
    list.className = "overview-map-tabs";
    list.setAttribute("role", "tablist");
    list.setAttribute("aria-label", "Map views");
    for (const view of views) {
      const tab = doc.createElement("button");
      tab.type = "button";
      tab.id = tabId(view.id);
      tab.className = "btn xs overview-map-tab";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", MAP_TABS_DOM.panel);
      tab.dataset.mapView = view.id;
      tab.textContent = view.label;
      // Focus follows a click only when it was already in the row.
      tab.addEventListener("click", () => this.choose(view.id, this.list.contains(doc.activeElement)));
      this.tabs.set(view.id, tab);
      list.append(tab);
    }
    // A press keeps focus where it was (the root lets a button take it).
    list.addEventListener("mousedown", (e) => e.preventDefault());
    list.addEventListener("keydown", (e) => this.onKey(e));
    panel.id = MAP_TABS_DOM.panel;
    panel.setAttribute("role", "tabpanel");
    this.list = list;
    this.mark();
  }

  /** The selected view. */
  get selected(): MapViewId {
    return this.selectedView;
  }

  /** Select a view. `focus` moves focus onto its tab (a key press does). */
  private choose(view: MapViewId, focus: boolean): void {
    const changed = view !== this.selectedView;
    this.selectedView = view;
    this.mark();
    if (focus) this.tabs.get(view)?.focus({ preventScroll: true });
    if (changed) this.onSelect(view);
  }

  /** Bring every tab's selected state and the Tab order in line. */
  private mark(): void {
    for (const [id, tab] of this.tabs) {
      const selected = id === this.selectedView;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    this.panel.setAttribute("aria-labelledby", tabId(this.selectedView));
  }

  private onKey(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const at = this.views.findIndex((view) => view.id === this.selectedView);
    const next = tabStep(e.key, Math.max(0, at), this.views.length);
    if (next === null) return;
    // The window keeps the key from the game as it bubbles on.
    e.preventDefault();
    this.choose(this.views[next].id, true);
  }
}
