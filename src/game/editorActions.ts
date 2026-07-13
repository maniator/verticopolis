import type { Simulation } from "../engine/Simulation";
import { FACILITIES, isElevatorKind, maxCarsFor } from "../engine/facilities";
import { ECON, rentConfig, carResaleRefund, extendBill } from "../engine/econConfig";
import type { FacilityKind, Transport, Unit } from "../engine/types";
import type { UI } from "../ui/UI";
import type { AudioEngine } from "../audio/Audio";
import type { BuildActions } from "./buildActions";

/**
 * The editor-card actions: everything the selected facility's buttons can do
 * (sell, rename, rent, cars, stops, film policy, extend), plus the dialogs
 * they open. Split out of the GameApp class so the charge/refund parity of the
 * editor paths can be unit-tested against the real Simulation. Selection
 * itself stays in GameApp (it is the app spine) and arrives as injected
 * getters; money paths route through {@link BuildActions} so refunds can't
 * drift from the bulldozer's.
 *
 * Never stores a Simulation — adoptSim() swaps the live instance, so every
 * method asks `deps.getSim()` fresh (dialog callbacks re-ask when they fire).
 */
export interface EditorActionsDeps {
  /** The live simulation (never cached — adoptSim swaps the instance). */
  getSim(): Simulation;
  ui: Pick<UI, "toast" | "showStopsDialog" | "showBatchPricingDialog">;
  audio: Pick<AudioEngine, "sfx">;
  /** Sell/refund/charge guards shared with the bulldozer. */
  build: Pick<BuildActions, "tryRemoveUnit" | "removeTransportWithRefund" | "canAfford">;
  /** Current selection (id-based; the entity may have been removed). */
  selected(): { type: "unit" | "transport"; id: number } | null;
  selectedUnit(): Unit | undefined;
  selectedTransport(): Transport | undefined;
  clearSelection(): void;
  refreshEditor(): void;
  captureUndo(label: string): void;
  commitUndo(): void;
  announce(msg: string): void;
}

export class EditorActions {
  /** High-water mark of a shaft's extent during an extend-arrow drag, so a
   *  back-and-forth wiggle is only charged for floors genuinely added. */
  private extendHwm: { id: number; top: number; bottom: number } | null = null;

  constructor(private readonly deps: EditorActionsDeps) {}

  /** Drop the extend high-water mark (the extend-arrow drag ended). */
  endExtend(): void {
    this.extendHwm = null;
  }

  /** Open the per-floor stop-configuration dialog for the selected elevator. */
  openStopsDialog(): void {
    const selected = this.deps.selected();
    if (!selected || selected.type !== "transport") return;
    const t = this.deps.selectedTransport();
    if (!t) return;
    const sim = this.deps.getSim();
    const lobbies = new Set(sim.tower.lobbyFloors());
    const floors: { floor: number; stop: boolean; lobby: boolean }[] = [];
    for (let fl = t.top; fl >= t.bottom; fl--) {
      floors.push({ floor: fl, stop: sim.tower.stopsAt(t, fl), lobby: lobbies.has(fl) });
    }
    this.deps.ui.showStopsDialog(FACILITIES[t.kind].name, floors, (floor, stop) => {
      // Each toggle is its own undo step (the surrounding handleEditAction
      // commit already fired before the dialog mutated anything).
      this.deps.captureUndo("Elevator stops");
      this.deps.getSim().tower.setStop(t.id, floor, stop);
      this.deps.commitUndo();
      this.deps.refreshEditor();
    });
  }

  /** Drag-extend the selected shaft so `end` reaches `targetFloor`. Charges
   *  $5,000 per floor, but only for floors beyond the drag's high-water mark
   *  (so dragging out and back doesn't bill twice). Shrinking is free.
   *  When an extend runs past the built structure the engine auto-lays the floor
   *  behind the shaft (see `Tower.resizeTransport`); that floor is folded into
   *  the per-floor extend charge rather than billed on top, so a shaft-floor is
   *  one priced action (matching the 1994 "no separate floor-build step"). This
   *  is deliberately cheaper than laying the tiles by hand yet strictly more
   *  expensive per floor than the floor tool, so it is never an exploit. */
  extendSelectedTo(end: "up" | "down", targetFloor: number): void {
    const selected = this.deps.selected();
    if (!selected || selected.type !== "transport") return;
    const t = this.deps.selectedTransport();
    if (!t || !isElevatorKind(t.kind)) return; // only lifts have extend handles / billing
    const sim = this.deps.getSim();
    if (!this.extendHwm || this.extendHwm.id !== t.id) {
      this.extendHwm = { id: t.id, top: t.top, bottom: t.bottom };
      this.deps.captureUndo("Extend");
    }
    // Bill only floors past the gesture's high-water mark, clamped to what the
    // player can afford — a fast drag grows as far as the budget allows (matching
    // a slow drag), and a broke drag simply stops growing (no per-frame toast).
    const { nb, nt, added } = extendBill(
      { bottom: t.bottom, top: t.top },
      this.extendHwm,
      end,
      targetFloor,
      sim.money,
      ECON.transportFloorCost,
    );
    if (nb === t.bottom && nt === t.top) return; // nothing changed this step

    const res = sim.tower.resizeTransport(t.id, nb, nt);
    if (res.ok) {
      sim.money -= added * ECON.transportFloorCost;
      this.extendHwm.top = Math.max(this.extendHwm.top, nt);
      this.extendHwm.bottom = Math.min(this.extendHwm.bottom, nb);
      this.deps.audio.sfx(added > 0 ? "build" : "click");
      this.deps.refreshEditor();
    }
    // A blocked step (cap reached, no structure, another shaft in the way) is
    // silent so a drag doesn't spam toasts; the shaft simply stops growing.
  }

