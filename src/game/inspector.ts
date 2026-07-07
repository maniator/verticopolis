import type { Simulation } from "../engine/Simulation";
import { VACATE_RESCIND } from "../engine/Simulation";
import { FACILITIES, facilityFloors, isCommercialKind, isElevatorKind, isHotelKind, residentCount } from "../engine/facilities";
import { ECON } from "../engine/econConfig";
import { isOperational, VACATE_REASON_TEXT } from "../engine/types";
import type { Picked } from "../render/excalibur/TowerEngine";
import type { UI } from "../ui/UI";
import { escapeHtml } from "../ui/escape";
import { floorTag } from "../ui/format";

/**
 * The hover inspector card: what it shows for a picked facility and the
 * ✕-dismissal latch that keeps a closed card closed while hover picks keep
 * landing on the same facility. Split out of the GameApp class so the latch
 * contract (survives transient null picks, spent by a different pick or an
 * explicit tap, dropped on a tower swap) can be unit-tested without a DOM
 * game shell. The anchor cell stays in GameApp — its per-frame panel
 * positioning reads it — and is written through `deps.setAnchor`.
 *
 * Never stores a Simulation — adoptSim() swaps the live instance, so every
 * method asks `deps.getSim()` fresh.
 */
export interface InspectorDeps {
  /** The live simulation (never cached — adoptSim swaps the instance). */
  getSim(): Simulation;
  ui: Pick<UI, "showInspector">;
  /** World cell the card describes (GameApp anchors the panel to it each frame). */
  setAnchor(anchor: { x: number; floor: number } | null): void;
}

/** The shared demand line for parking spaces & ramps: how many working spaces
 *  the tower has (`have`, passed in so the caller's single flood-fill is reused)
 *  vs what its offices (1 per ~24 workers) and suites (1 each) currently need. */
function parkingDemandLine(sim: Simulation, have: number): string {
  const d = sim.parkingDemand();
  const color = have < d.total ? "var(--bad)" : "var(--good)";
  return `<div style="color:${color}">Demand: ${have}/${d.total} spaces (${d.offices} for offices, ${d.suites} for suites).</div>`;
}

/** The recycling inspector block: current fill and the capacity/demand verdict.
 *  Population and capacity are each scanned once and reused across the strings
 *  (the demand-met check is `pop <= cap`, exactly {@link Simulation.recyclingDemandMet}),
 *  so a hover doesn't rescan the unit list several times over. */
function recyclingLine(sim: Simulation): string {
  const pop = sim.tower.totalPopulation();
  const cap = sim.recyclingCapacity();
  const fillPct = Math.round(sim.recyclingFill() * 100);
  return (
    `<div>Fill: ${fillPct}% — truck collects each morning.</div>` +
    (pop <= cap
      ? `<div style="color:var(--good)">Capacity: ${pop.toLocaleString()}/${cap.toLocaleString()} population — demand met.</div>`
      : `<div style="color:var(--bad)">Over capacity: ${pop.toLocaleString()} population vs ${cap.toLocaleString()} processed — build another center (4★ requires demand met).</div>`)
  );
}

export class InspectorController {
  /** The facility the inspector card currently describes. */
  private inspectTarget: { type: "unit" | "transport"; id: number } | null = null;
  /** ✕-dismissed target: stays hidden while hover picks keep landing on the
   *  same facility (otherwise the next hover event would instantly re-open
   *  the card), and survives transient null/floor picks (pointer jitter).
   *  Spent by picking a DIFFERENT facility, by an explicit tap/click
   *  (fresh intent — the only re-arm available on touch), or by a tower
   *  swap (ids restart, so a stale latch would mute an unrelated card). */
  private inspectDismissed: { type: "unit" | "transport"; id: number } | null = null;

  constructor(private readonly deps: InspectorDeps) {}

