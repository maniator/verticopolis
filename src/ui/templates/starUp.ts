import { html, nothing, type TemplateResult } from "lit-html";
import type { Catalog } from "@verticopolis/components/catalog/catalogTypes";
import type { StarDutyId } from "@verticopolis/components/catalog/starDutyTypes";
import type { NextStarView, StatsReport } from "@verticopolis/components/port/panels";
import { groupDigits } from "@verticopolis/components/windows/format";
import { iconTemplate } from "@verticopolis/components/windows/icons";
import { nextStarSection } from "./stats";

/**
 * The star-up message box (r/SimTower feedback, 2026-11-16): a player went
 * from one rating to the next without noticing, and tenants then left over a
 * need the new rating brought. The 1994 game told the player in a message box
 * that stopped play; this is that box. Every rating shows the new rating and
 * the rooms it opens. Where the catalog says so (`rules.announcesStarDuties`,
 * Modern), it adds what the new rating starts asking of the tower, the parking
 * as it stands, and what the next rating needs.
 */

/** Each duty's line in the heads-up, keyed by the id the catalog publishes. */
export const STAR_DUTY_LABELS: Readonly<Record<StarDutyId, string>> = {
  emergencies: "Fires can break out, and thieves can strike.",
  suiteParking: "Each hotel suite needs a working parking space of its own.",
  officeParking: "Offices need parking. Their ratings fall while there are too few spaces.",
  homeParking: "Homes need parking too. Without it they fill more slowly.",
  recycling: "Your tower's trash needs Recycling Centers. Ratings fall while there are too few.",
  vipVisits: "A VIP may come to stay in a hotel suite. Four stars needs a good review.",
  hotelGuestsUncounted: "Hotel guests no longer count toward your rating.",
  bombThreats: "A caller may threaten the tower with a bomb.",
};

/** The duties that are about parking, which earn the parking line below them. */
const PARKING_DUTIES: ReadonlySet<StarDutyId> = new Set(["suiteParking", "officeParking", "homeParking"]);

/** What the box shows, worked out from the catalog and the engine's report. */
export interface StarUpScreen {
  /** The rating just reached (2 to 5). */
  readonly star: number;
  /** The names of the rooms that open between the old rating and this one. */
  readonly rooms: ReadonlyArray<string>;
  /** The heads-up, or null where the catalog says the box has none. */
  readonly headsUp: {
    readonly duties: ReadonlyArray<StarDutyId>;
    /** The spaces the tower needs and has, when a parking duty begins now. */
    readonly parking: { readonly need: number; readonly have: number; readonly short: boolean } | null;
    readonly next: NextStarView | null;
  } | null;
  readonly topFloor: number;
}

/** The screen for a climb from `from` to `to` stars. `report` is the engine's
 *  stats answer, read only when the box has a heads-up. */
export function starUpScreen(from: number, to: number, catalog: Catalog, report: () => StatsReport): StarUpScreen {
  const between = (star: number) => star > from && star <= to;
  const rooms = catalog.facilities.filter((f) => f.available && between(f.minStar)).map((f) => f.name);
  let headsUp: StarUpScreen["headsUp"] = null;
  if (catalog.rules.announcesStarDuties) {
    const duties = catalog.rules.starDuties.filter((d) => between(d.star)).map((d) => d.id);
    const r = report();
    const parking = duties.some((d) => PARKING_DUTIES.has(d))
      ? { need: r.parkingDemand.total, have: r.functionalParking, short: r.parkingDemand.short }
      : null;
    headsUp = { duties, parking, next: r.nextStar };
  }
  return { star: to, rooms, headsUp, topFloor: catalog.world.maxFloor };
}

const stars = (n: number) => "★".repeat(n);

/** The box's body and its OK button. */
export function starUpTemplate(screen: StarUpScreen, onOk: () => void): TemplateResult {
  const h = screen.headsUp;
  const rooms = screen.rooms.length > 0 ? html`<p>You can now build: ${screen.rooms.join(", ")}.</p>` : nothing;
  const spaces = (n: number) => `${groupDigits(n)} space${n === 1 ? "" : "s"}`;
  const parking = h?.parking
    ? html`<p class="star-up-parking${h.parking.short ? " short" : ""}">Right now your tower needs ${spaces(h.parking.need)} and has ${groupDigits(h.parking.have)} working.</p>`
    : nothing;
  const duties =
    h && h.duties.length > 0
      ? html`<p><b>From now on:</b></p>
          <ul class="star-up-duties">${h.duties.map((d) => html`<li>${STAR_DUTY_LABELS[d]}</li>`)}</ul>
          ${parking}`
      : nothing;
  // Inside the Statistics dialog's grid, as there: a bare `.win-title` child of
  // the box would take the box's sticky title-bar rule and cover the text above.
  const next = h?.next ? html`<div class="stats-grid star-up-next">${nextStarSection(h.next, screen.topFloor)}</div>` : nothing;
  return html`<h2>${iconTemplate("milestone", { size: 20 })}Star Rating</h2>
    <p class="star-up-rating" aria-label=${`${screen.star} stars`}>${stars(screen.star)}</p>
    <p>Congratulations! Your tower is now rated <b>${screen.star} stars</b>.</p>
    ${rooms}${duties}${next}
    <div class="modal-actions modal-footer"><button class="btn primary" data-act="ok" @click=${onOk}>OK</button></div>`;
}
