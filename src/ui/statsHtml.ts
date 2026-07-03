import type { Simulation } from "../engine/Simulation";
import { escapeHtml } from "./escape";

/**
 * The Tower Statistics dialog body — a pure function of the sim, split out of
 * the GameApp class so the modal content can be unit-tested headlessly.
 */
export function buildStatsHtml(sim: Simulation): string {
  const s = sim.stats();
  const c = sim.clock;
  const next = sim.nextStarThreshold;
  const fmt = (n: number) => n.toLocaleString();
  // Modal-only diagnostics — a full scan and a flood-fill, computed here at
  // modal-build time so they never run on the ~6 Hz HUD stats() path.
  const ratingPop = sim.ratingPopulation();
  const parkingWorking = sim.tower.functionalParkingSet().size;
  const parkingDemand = sim.parkingDemand();
  const recyclingCap = sim.recyclingCapacity();
  const recyclingShort = !sim.recyclingDemandMet();
  const stranded = sim.strandedFloors().length; // BFS-bearing
  // Only when hotels have dropped out of the rating (3★+) and actually diverge.
  const ratingRow =
    s.star >= 3 && ratingPop < s.population
      ? `<span class="k">Counts toward stars</span><span class="v">${fmt(ratingPop)}</span>`
      : "";
  return `<div class="stats-grid">
      <div class="stats-section win-title sm">Overview</div>
      <div class="col kv">
        <span class="k">Tower name</span><span class="v">${escapeHtml(sim.tower.towerName)}</span>
        <span class="k">Rating</span><span class="v stars">${s.star >= 6 ? "TOWER" : s.star + "★"}</span>
        <span class="k">Population</span><span class="v">${fmt(s.population)}</span>
        ${ratingRow}
        <span class="k">Next star at</span><span class="v">${next ? fmt(next) : "—"}</span>
        <span class="k">Funds</span><span class="v ${sim.money < 0 ? "loss" : "money"}">$${fmt(Math.round(sim.money))}</span>
        <span class="k">Date</span><span class="v">${c.dayName}, day ${c.day + 1}</span>
      </div>
      <div class="col kv">
        <span class="k">Floors above</span><span class="v">${s.floors}</span>
        <span class="k">Basements</span><span class="v">${s.basements}</span>
        <span class="k">Elevators</span><span class="v">${s.elevators}</span>
        <span class="k">All transports</span><span class="v">${s.transports}</span>
      </div>
      <div class="stats-section win-title sm">Tenancy</div>
      <div class="col kv">
        <span class="k">Offices</span><span class="v">${s.occupiedOffices}/${s.offices}</span>
        <span class="k">Condos sold</span><span class="v">${s.soldCondos}/${s.condos}</span>
        <span class="k">Vacancies</span><span class="v">${s.vacant}</span>
      </div>
      <div class="col kv">
        <span class="k">Hotel rooms in use</span><span class="v">${s.occupiedHotel}/${s.hotelRooms}</span>
        <span class="k">Rooms to clean</span><span class="v">${s.dirty}</span>
        <span class="k">Shops / Food</span><span class="v">${s.shops} / ${s.restaurants}</span>
        <span class="k">On fire</span><span class="v" style="color:${s.fires ? "var(--bad)" : "var(--good)"}">${s.fires || "None"}</span>
      </div>
      <div class="stats-section win-title sm">Transport &amp; access</div>
      <div class="col kv">
        <span class="k">Stranded floors</span><span class="v" style="color:${stranded ? "var(--bad)" : "var(--good)"}">${stranded || "None"}</span>
        ${
          s.parkingSpaces > 0
            ? `<span class="k">Parking spaces</span><span class="v" style="color:${parkingWorking < s.parkingSpaces ? "var(--bad)" : "var(--good)"}">${parkingWorking} / ${s.parkingSpaces} working</span>`
            : ""
        }
        ${
          s.parkingSpaces > 0 || parkingDemand.total > 0
            ? `<span class="k">Parking demand</span><span class="v" style="color:${parkingWorking < parkingDemand.total ? "var(--bad)" : "var(--good)"}">${fmt(parkingDemand.total)} needed (${fmt(parkingDemand.offices)} offices + ${fmt(parkingDemand.suites)} suites)</span>`
            : ""
        }
        ${
          recyclingCap > 0 || (sim.star >= 3 && recyclingShort)
            ? `<span class="k">Recycling</span><span class="v" style="color:${recyclingShort ? "var(--bad)" : "var(--good)"}">${
                recyclingCap === 0
                  ? `${fmt(s.population)} population, no center — build one`
                  : `${fmt(s.population)} / ${fmt(recyclingCap)} processed${recyclingShort ? " — build more" : ""}`
              }</span>`
            : ""
        }
      </div>
      ${
        stranded || ratingRow
          ? `<div class="col kv">${
              stranded
                ? `<span class="k" style="color:var(--muted);grid-column:1/-1">Stranded = leased floors 3+ rides from the lobby; they earn rating but draw no visitors. Add a sky-lobby transfer.</span>`
                : ""
            }${
              ratingRow
                ? `<span class="k" style="color:var(--muted);grid-column:1/-1">Hotel guests count toward your star rating only until 3★.</span>`
                : ""
            }</div>`
          : ""
      }
      ${buildMilestonesHtml(sim)}
    </div>`;
}

/** The optional-goals checklist for the stats modal. */
export function buildMilestonesHtml(sim: Simulation): string {
  const mp = sim.milestoneProgress();
  const half = Math.ceil(mp.list.length / 2);
  const col = (items: typeof mp.list) =>
    `<div class="col ms kv">${items
      .map(
        (m) =>
          `<span class="k${m.done ? " ms-done" : ""}">${m.done ? "✓" : "·"} ${escapeHtml(m.label)}</span>` +
          `<span class="v">${escapeHtml(m.desc)}</span>`,
      )
      .join("")}</div>`;
  const pct = mp.total ? Math.round((mp.achieved / mp.total) * 100) : 0;
  return (
    `<div class="stats-section win-title sm">🏅 Milestones (${mp.achieved}/${mp.total})` +
    `<span class="evalbar"><span style="width:${pct}%"></span></span></div>` +
    col(mp.list.slice(0, half)) +
    col(mp.list.slice(half))
  );
}