  inspectPicked(p: Picked | null): void {
    const sim = this.deps.getSim();
    if (!p || p.kind === "floor" || p.kind === "lobby") {
      // Hide, but keep any ✕-dismissal latch: a transient empty/floor pick
      // (pointer jitter crossing a gap) must not re-arm the card the user
      // just closed. The latch is spent only by picking a different facility
      // or by an explicit tap/click (selectPicked).
      this.hide();
      return;
    }
    if (this.inspectDismissed && this.inspectDismissed.type === p.type && this.inspectDismissed.id === p.id) {
      return; // ✕-dismissed and only hover picks since — stay closed
    }
    this.inspectDismissed = null;
    if (p.type === "unit") {
      const u = sim.tower.getUnit(p.id);
      if (!u) {
        this.hide();
        return;
      }
      this.deps.setAnchor({ x: u.x + u.width, floor: u.floor + facilityFloors(u.kind) - 1 });
      this.inspectTarget = { type: p.type, id: p.id };
      const f = FACILITIES[u.kind];
      // Access — the whole truth, not just "served": a floor can be connected yet
      // sit 3+ rides from the lobby, in which case no commuter ever comes. Only
      // shown for units that actually draw commuters/visitors (tenants + venues);
      // parking/service work via ramp-chaining/coverage, not passenger trips, so
      // an access warning on them would be a false alarm.
      const needsAccess = f.population > 0 || ECON.dailyTrafficIncome[u.kind] !== undefined;
      const served = sim.tower.isFloorServed(u.floor);
      const access = !needsAccess
        ? ""
        : !served
          ? `<div style="color:var(--bad)">Access: not connected — no elevator or stair reaches this floor.</div>`
          : sim.floorReachable(u.floor)
            ? `<div style="color:var(--good)">Access: reachable (≤2 rides from the lobby).</div>`
            : `<div style="color:var(--bad)">Access: too far — 3+ rides from the lobby, so no one travels here. Add a sky-lobby transfer.</div>`;
      // Silent rule: hotel guests stop counting toward the star rating at 3★.
      const hotel = isHotelKind(u.kind)
        ? sim.hotelsCountTowardRating()
          ? `<div style="color:var(--good)">Counts toward next star: yes.</div>`
          : `<div style="color:var(--bad)">Counts toward stars: no — hotel guests stop counting at 3★ (they still earn income).</div>`
        : "";
      // Silent rule: a parking space only works when it chains to a ramp. Skip
      // the verdict while it's still building (or on fire) — "Status" covers that.
      // One flood-fill for the whole parking card: its `.has(id)` gives ramp
      // connectivity and its `.size` feeds the demand line, so a hover never
      // runs the fill twice.
      const parkingSet =
        (u.kind === "parking" || u.kind === "parkingRamp") && isOperational(u)
          ? sim.tower.functionalParkingSet()
          : null;
      const parking = !parkingSet
        ? ""
        : u.kind === "parkingRamp"
          ? parkingDemandLine(sim, parkingSet.size)
          : parkingSet.has(u.id)
            ? `<div style="color:var(--good)">Ramp access: connected.</div>` + parkingDemandLine(sim, parkingSet.size)
            : `<div style="color:var(--bad)">Ramp access: none — this space is dead (no relief). Chain it to a Parking Ramp.</div>`;
      // W1: a served office whose nearest stairs/elevator is beyond the walking
      // tolerance is silently eroding — surface it always (like the W3 line below),
      // not only once the tenant is already on notice, and name the concrete fix.
      const walkFar =
        u.kind === "office" &&
        u.floor !== 1 &&
        sim.tower.isFloorServed(u.floor) &&
        sim.tower.nearestTransportDistance(u) > 79
          ? `<div style="color:var(--bad)">Long walk to transport — tenants tire of the hike. Put stairs or an elevator within reach.</div>`
          : "";
      // W3: a canon commercial venue (not partyHall) more than two floors from a
      // (sky) lobby loses half its shoppers. Name the ACHIEVABLE fix — lobbies only
      // go on the ground and every 15th floor, so "add a lobby here" is usually
      // impossible; the real move is to sit within 2 floors of one of those levels.
      const commercialLobby =
        isCommercialKind(u.kind) && sim.tower.nearestLobbyFloorDistance(u.floor) > 2
          ? `<div style="color:var(--bad)">Shoppers: too far from a lobby — traffic is halved. Keep it within 2 floors of the ground or a sky lobby (every 15th floor).</div>`
          : "";
      // Recycling runs on demand: how full it is right now, and whether the
      // tower has outgrown its centers (the canon 4★ gate).
      const recycling = u.kind === "recycling" && isOperational(u) ? recyclingLine(sim) : "";
      // A tenant on notice: spell out that they're leaving, why, how long is
      // left, and the exact recovery bar they must clear — the "inform before you
      // hurt them" contract, so the eviction is never a surprise. The countdown
      // and the current-vs-target read recompute on every hover, so they tick
      // down live as the game clock advances.
      const statusText = u.state === "vacating" ? "on notice — tenant leaving" : u.state;
      let notice = "";
      if (u.state === "vacating" && u.vacateReason) {
        const minsLeft = Math.max(0, (u.vacateAt ?? 0) - sim.clock.minutes);
        // Framed as an honest UPPER bound ("under N") using ceil, so the card
        // never implies the tenant has *more* time than they do. Once the notice
        // has elapsed, say so plainly — they leave on the next hourly tick.
        const left =
          minsLeft <= 0
            ? "any moment now"
            : minsLeft >= 24 * 60
              ? `in under ${Math.ceil(minsLeft / (24 * 60))} day(s)`
              : `in under ${Math.ceil(minsLeft / 60)} hour(s)`;
        const now = Math.round(u.satisfaction * 100);
        const target = Math.round(VACATE_RESCIND * 100);
        notice =
          `<div style="color:var(--bad)">Giving notice — ${escapeHtml(VACATE_REASON_TEXT[u.vacateReason])}. Leaves ${left}.</div>` +
          `<div>Fix the cause and get satisfaction to ${target}% to keep them (now ${now}%).</div>`;
      }
      this.deps.ui.showInspector(
        `<h4 class="win-title">${f.name}</h4>` +
          `<div>${u.label !== f.name ? escapeHtml(u.label) + "<br>" : ""}${u.floor >= 1 ? "Floor " + u.floor : "B" + (1 - u.floor)}</div>` +
          `<div>Status: ${statusText}</div>` +
          (f.population ? `<div>Occupants: ${u.occupants}/${residentCount(u)}</div>` : "") +
          access +
          hotel +
          parking +
          walkFar +
          commercialLobby +
          recycling +
          notice +
          `<div>Satisfaction: ${Math.round(u.satisfaction * 100)}%</div>`,
      );
    } else {
      const t = sim.tower.getTransport(p.id);
      if (!t) {
        this.hide();
        return;
      }
      this.deps.setAnchor({ x: t.x + t.width, floor: t.top });
      this.inspectTarget = { type: p.type, id: p.id };
      const f = FACILITIES[t.kind];
      // Passenger elevators report how full their cars run on average (staff-only
      // service elevators carry no passenger load, so they show none).
      const util = isElevatorKind(t.kind) ? sim.elevatorUtilization(t.id) : undefined;
      const busy =
        util === undefined
          ? ""
          : `<div style="color:${util > 0.85 ? "var(--bad)" : "var(--good)"}">Avg load: ${Math.round(util * 100)}% full${util > 0.85 ? " — near capacity, consider more cars or a parallel shaft." : ""}</div>`;
      this.deps.ui.showInspector(
        `<h4 class="win-title">${f.name}</h4><div>Serves floors ${floorTag(t.bottom)}–${floorTag(t.top)}</div>` +
          (isElevatorKind(t.kind) ? `<div>Cars: ${t.cars}</div>` : "") +
          busy,
      );
    }
  }

  /** Hide the inspector card, keeping any ✕-dismissal latch. */
  hide(): void {
    this.deps.setAnchor(null);
    this.inspectTarget = null;
    this.deps.ui.showInspector(null);
  }

  /** Hide the inspector and drop the ✕-dismissal latch too — for hard resets
   *  (new/loaded tower, where a recycled facility id must not stay muted) and
   *  for explicit taps, which are fresh intent. */
  clear(): void {
    this.inspectDismissed = null;
    this.hide();
  }

  /** ✕ pressed: latch the dismissal so the next hover pick over the same
   *  facility doesn't instantly re-open the card the user just closed. */
  dismiss(): void {
    this.inspectDismissed = this.inspectTarget;
    this.hide();
  }

  /** Drop the ✕-dismissal latch without hiding — an explicit tap/click is
   *  fresh intent, re-arming the card even for a dismissed facility. */
  resetLatch(): void {
    this.inspectDismissed = null;
  }
}
