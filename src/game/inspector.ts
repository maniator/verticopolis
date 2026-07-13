import type { Simulation } from "../engine/Simulation";
import { FACILITIES, facilityFloors, isCommercialKind, isElevatorKind, isOpenAt, residentCount } from "../engine/facilities";
import { isTenanted } from "../engine/types";
import type { Picked } from "../render/excalibur/TowerEngine";
import type { UI } from "../ui/UI";
import { escapeHtml } from "../ui/escape";
import { floorTag } from "../ui/format";
import { facilityDiagnostics, transportDiagnostics } from "./facilityDiagnostics";

// Re-exported from its shared home so existing importers (and the retail-stats
// unit tests) keep their `../game/inspector` path.
export { retailStatsLines } from "./facilityDiagnostics";

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
      // Access reachability, placement warnings, the on-notice countdown,
      // recycling capacity, and the retail patronage block all live in one
      // shared helper so the mobile editor can fold in the identical lines
      // (see facilityDiagnostics) without the two surfaces drifting.
      const diagnostics = facilityDiagnostics(sim, u);
      // A relocation is a life event (Modern condos), not a complaint, so the
      // status line reads differently; the diagnostics block explains the rest.
      const isRelocation = u.state === "vacating" && u.vacateReason === "relocation";
      const statusText =
        u.state === "vacating"
          ? isRelocation
            ? "on notice (household relocating)"
            : "on notice (tenant leaving)"
          : u.state;
      // Canon retail variant (§7): a shop / fastFood / restaurant with a
      // subtype titles as its specific name ("Chinese Cafe"), not the generic
      // kind name. Legacy retail units and every non-retail kind keep the
      // catalog name; the subtype field is whitelist-coerced on load, so
      // untrusted values never reach this string.
      const title = u.subtype ?? f.name;
      // The label subheading only appears when the player-set label is a real
      // rename: if it matches either the catalog name OR the subtype now shown
      // in the title, suppress the extra line so a shop renamed "Chinese Cafe"
      // (matching its subtype) doesn't render the name twice.
      const labelIsExtra = u.label !== f.name && u.label !== title;
      this.deps.ui.showInspector(
        `<h4 class="win-title">${escapeHtml(title)}</h4>` +
          `<div>${labelIsExtra ? escapeHtml(u.label) + "<br>" : ""}${u.floor >= 1 ? "Floor " + u.floor : "B" + (1 - u.floor)}</div>` +
          `<div>Status: ${statusText}</div>` +
          // Commercial venues contribute their LIVE customers to the census, so
          // show that number (plus a closed marker), never a static "N/25"
          // that reads as a flat, always-full population. "(closed)" only for a
          // tenanted venue outside business hours; vacancy/construction already
          // reads from the Status row.
          (isCommercialKind(u.kind) && f.population > 0
            ? `<div>Customers: ${u.customersIn ?? 0}${isTenanted(u) && !isOpenAt(u.kind, sim.clock.hour) ? " (closed)" : ""}</div>`
            : f.population
              ? `<div>Occupants: ${u.occupants}/${residentCount(u)}</div>`
              : "") +
          diagnostics +
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
      // service elevators carry no passenger load, so they show none). Shared
      // with the mobile transport editor via transportDiagnostics.
      this.deps.ui.showInspector(
        `<h4 class="win-title">${f.name}</h4><div>Serves floors ${floorTag(t.bottom)}–${floorTag(t.top)}</div>` +
          (isElevatorKind(t.kind) ? `<div>Cars: ${t.cars}</div>` : "") +
          transportDiagnostics(sim, t),
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
