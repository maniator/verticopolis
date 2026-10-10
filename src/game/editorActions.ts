import type { Simulation } from "../engine/Simulation";
import { FACILITIES, isElevatorKind, isHotelKind } from "../engine/facilities";
import type { FacilityKind, Transport, Unit } from "../engine/types";
import type { UI } from "../ui/UI";
import type { AudioEngine } from "../audio/Audio";
import type { BuildActions } from "./buildActions";
import { NOT_ENOUGH_MONEY } from "../engine/sim/charges";
import { trackEconomyActionOnce } from "../analytics";

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
  ui: Pick<UI, "toast" | "showBatchPricingDialog" | "showElevatorScheduleDialog">;
  audio: Pick<AudioEngine, "sfx">;
  /** Sell/refund paths shared with the bulldozer. */
  build: Pick<BuildActions, "tryRemoveUnit" | "removeTransportWithRefund">;
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

  /** Open the per-shaft elevator Schedule dialog for the selected elevator
   *  (elevator-scheduling #305 Phase 3, floors fold-in #464): the ONE per-shaft
   *  config surface. The stops port applies Serve toggles and the bulk stop
   *  actions LIVE against the current sim (each its own undo step, the retired
   *  stops dialog's semantics); the schedule working copy writes once through
   *  `Tower.setSchedule` on OK (hardened, undoable). */
  openSchedule(): void {
    const selected = this.deps.selected();
    if (!selected || selected.type !== "transport") return;
    const t = this.deps.selectedTransport();
    if (!t || !isElevatorKind(t.kind)) return;
    const sim = this.deps.getSim();
    const id = t.id;
    // Every stops-port method re-reads the LIVE sim: undo/redo stays live while
    // the dialog is open and adoptSim swaps the instance underneath us.
    const live = () => this.deps.getSim();
    const liveShaft = () => {
      const cur = live();
      const shaft = cur.tower.getTransport(id);
      return shaft && isElevatorKind(shaft.kind) ? { sim: cur, shaft } : undefined;
    };
    const stops = {
      read: () => {
        const at = liveShaft();
        if (!at) return [];
        const lobbies = new Set(at.sim.tower.lobbyFloors());
        const rows: { floor: number; served: boolean; lobby: boolean; endpoint: boolean }[] = [];
        for (let fl = at.shaft.top; fl >= at.shaft.bottom; fl--) {
          rows.push({
            floor: fl,
            served: at.sim.tower.stopsAt(at.shaft, fl),
            lobby: lobbies.has(fl),
            endpoint: fl === at.shaft.bottom || fl === at.shaft.top,
          });
        }
        return rows;
      },
      setServe: (floor: number, serve: boolean) => {
        const at = liveShaft();
        if (!at) return;
        // Refusals the engine would silently absorb must not burn an undo step:
        // endpoints always stop, and an express serves only lobby floors.
        if (floor === at.shaft.bottom || floor === at.shaft.top) return;
        if (serve && at.shaft.kind === "elevatorExpress" && !at.sim.tower.floorHasLobby(floor)) return;
        this.deps.captureUndo("Elevator stops");
        at.sim.tower.setStop(id, floor, serve);
        this.deps.commitUndo();
        this.deps.refreshEditor();
      },
      expressStops: () => {
        const at = liveShaft();
        if (!at) return;
        this.deps.captureUndo("Elevator stops");
        at.sim.tower.setExpressStops(id);
        this.deps.commitUndo();
        this.deps.audio.sfx("click");
        this.deps.refreshEditor();
      },
      allStops: () => {
        const at = liveShaft();
        if (!at) return;
        this.deps.captureUndo("Elevator stops");
        at.sim.tower.clearStops(id);
        this.deps.commitUndo();
        this.deps.audio.sfx("click");
        this.deps.refreshEditor();
      },
    };
    this.deps.ui.showElevatorScheduleDialog(
      {
        title: `Schedule: ${FACILITIES[t.kind].name} (floors ${t.bottom}-${t.top})`,
        ux: sim.rules.elevatorScheduleUX(),
        isExpress: t.kind === "elevatorExpress",
        cars: t.cars,
        bottom: t.bottom,
        top: t.top,
        stops,
        hourly: sim.elevatorHourlyLoad(id),
        origins: sim.elevatorOriginLoad(id),
        current: t.schedule,
        initialWeekend: sim.clock.isWeekend,
        announce: (msg) => this.deps.announce(msg),
      },
      {
        apply: (schedule) => {
          // Re-read the LIVE sim here, never the open-time capture: undo/redo
          // stays live while the dialog is open (main.ts runs it ahead of the
          // modal guard) and adoptSim swaps the instance underneath us. The id
          // survives serialization, so the shaft resolves on the restored tower.
          const live = this.deps.getSim();
          const shaft = live.tower.getTransport(t.id);
          if (!shaft || !isElevatorKind(shaft.kind)) {
            // The shaft no longer exists (undone past its construction, or
            // demolished). Nothing to write; say so instead of "saved".
            this.deps.ui.toast("That elevator is gone.", "bad");
            return;
          }
          this.deps.captureUndo("Set elevator schedule");
          live.tower.setSchedule(shaft.id, schedule);
          this.deps.commitUndo();
          this.deps.audio.sfx("build");
          this.deps.announce("Elevator schedule saved.");
          this.deps.refreshEditor();
        },
      },
    );
  }

  /** Drag-extend the selected shaft so `end` reaches `targetFloor`. The
   *  engine bills each floor past the drag's high-water mark (so dragging out
   *  and back doesn't bill twice) and grows only as far as the budget pays;
   *  shrinking is free (`Simulation.extendTransport`). Any floor laid behind
   *  the shaft is folded into that per-floor price, matching the 1994 "no
   *  separate floor-build step"; at $5,000 per shaft-floor the extend costs
   *  more per floor than laying the footprint with the floor tool, so it is
   *  never an exploit. */
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
    const before = { bottom: t.bottom, top: t.top };
    const res = sim.extendTransport(t.id, end, targetFloor, this.extendHwm);
    // A blocked or broke step (cap reached, no structure, another shaft in the
    // way, no money left) is silent so a drag doesn't spam toasts; the shaft
    // simply stops growing.
    if (!res.ok || (res.bottom === before.bottom && res.top === before.top)) return;
    if (res.added > 0) trackEconomyActionOnce("capacity_tune"); // paid shaft extend (latched; no count)
    this.extendHwm.top = Math.max(this.extendHwm.top, res.top);
    this.extendHwm.bottom = Math.min(this.extendHwm.bottom, res.bottom);
    this.deps.audio.sfx(res.added > 0 ? "build" : "click");
    this.deps.refreshEditor();
  }

  /** Open the batch-pricing dialog pre-scoped to `kind`, wired to the engine's
   *  pure preview + mutating apply (what you preview is what commits). The
   *  dialog renders a rung picker or the range editor off the SHAPE of the
   *  mode's price options, never the mode string. */
  private openBatchPricing(kind: FacilityKind): void {
    const options = this.deps.getSim().rules.priceOptions(kind);
    if (!options) return;
    this.deps.ui.showBatchPricingDialog(
      { kind, kindLabel: FACILITIES[kind].name, options },
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
          trackEconomyActionOnce("price_tune"); // batch pricing applied (latched; no value)
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
      rung: "Rent change",
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
        if (input) sim.tower.setLabel(u.id, input.value);
        this.deps.audio.sfx("click");
        this.deps.refreshEditor();
      } else if (action === "rentUp" || action === "rentDown") {
        if (sim.adjustRent(u.id, action === "rentUp" ? 1 : -1) !== null) {
          trackEconomyActionOnce("price_tune"); // engaged with pricing (latched; no value)
          this.deps.audio.sfx("click");
          this.deps.refreshEditor();
        }
      } else if (action === "rung") {
        // The Classic rung picker commits on change: a rung applies through the
        // engine's one price choke point; "noRate" takes the unit off the
        // market (charges nothing, blocks move-ins, never evicts). Announced
        // with the pinned strings (ux-pricing-split-editor §1.4 / §5).
        const sel = root.querySelector<HTMLSelectElement>("#ed-rung");
        const shape = sim.rules.priceOptions(u.kind);
        if (sel && shape?.shape === "ladder") {
          if (sel.value === "noRate") {
            if (sim.setNoRate(u.id)) {
              trackEconomyActionOnce("price_tune"); // engaged with pricing (latched; no value)
              this.deps.audio.sfx("click");
              this.deps.announce("No Rate: off the market. Charges nothing; no one moves in.");
            }
          } else {
            const rung = shape.rungs[Number(sel.value)];
            if (rung && sim.priceUnit(u, rung.value) !== null) {
              let what = "Rent";
              if (u.kind === "condo") what = "Sale price";
              else if (isHotelKind(u.kind)) what = "Room rate";
              trackEconomyActionOnce("price_tune"); // engaged with pricing (latched; no value)
              this.deps.audio.sfx("click");
              this.deps.announce(`${what} set to ${rung.label} ($${rung.value.toLocaleString()}).`);
            }
          }
          // Refresh on the refusal paths too (e.g. a condo that sold between
          // the last pump render and this change event): the re-render's
          // selection sync snaps the picker back to engine truth immediately,
          // so a refused choice never sits on the select until the next pump.
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
        this.deps.build.removeTransportWithRefund(t, "sell");
        this.deps.audio.sfx("sell");
        this.deps.commitUndo();
        return this.deps.clearSelection();
      }
      if (action === "addcar" || action === "removecar") {
        // The engine checks the car limit and the balance and moves the money
        // (a removed car is a sale, so it pays out half back). Only the money
        // refusal speaks: at the car limit or on the last car the button is
        // disabled anyway, and a toast would blame the wrong constraint.
        const res = action === "addcar" ? sim.addCar(t.id) : sim.removeCar(t.id);
        if (!res.ok) return res.reason === NOT_ENOUGH_MONEY ? this.refuse(res.reason) : undefined;
        trackEconomyActionOnce("capacity_tune"); // adjusted transport capacity (latched; no count)
        this.deps.audio.sfx(action === "addcar" ? "build" : "click");
        this.deps.refreshEditor();
      } else if (action === "schedule") {
        // Stops, staging, and scheduling share ONE surface (#464): the old
        // stops/express/allstops card actions live inside this dialog now.
        this.openSchedule();
      } else if (action === "extendUp" || action === "extendDown") {
        const up = action === "extendUp";
        const res = sim.extendTransport(t.id, up ? "up" : "down", up ? t.top + 1 : t.bottom - 1);
        if (!res.ok) {
          // Short of money: refused before anything moved, so no undo step.
          if (res.reason === NOT_ENOUGH_MONEY) return this.refuse(res.reason);
          this.deps.audio.sfx("error");
          if (res.reason) this.deps.ui.toast(res.reason, "bad");
        } else {
          trackEconomyActionOnce("capacity_tune"); // extended a shaft (latched; no count)
          this.deps.audio.sfx("build");
        }
        this.deps.refreshEditor();
      }
    }
    this.deps.commitUndo();
  }

  /** An engine refusal on an editor action: error sfx plus the engine's
   *  reason as a toast. Nothing moved, so no undo step is committed. */
  private refuse(reason: string): void {
    this.deps.audio.sfx("error");
    this.deps.ui.toast(reason, "bad");
  }
}