  /** Open the batch-pricing dialog pre-scoped to `kind`, wired to the engine's
   *  pure preview + mutating apply (what you preview is what commits). */
  private openBatchPricing(kind: FacilityKind): void {
    const band = rentConfig(kind);
    if (!band) return;
    this.deps.ui.showBatchPricingDialog(
      { kind, kindLabel: FACILITIES[kind].name, band },
      {
        preview: (target, opts) => this.deps.getSim().previewRentBatch(kind, target, opts)!,
        apply: (target, opts) => {
          // Capture BEFORE the mutation (the dialog applies asynchronously, so the
          // synchronous captureUndo in handleEditAction is stale) → an undoable batch.
          this.deps.captureUndo("Set prices");
          const r = this.deps.getSim().applyRentBatch(kind, target, opts)!;
          this.deps.commitUndo();
          return r;
        },
        onApplied: (summary) => {
          this.deps.audio.sfx("build");
          this.deps.ui.toast(summary, "good");
          this.deps.announce(summary);
          this.deps.refreshEditor();
        },
      },
    );
  }

  handleEditAction(action: string, root: HTMLElement): void {
    const selected = this.deps.selected();
    if (!selected) return;
    const sim = this.deps.getSim();
    const UNDO_LABELS: Record<string, string> = {
      sell: "Sell",
      rename: "Rename",
      rentUp: "Rent change",
      rentDown: "Rent change",
      addcar: "Elevator cars",
      removecar: "Elevator cars",
      stops: "Elevator stops",
      express: "Elevator stops",
      allstops: "Elevator stops",
      extendUp: "Extend",
      extendDown: "Extend",
      filmPolicy: "Film policy",
      changeVariety: "Change variety",
    };
    this.deps.captureUndo(UNDO_LABELS[action] ?? "Edit");
    if (selected.type === "unit") {
      const u = this.deps.selectedUnit();
      if (!u) return this.deps.clearSelection();
      if (action === "sell") {
        if (!this.deps.build.tryRemoveUnit(u, "sell")) return;
        this.deps.audio.sfx("sell");
        this.deps.commitUndo();
        return this.deps.clearSelection();
      }
      if (action === "rename") {
        const input = root.querySelector<HTMLInputElement>("#ed-name");
        if (input) u.label = input.value.trim() || FACILITIES[u.kind].name;
        this.deps.audio.sfx("click");
        this.deps.refreshEditor();
      } else if (action === "rentUp" || action === "rentDown") {
        if (sim.adjustRent(u.id, action === "rentUp" ? 1 : -1) !== null) {
          this.deps.audio.sfx("click");
          this.deps.refreshEditor();
        }
      } else if (action === "filmPolicy") {
        const order = ["auto", "feature", "blockbuster"] as const;
        const next = order[(order.indexOf(u.filmPolicy ?? "auto") + 1) % order.length];
        sim.setFilmPolicy(u.id, next);
        this.deps.audio.sfx("click");
        this.deps.refreshEditor();
      } else if (action === "changeVariety") {
        // Canon retail reroll: picks a §7 name different from the current
        // (`Simulation.rerollSubtype`). Returns undefined for non-retail kinds
        // and for single-entry lists; both cases are already gated by the
        // editor card only rendering the button for retail.
        if (sim.rerollSubtype(u.id) !== undefined) {
          this.deps.audio.sfx("click");
          this.deps.refreshEditor();
        }
      } else if (action === "batchKind") {
        this.openBatchPricing(u.kind);
      }
    } else {
      const t = this.deps.selectedTransport();
      if (!t) return this.deps.clearSelection();
      if (action === "sell") {
        this.deps.build.removeTransportWithRefund(t);
        this.deps.audio.sfx("sell");
        this.deps.commitUndo();
        return this.deps.clearSelection();
      }
      if (action === "addcar") {
        // Cap check first: at max cars the button is disabled anyway, but a
        // money toast here would blame the wrong constraint.
        if (t.cars >= maxCarsFor(t.kind)) return;
        if (!this.deps.build.canAfford(ECON.addCarCost)) return;
        if (sim.tower.setCars(t.id, t.cars + 1)) sim.money -= ECON.addCarCost;
        this.deps.audio.sfx("build");
        this.deps.refreshEditor();
      } else if (action === "removecar") {
        // A removed car is a sale, so it pays out like one (half back).
        if (sim.tower.setCars(t.id, t.cars - 1)) sim.money += carResaleRefund();
        this.deps.audio.sfx("click");
        this.deps.refreshEditor();
      } else if (action === "stops") {
        this.openStopsDialog();
      } else if (action === "express") {
        sim.tower.setExpressStops(t.id);
        this.deps.audio.sfx("click");
        this.deps.refreshEditor();
      } else if (action === "allstops") {
        sim.tower.clearStops(t.id);
        this.deps.audio.sfx("click");
        this.deps.refreshEditor();
      } else if (action === "extendUp" || action === "extendDown") {
        const nb = action === "extendDown" ? t.bottom - 1 : t.bottom;
        const nt = action === "extendUp" ? t.top + 1 : t.top;
        const cost = ECON.transportFloorCost;
        if (!this.deps.build.canAfford(cost)) return;
        const res = sim.tower.resizeTransport(t.id, nb, nt);
        if (res.ok) {
          sim.money -= cost;
          this.deps.audio.sfx("build");
        } else if (res.reason) {
          this.deps.audio.sfx("error");
          this.deps.ui.toast(res.reason, "bad");
        }
        this.deps.refreshEditor();
      }
    }
    this.deps.commitUndo();
  }
}
