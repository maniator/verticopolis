import type { Simulation } from "../engine/Simulation";
import { facilityFloors } from "../engine/facilities";
import type { Picked } from "../render/excalibur/TowerEngine";
import type { UI } from "../ui/UI";
import { unitInspectorTemplate, transportInspectorTemplate } from "../ui/templates/inspector";

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
      // The card body (title/label/status/census/diagnostics/satisfaction) is
      // the lit template in ui/templates/inspector.ts (E6-S2); the access
      // reachability, placement warnings, on-notice countdown, recycling
      // capacity, and retail patronage lines all come from facilityDiagnostics
      // inside it, shared with the mobile editor fold-in so the two surfaces
      // can't drift.
      this.deps.ui.showInspector(unitInspectorTemplate(sim, u));
    } else {
      const t = sim.tower.getTransport(p.id);
      if (!t) {
        this.hide();
        return;
      }
      this.deps.setAnchor({ x: t.x + t.width, floor: t.top });
      this.inspectTarget = { type: p.type, id: p.id };
      this.deps.ui.showInspector(transportInspectorTemplate(sim, t));
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
