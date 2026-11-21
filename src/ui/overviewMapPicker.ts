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
import { html } from "lit-html";
import { renderDetached } from "@verticopolis/components/windows/detached";
import {
  DEFAULT_MAP_VIEW,
  MAP_VIEWS,
  type MapViewEntry,
  type MapViewId,
} from "@verticopolis/components/render/overviewMap/views";

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
    // A press that chose nothing (the open list dismissed, or the chosen view
    // picked again) leaves focus on the select; once focus leaves it, or a
    // key is pressed on it, the press is forgotten, so the next choice from
    // the keyboard keeps focus here. `selected` on the options, since a
    // select's `value` set before its options are drawn would not hold.
    const forget = () => (this.focusBefore = undefined);
    const [root] = renderDetached(
      doc,
      html`<label id=${MAP_PICKER_DOM.root} class="overview-map-views"
        ><span class="overview-map-views-label">View</span
        ><select id=${MAP_PICKER_DOM.select} class="field overview-map-picker"
          @pointerdown=${() => {
            if (this.focusBefore === undefined)
              this.focusBefore = doc.activeElement === this.select ? null : doc.activeElement;
          }}
          @change=${() => this.changed()} @blur=${forget} @keydown=${forget}
          >${views.map((view) => html`<option value=${view.id} ?selected=${view.id === this.selectedView}>${view.label}</option>`)}</select
        ></label
      >`,
    ).elements as [HTMLElement];
    this.root = root;
    this.select = root.querySelector("select")!;
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
    if (
      before instanceof HTMLElement &&
      before !== this.select &&
      before.isConnected &&
      before !== before.ownerDocument.body
    ) {
      before.focus({ preventScroll: true });
      return;
    }
    this.select.blur();
  }
}
