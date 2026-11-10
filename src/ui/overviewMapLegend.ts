/**
 * The Hotel view's legend (#343 S6, #1617): a small key over the top of the
 * map body, as in the original, with a swatch per need and the number of
 * rooms showing it, so the view reads in words as well as in color. It takes
 * no pointer, so a press on it lands on the map.
 */
import { HOTEL_LEGEND, type HotelWatch } from "../render/overviewMap/hotelView";

export class HotelLegend {
  readonly root: HTMLElement;
  /** The count element per legend entry, in `HOTEL_LEGEND` order. */
  private readonly counts: HTMLElement[] = [];
  private readonly written: string[] = [];

  constructor(doc: Document) {
    this.root = doc.createElement("div");
    this.root.className = "overview-map-legend";
    this.root.hidden = true;
    for (const entry of HOTEL_LEGEND) {
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

  /** Show or hide the legend (only the Hotel view has one). */
  setShown(shown: boolean): void {
    this.root.hidden = !shown;
  }

  /** Write each entry's room count from the watch's last check, touching
   *  only the counts that changed. */
  count(watch: Pick<HotelWatch, "rooms">): void {
    const entries = HOTEL_LEGEND;
    for (let i = 0; i < entries.length; i++) {
      let rooms = 0;
      for (const need of entries[i].needs) rooms += watch.rooms(need);
      const text = String(rooms);
      if (text === this.written[i]) continue;
      this.written[i] = text;
      this.counts[i].textContent = text;
    }
  }
}

/**
 * The note a view with no painter yet shows over the top of the map body, in
 * the legend's place and style (Eval and Pricing until S8). The map under it
 * is the Edit view.
 */
export class MapViewNote {
  readonly root: HTMLElement;

  constructor(doc: Document) {
    this.root = doc.createElement("div");
    this.root.className = "overview-map-note";
    this.root.hidden = true;
  }

  /** Show `text`, or hide the note when there is none. */
  show(text: string | undefined): void {
    if (text) this.root.textContent = text;
    this.root.hidden = !text;
  }
}
