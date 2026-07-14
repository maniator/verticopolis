import { html, type TemplateResult } from "lit-html";

/** The subset of the per-pump stats snapshot the grid renders. Mirrors the
 *  legacy `towerStatsHtml` parameter shape so the transitional equivalence
 *  guard can drive both from one object. */
export interface TowerStatsSnapshot {
  floors: number;
  basements: number;
  occupiedOffices: number;
  offices: number;
  soldCondos: number;
  condos: number;
  occupiedHotel: number;
  hotelRooms: number;
  dirty: number;
  shops: number;
  restaurants: number;
  transports: number;
  vacant: number;
}

/**
 * The tower-stats grid body (E5-S1, the first live view). Authored to match
 * `towerStatsHtml` structurally (proven by transitional guards, retired with the
 * string builders). Unlike the dialog templates this renders on the ~6 Hz pump path:
 * `uiStatus.update` calls lit `render()` into the `#tower-stats` container every
 * pump, and lit patches the changed text in place instead of the old
 * `innerHTML =` reparse, so the grid's DOM nodes keep their identity across
 * pumps (asserted by the E5-S0 perf gate's node-identity probe, and priced by
 * its `ui.update` micro-benchmark). The container is lit's exclusively: nothing
 * else may write `#tower-stats` (one container, one renderer).
 */
export function towerStatsTemplate(s: TowerStatsSnapshot): TemplateResult {
  return html`
      <span class="k">Floors</span><span class="v">${s.floors} / B${s.basements}</span>
      <span class="k">Offices</span><span class="v">${s.occupiedOffices}/${s.offices}</span>
      <span class="k">Condos sold</span><span class="v">${s.soldCondos}/${s.condos}</span>
      <span class="k">Hotel (in use)</span><span class="v">${s.occupiedHotel}/${s.hotelRooms}</span>
      <span class="k">Rooms to clean</span><span class="v" style="color:${s.dirty ? "var(--bad)" : "inherit"}">${s.dirty}</span>
      <span class="k">Shops / Food</span><span class="v">${s.shops} / ${s.restaurants}</span>
      <span class="k">Transports</span><span class="v">${s.transports}</span>
      <span class="k">Vacancies</span><span class="v">${s.vacant}</span>`;
}
