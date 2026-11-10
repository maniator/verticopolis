/**
 * The overview MAP window's view picker (#343 S9): one dropdown under the
 * title bar, "View" and a select with one option per view in `MAP_VIEWS`. It
 * took the place of S6's tab row when the Traffic and Occupancy views brought
 * the views to six, too many for a row of text tabs on the phone card (owner,
 * 2026-11-10). It is a native select, so the browser gives it its keys, its
 * name for a screen reader and its touch picker.
 *
 * A choice made with a pointer gives focus back to what held it before the
 * press (the map, or nothing), so a mouse or touch user keeps the game's keys
 * and a focused map keeps its arrow keys.
 */
import { DEFAULT_MAP_VIEW, MAP_VIEWS, type MapViewEntry, type MapViewId } from "../render/overviewMap/views";

/** The ids the CSS and the tests name. */
export const MAP_PICKER_DOM = {
  root: "overview-map-views",
  select: "overview-map-picker",
} as const;

export class MapViewPicker {
  readonly root: HTMLElement;
  readonly select: HTMLSelectElement;
  private selectedView: MapViewId = DEFAULT_MAP_VIEW;
  /** A pointer press on the select is under way: what held focus before it,
   *  or undefined while no press is. */
  private focusBefore: Element | null | undefined = undefined;

  /** `onSelect` hears every change of view, from a pointer or a key. */
  constructor(
    doc: Document,
    private readonly onSelect: (view: MapViewId) => void,
    private readonly views: ReadonlyArray<MapViewEntry> = MAP_VIEWS,
  ) {
    const root = doc.createElement("label");
    root.id = MAP_PICKER_DOM.root;
    root.className = "overview-map-views";
    const name = doc.createElement("span");
    name.className = "overview-map-views-label";
    name.textContent = "View";
    const select = doc.createElement("select");
    select.id = MAP_PICKER_DOM.select;
    select.className = "field overview-map-picker";
    for (const view of views) {
      const option = doc.createElement("option");
      option.value = view.id;
      option.textContent = view.label;
      select.append(option);
    }
    select.value = this.selectedView;
    select.addEventListener("pointerdown", () => {
      if (this.focusBefore === undefined) this.focusBefore = doc.activeElement === select ? null : doc.activeElement;
    });
    select.addEventListener("change", () => this.changed());
    // A press that chose nothing (the open list dismissed, or the chosen
    // view picked again) leaves focus on the select; once focus leaves it,
    // or a key is pressed on it, the press is forgotten, so the next choice
    // from the keyboard keeps focus here.
    select.addEventListener("blur", () => (this.focusBefore = undefined));
    select.addEventListener("keydown", () => (this.focusBefore = undefined));
    root.append(name, select);
    this.root = root;
    this.select = select;
  }

  /** The selected view. */
  get selected(): MapViewId {
    return this.selectedView;
  }

  private changed(): void {
    const view = this.views.find((entry) => entry.id === this.select.value)?.id;
    const before = this.focusBefore;
    this.focusBefore = undefined;
    if (before !== undefined) this.giveFocusBack(before);
    if (!view || view === this.selectedView) return;
    this.selectedView = view;
    this.onSelect(view);
  }

  /** Focus goes back to what held it before a pointer press, when that is
   *  still on the page and can take it; otherwise the select lets go. */
  private giveFocusBack(before: Element | null): void {
    if (before instanceof HTMLElement && before !== this.select && before.isConnected && before !== before.ownerDocument.body) {
      before.focus({ preventScroll: true });
      return;
    }
    this.select.blur();
  }
}
