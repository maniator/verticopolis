import type { Simulation } from "../engine/Simulation";
import { LEDGER_CATS, LEDGER_LABELS } from "../engine/Ledger";
import { isPresent } from "../engine/types";
import { escapeHtml } from "./escape";
import { floorTag } from "./format";

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
      ${sim.rules.hasVariantHouseholds ? householdSection(sim) : ""}
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
      ${buildIncomeHtml(sim)}
      ${buildElevatorHtml(sim)}
      ${buildMilestonesHtml(sim)}
    </div>`;
}

/** Passenger-elevator utilization, busiest shaft first — how full each runs on
 *  average, so the player can spot an overloaded shaft (add cars / a parallel
 *  run) or an idle one. Service elevators are excluded (no passenger load). */
export function buildElevatorHtml(sim: Simulation): string {
  const shafts = sim.elevatorStats();
  if (shafts.length === 0) return "";
  const kindName: Record<string, string> = {
    elevatorStandard: "Standard",
    elevatorExpress: "Express",
  };
  const row = (s: (typeof shafts)[number]) => {
    const pct = Math.round(s.utilization * 100);
    const color = pct > 85 ? "var(--bad)" : pct < 10 ? "var(--muted)" : "var(--good)";
    const label = `${kindName[s.kind] ?? "Elevator"} ${floorTag(s.bottom)}–${floorTag(s.top)}`;
    return (
      `<span class="k">${escapeHtml(label)} · ${s.cars} car${s.cars === 1 ? "" : "s"}</span>` +
      `<span class="v" style="color:${color}">${pct}% full</span>`
    );
  };
  // Cap the list so a tower packed with shafts doesn't blow out the modal.
  const shown = shafts.slice(0, 8);
  const half = Math.ceil(shown.length / 2);
  const col = (items: typeof shown) => `<div class="col kv">${items.map(row).join("")}</div>`;
  return (
    `<div class="stats-section win-title sm">Elevators (avg load, busiest first)</div>` +
    col(shown.slice(0, half)) +
    col(shown.slice(half))
  );
}

/** The per-category income breakdown: average $/day over the trailing quarter,
 *  net of each line's own overhead, so the player can see what actually earns. */
export function buildIncomeHtml(sim: Simulation): string {
  const { averages, hasData } = sim.incomeBreakdown();
  if (!hasData) return "";
  const money = (n: number) => {
    const r = Math.round(n);
    return `${r < 0 ? "-" : ""}$${Math.abs(r).toLocaleString()}`;
  };
  const rows = LEDGER_CATS.map((cat) => ({ cat, avg: averages[cat] }))
    // Hide lines that never moved (e.g. no condos built), but always show a
    // category that has any activity, positive or negative.
    .filter((r) => Math.round(r.avg) !== 0)
    .sort((a, b) => b.avg - a.avg);
  if (rows.length === 0) return "";
  // Net sums only the lines actually shown: a sub-$0.50/day category is hidden
  // from the list AND excluded here, so a near-zero line can't silently nudge
  // Net away from the visible rows. (Per-row whole-dollar rounding can still
  // make the shown figures not add up to the cent — that's display rounding,
  // not a hidden line.)
  const net = rows.reduce((sum, r) => sum + r.avg, 0);
  const line = (label: string, avg: number, bold = false) =>
    `<span class="k${bold ? " win-title sm" : ""}">${label}</span>` +
    `<span class="v" style="color:${avg < 0 ? "var(--bad)" : "var(--good)"}${bold ? ";font-weight:600" : ""}">${money(avg)}/day</span>`;
  const half = Math.ceil(rows.length / 2);
  const col = (items: typeof rows) =>
    `<div class="col kv">${items.map((r) => line(LEDGER_LABELS[r.cat], r.avg)).join("")}</div>`;
  return (
    `<div class="stats-section win-title sm">Income (avg / day, last quarter)</div>` +
    col(rows.slice(0, half)) +
    `<div class="col kv">${rows.slice(half).map((r) => line(LEDGER_LABELS[r.cat], r.avg)).join("")}` +
    line("Net", net, true) +
    `</div>`
  );
}

/**
 * Modern-only "Households" readout: the size mix of the tower's sold condos,
 * their average, and the total people housed. This is what makes variant
 * households legible — the player can see they've filled up on big families and
 * connect that to churn. Rendered only in Modern mode (a Classic tower's condos
 * are all 3s, so the section would carry no information); gated by the caller.
 */
function householdSection(sim: Simulation): string {
  const counts = new Map<number, number>();
  let households = 0;
  let residents = 0;
  for (const u of sim.tower.units) {
    // Count only households actually in residence (isPresent) — the same gate the
    // population census uses — so "People housed" always agrees with total
    // population and a not-present unit (empty, gutted) can never leave a ghost
    // family in the readout.
    if (u.kind === "condo" && u.residents !== undefined && isPresent(u)) {
      counts.set(u.residents, (counts.get(u.residents) ?? 0) + 1);
      households++;
      residents += u.residents;
    }
  }
  const head = `<div class="stats-section win-title sm">Households</div>`;
  if (households === 0) {
    return (
      head +
      `<div class="col kv"><span class="k" style="color:var(--muted);grid-column:1/-1">No condos sold yet — each sale draws a 2–5 person family.</span></div>`
    );
  }
  const avg = (residents / households).toFixed(1);
  const mix = [...counts.keys()]
    .sort((a, b) => a - b)
    .map((sz) => `${sz}p × ${counts.get(sz)}`)
    .join(" · ");
  return (
    head +
    `<div class="col kv">` +
    `<span class="k">People housed</span><span class="v">${residents.toLocaleString()}</span>` +
    `<span class="k">Avg household</span><span class="v">${avg}</span>` +
    `</div>` +
    `<div class="col kv"><span class="k">Size mix</span><span class="v">${mix}</span></div>`
  );
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
