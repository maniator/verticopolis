/**
 * A Map view's legend (#343 S6 and S8): a small key over the top of the map
 * body, as in the original, with a swatch per entry and the number of rooms
 * showing it, so the view reads in words as well as in color. It takes no
 * pointer, so a press on it lands on the map. The Hotel, Eval and Pricing
 * views each have one; only the selected view's legend shows.
 */
import type { MapViewId } from "../render/overviewMap/views";
import type { MapKindStyle } from "../render/overviewMap/style";

/** What a legend entry shows: its label and its swatch. */
export interface LegendEntry {
  readonly label: string;
  readonly style: MapKindStyle;
}

export class MapLegend {
  readonly root: HTMLElement;
  /** The count element per entry, in entry order. */
  private readonly counts: HTMLElement[] = [];
  private readonly written: string[] = [];

  constructor(doc: Document, view: MapViewId, entries: ReadonlyArray<LegendEntry>) {
    this.root = doc.createElement("div");
    this.root.className = "overview-map-legend";
    this.root.dataset.view = view;
    this.root.hidden = true;
    for (const entry of entries) {
      const item = doc.createElement("span");
      item.className = "overview-map-legend-item";
      const swatch = doc.createElement("span");
      swatch.className = "overview-map-swatch";
      swatch.dataset.pattern = entry.style.pattern;
      swatch.style.backgroundColor = entry.style.fill;
      swatch.setAttribute("aria-hidden", "true");
      const label = doc.createElement("span");
      label.textContent = `${entry.label}: `;
      const count = doc.createElement("span");
      count.className = "overview-map-legend-count";
      item.append(swatch, label, count);
      this.root.append(item);
      this.counts.push(count);
      this.written.push("");
    }
  }

  /** Show or hide the legend. */
  setShown(shown: boolean): void {
    this.root.hidden = !shown;
  }

  /** Write each entry's room count, `rooms(i)` for entry `i`, touching only
   *  the counts that changed. */
  count(rooms: (i: number) => number): void {
    for (let i = 0; i < this.counts.length; i++) {
      const text = String(rooms(i));
      if (text === this.written[i]) continue;
      this.written[i] = text;
      this.counts[i].textContent = text;
    }
  }
}
