import { catalogFacility } from "../engine/catalogTypes";
import { clockOf } from "../simport/headerClock";
import type { ViewReader } from "../simport/viewReader";
import type { CardKit } from "./cardKit";
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
 * contract (survives transient null picks, spent by a different pick or by
 * explicit fresh intent such as a tap or long-press, dropped on a tower
 * swap) can be unit-tested without a DOM game shell. The anchor cell stays in GameApp — its per-frame panel
 * positioning reads it — and is written through `deps.setAnchor`.
 *
 * Each pick asks the port for the facility's card (one `unitCard` or
 * `shaftCard`, the shaft's kept per revision and hour) and keeps nothing of
 * the tower: the kit is read per call, so an adoptSim() swap is picked up.
 */
export interface InspectorDeps {
  /** The cards and the reads the port lacks (read per call). */
  kit(): CardKit;
  /** The view, for the clock. */
  reader(): Pick<ViewReader, "header">;
  ui: Pick<UI, "showInspector">;
  /** World cell the card describes (GameApp anchors the panel to it each frame). */
  setAnchor(anchor: { x: number; left: number; floor: number } | null): void;
}

export class InspectorController {
  /** The facility the inspector card currently describes. */
  private inspectTarget: { type: "unit" | "transport"; id: number } | null = null;
  /** ✕-dismissed target: stays hidden while hover picks keep landing on the
   *  same facility (otherwise the next hover event would instantly re-open
   *  the card), and survives transient null/floor picks (pointer jitter).
   *  Spent by picking a DIFFERENT facility, by explicit fresh intent (a
   *  tap/click via selectPicked or a touch long-press via onLongPress), or
   *  by a tower swap (ids restart, so a stale latch would mute an unrelated
   *  card). */
  private inspectDismissed: { type: "unit" | "transport"; id: number } | null = null;

  constructor(private readonly deps: InspectorDeps) {}

  inspectPicked(p: Picked | null): void {
    if (!p || p.kind === "floor" || p.kind === "lobby") {
      // Hide, but keep any ✕-dismissal latch: a transient empty/floor pick
      // (pointer jitter crossing a gap) must not re-arm the card the user
      // just closed. The latch is spent only by picking a different facility
      // or by explicit fresh intent: a tap/click (selectPicked) or a touch
      // long-press (onLongPress), both through resetLatch.
      this.hide();
      return;
    }
    if (this.inspectDismissed && this.inspectDismissed.type === p.type && this.inspectDismissed.id === p.id) {
      return; // ✕-dismissed and only hover picks since — stay closed
    }
    this.inspectDismissed = null;
    if (p.type === "unit") {
      const kit = this.deps.kit();
      const u = kit.cards.unit(p.id);
      if (!u) {
        this.hide();
        return;
      }
      this.deps.setAnchor({ x: u.x + u.width, left: u.x, floor: u.floor + catalogFacility(kit.catalog(), u.kind).floors - 1 });
      const fresh = this.inspectTarget?.type !== "unit" || this.inspectTarget.id !== u.id;
      this.inspectTarget = { type: p.type, id: p.id };
      // The card body (title/label/status/census/diagnostics/satisfaction) is
      // the lit template in ui/templates/inspector.ts (E6-S2); the access
      // reachability, placement warnings, on-notice countdown, recycling
      // capacity, and retail patronage lines all come from facilityDiagnostics
      // inside it, shared with the mobile editor fold-in so the two surfaces
      // can't drift.
      this.deps.ui.showInspector(unitInspectorTemplate(u, kit.catalog(), clockOf(this.deps.reader().header).hour, kit.diagnostics.unit(u.id, fresh)));
    } else {
      const kit = this.deps.kit();
      const t = kit.cards.shaft(p.id);
      if (!t) {
        this.hide();
        return;
      }
      this.deps.setAnchor({ x: t.x + t.width, left: t.x, floor: t.top });
      this.inspectTarget = { type: p.type, id: p.id };
      this.deps.ui.showInspector(transportInspectorTemplate(t, kit.catalog(), kit.diagnostics.transport(t.id)));
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
