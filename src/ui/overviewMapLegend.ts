/**
 * A Map view's legend (#343 S6 and S8): a small key over the top of the map
 * body, as in the original, with a swatch per entry and the number of rooms
 * showing it, so the view reads in words as well as in color. It takes no
 * pointer, so a press on it lands on the map. The Hotel, Eval and Pricing
 * views each have one; only the selected view's legend shows.
 */
import { html, type TemplateResult } from "lit-html";
import { styleMap } from "lit-html/directives/style-map.js";
import { renderDetached, type Detached } from "@verticopolis/components/windows/detached";
import type { MapViewId } from "@verticopolis/components/render/overviewMap/views";
import type { MapKindStyle } from "@verticopolis/components/render/overviewMap/style";

/** What a legend entry shows: its label and its swatch. */
export interface LegendEntry {
  readonly label: string;
  readonly style: MapKindStyle;
}

/** A legend: one swatch, label and room count per entry. */
function legendTemplate(
  view: MapViewId,
  entries: ReadonlyArray<LegendEntry>,
  counts: ReadonlyArray<string>,
  shown: boolean,
): TemplateResult {
  return html`<div class="overview-map-legend" data-view=${view} ?hidden=${!shown}>${entries.map(
    (entry, i) =>
      html`<span class="overview-map-legend-item"
        ><span class="overview-map-swatch" data-pattern=${entry.style.pattern} style=${styleMap({ backgroundColor: entry.style.fill })} aria-hidden="true"></span
        ><span>${entry.label}: </span><span class="overview-map-legend-count">${counts[i]}</span></span
      >`,
  )}</div>`;
}

export class MapLegend {
  readonly root: HTMLElement;
  private readonly drawn: Detached;
  /** Each entry's room count as written, in entry order. */
  private readonly written: string[];
  private shown = false;
  /** The measured reach (`reach`), and the body width it was measured at;
   *  NaN until a shown legend has been measured. */
  private reached = Number.NaN;
  private reachedAt = Number.NaN;

  constructor(
    doc: Document,
    private readonly view: MapViewId,
    private readonly entries: ReadonlyArray<LegendEntry>,
  ) {
    this.written = entries.map(() => "");
    this.drawn = renderDetached(doc, this.template());
    this.root = this.drawn.elements[0] as HTMLElement;
  }

  private template(): TemplateResult {
    return legendTemplate(this.view, this.entries, this.written, this.shown);
  }

  /** Show or hide the legend. */
  setShown(shown: boolean): void {
    this.reached = Number.NaN;
    if (shown === this.shown) return;
    this.shown = shown;
    this.drawn.update(this.template());
  }

  /** How far down the body the legend reaches, in CSS pixels: its top offset
   *  plus its height. It is measured once per change (shown, a count written,
   *  a new body `width`), so a steady frame reads no layout. A legend not laid
   *  out yet (the window still hidden) measures 0 and is measured again. */
  reach(width: number): number {
    if (width !== this.reachedAt || !(this.reached > 0)) {
      this.reached = this.root.hidden ? 0 : this.root.offsetTop + this.root.offsetHeight;
      this.reachedAt = width;
    }
    return this.reached;
  }

  /** Write each entry's room count, `rooms(i)` for entry `i`; the legend
   *  draws again only when a count changed, and lit writes only those. */
  count(rooms: (i: number) => number): void {
    let changed = false;
    for (let i = 0; i < this.written.length; i++) {
      const text = String(rooms(i));
      if (text === this.written[i]) continue;
      this.written[i] = text;
      changed = true;
    }
    if (!changed) return;
    this.drawn.update(this.template());
    // A longer count can wrap the legend onto another line.
    this.reached = Number.NaN;
  }
}
