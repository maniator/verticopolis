import { isElevatorKind, isHotelKind } from "../engine/facilities";
import { catalogFacility } from "../engine/catalogTypes";
import { priceOptionsFor } from "../ui/catalogPricing";
import type { FacilityKind } from "../engine/types";
import type { BatchRentResult } from "../engine/sim/constants";
import type { UI } from "../ui/UI";
import type { AudioEngine } from "../audio/Audio";
import type { BuildActions } from "./buildActions";
import type { EnginePort } from "../simport/enginePort";
import { outcome, type PortCodes } from "../simport/portCodes";
import { clockOf, rulesOf } from "../simport/headerClock";
import { scheduleSlots } from "../simport/scheduleSlots";
import type { ViewReader } from "../simport/viewReader";
import { NOT_ENOUGH_MONEY } from "../engine/sim/charges";
import { INVALID_COMMAND, MAX_TEXT } from "../simport/request";
import { BATCH_COUNTERS, batchTargetCode, type CardKit } from "./cardKit";

/**
 * The editor-card actions: everything the selected facility's buttons can do
 * (sell, rename, rent, cars, stops, film policy, extend), plus the dialogs
 * they open. Split out of the GameApp class so the charge/refund parity of the
 * editor paths can be unit-tested against the real Simulation. Selection
 * itself stays in GameApp (it is the app spine) and arrives as injected
 * getters; money paths route through {@link BuildActions} so refunds can't
 * drift from the bulldozer's.
 *
 * Every command goes through the engine port (contract section 7) and the
 * action reads only its record; the port answers synchronously, so an action
 * has played its feedback and closed its undo step by the time it returns.
 * The facility's fields come from the port's cards (`deps.kit().cards`), asked
 * on selection and after a command, never per frame. Nothing of the tower is
 * stored: the engine, the codes, the view and the kit are getters read per
 * call (dialog callbacks re-ask when they fire).
 */
export interface EditorActionsDeps {
  /** The engine the commands go to; it follows adoptSim itself. */
  engine(): EnginePort;
  /** The code tables and record slots of the engine's layout. */
  codes(): PortCodes;
  /** The view, for the clock and the rules. */
  reader(): Pick<ViewReader, "header" | "update">;
  /** The cards and the reads the port lacks. */
  kit(): CardKit;
  ui: Pick<UI, "toast" | "showBatchPricingDialog" | "showElevatorScheduleDialog">;
  audio: Pick<AudioEngine, "sfx">;
  /** Sell/refund paths shared with the bulldozer. */
  build: {
    // Both read only the facility's id, so a card serves as the argument.
    tryRemoveUnit(u: { id: number }, verb: "sell" | "bulldoze"): ReturnType<BuildActions["tryRemoveUnit"]>;
    removeTransportWithRefund(t: { id: number }, verb: "sell" | "bulldoze"): ReturnType<BuildActions["removeTransportWithRefund"]>;
  };
  /** Current selection (id-based; the entity may have been removed). */
  selected(): { type: "unit" | "transport"; id: number } | null;
  clearSelection(): void;
  refreshEditor(): void;
  captureUndo(label: string): void;
  commitUndo(): void;
  announce(msg: string): void;
}

export class EditorActions {
  /** The shaft, tower generation and ends of the extend-arrow drag in
   *  progress. The engine holds the gesture's high-water mark (`startExtend`,
   *  #990), so a back-and-forth wiggle is billed once; a tower swapped in
   *  mid-drag (a load, an undo) has no gesture open, so the drag begins a new
   *  one on it. The ends follow each step's record, so a pointer move asks
   *  the port for no card. */
  private extendDrag: { id: number; generation: number; bottom: number; top: number } | null = null;

  constructor(private readonly deps: EditorActionsDeps) {}

  /** Close the extend gesture (the extend-arrow drag ended). Closes it on the
   *  live tower: one swapped in mid-drag either has no gesture open or one
   *  this drag began on it (see {@link extendSelectedTo}). */
  endExtend(): void {
    if (!this.extendDrag) return;
    this.extendDrag = null;
    this.deps.engine().stopExtend();
  }

  /** Open the per-shaft elevator Schedule dialog for the selected elevator
   *  (elevator-scheduling #305 Phase 3, floors fold-in #464): the ONE per-shaft
   *  config surface. The stops port applies Serve toggles and the bulk stop
   *  actions LIVE against the current tower (each its own undo step, the retired
   *  stops dialog's semantics); the schedule working copy writes once through
   *  `scheduleShaft` on OK (hardened, undoable). */
  openSchedule(): void {
    const selected = this.deps.selected();
    if (!selected || selected.type !== "transport") return;
    // The reader has no per-frame pass yet, so read the tower's mode and clock now.
    this.deps.reader().update();
    const t = this.deps.kit().cards.shaft(selected.id);
    if (!t || !isElevatorKind(t.kind)) return;
    const id = t.id;
    // Every stops-port method re-reads the LIVE card: undo/redo stays live while
    // the dialog is open and adoptSim swaps the tower underneath us.
    const liveShaft = () => {
      const shaft = this.deps.kit().cards.shaft(id);
      return shaft && isElevatorKind(shaft.kind) ? shaft : undefined;
    };
    // A stops command changed the shaft, so the next card read asks the port.
    const stopsCommand = (run: (engine: EnginePort) => void, sound: boolean) => {
      if (!liveShaft()) return;
      this.deps.captureUndo("Elevator stops");
      run(this.deps.engine());
      this.deps.kit().cards.forget();
      this.deps.commitUndo();
      if (sound) this.deps.audio.sfx("click");
      this.deps.refreshEditor();
    };
    const stops = {
      read: () => [...(liveShaft()?.stops ?? [])],
      // The engine decides each refusal (an endpoint always stops, an express
      // serves only lobby floors); a refused or no-op toggle leaves the tower
      // as it was, so its commit records no undo step.
      setServe: (floor: number, serve: boolean) => (stopsCommand((e) => e.markStop(id, floor, serve), false), Promise.resolve()),
      expressStops: () => (stopsCommand((e) => e.expressStops(id), true), Promise.resolve()),
      allStops: () => (stopsCommand((e) => e.dropStops(id), true), Promise.resolve()),
    };
    const kit = this.deps.kit();
    const header = this.deps.reader().header;
    this.deps.ui.showElevatorScheduleDialog(
      {
        title: `Schedule: ${catalogFacility(kit.catalog(), t.kind).name} (floors ${t.bottom}-${t.top})`,
        ux: rulesOf(header).elevatorScheduleUX(),
        isExpress: t.kind === "elevatorExpress",
        cars: t.cars,
        bottom: t.bottom,
        top: t.top,
        stops,
        hourly: t.hourly ?? undefined,
        origins: t.origins
          ? { weekday: t.origins.weekday.map((ring) => new Map(ring)), weekend: t.origins.weekend.map((ring) => new Map(ring)) }
          : undefined,
        current: kit.currentSchedule(id),
        initialWeekend: clockOf(header).isWeekend,
        announce: (msg) => this.deps.announce(msg),
      },
      {
        apply: (schedule) => {
          // Re-read the LIVE card here, never the open-time capture: undo/redo
          // stays live while the dialog is open (main.ts runs it ahead of the
          // modal guard) and adoptSim swaps the tower underneath us. The id
          // survives serialization, so the shaft resolves on the restored tower.
          if (!liveShaft()) {
            // The shaft no longer exists (undone past its construction, or
            // demolished). Nothing to write; say so instead of "saved".
            this.deps.ui.toast("That elevator is gone.", "bad");
            return Promise.resolve();
          }
          this.deps.captureUndo("Set elevator schedule");
          const engine = this.deps.engine();
          const res = outcome(engine, engine.scheduleShaft(id, scheduleSlots(schedule)));
          this.deps.commitUndo();
          if (!res.ok) return Promise.resolve(this.refuse(res.reason ?? "That schedule could not be saved."));
          this.deps.audio.sfx("build");
          this.deps.announce("Elevator schedule saved.");
          this.deps.refreshEditor();
          return Promise.resolve();
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
    const engine = this.deps.engine();
    const generation = engine.generation();
    if (!this.extendDrag || this.extendDrag.id !== selected.id || this.extendDrag.generation !== generation) {
      const t = this.deps.kit().cards.shaft(selected.id);
      if (!t || !isElevatorKind(t.kind)) return; // only lifts have extend handles / billing
      this.extendDrag = { id: t.id, generation, bottom: t.bottom, top: t.top };
      this.deps.captureUndo("Extend");
      engine.startExtend(t.id);
    }
    const drag = this.extendDrag;
    const rec = engine.extendShaft(drag.id, end === "up", targetFloor);
    const res = outcome(engine, rec);
    const bottom = this.deps.codes().slot(rec, "extendShaft", "bottom");
    const top = this.deps.codes().slot(rec, "extendShaft", "top");
    // A blocked or broke step (cap reached, no structure, another shaft in the
    // way, no money left) is silent so a drag doesn't spam toasts; the shaft
    // simply stops growing.
    if (!res.ok || (bottom === drag.bottom && top === drag.top)) return;
    drag.bottom = bottom;
    drag.top = top;
    this.deps.kit().cards.forget();
    this.deps.audio.sfx(this.deps.codes().slot(rec, "extendShaft", "added") > 0 ? "build" : "click");
    this.deps.refreshEditor();
  }

  /** Open the batch-pricing dialog pre-scoped to `kind`, wired to the engine's
   *  pure preview + mutating apply (what you preview is what commits). The
   *  dialog renders a rung picker or the range editor off the SHAPE of the
   *  mode's price options, never the mode string. */
  private openBatchPricing(kind: FacilityKind): void {
    const kit = this.deps.kit();
    const catalog = kit.catalog();
    const options = priceOptionsFor(catalog, kind);
    if (!options) return;
    this.deps.ui.showBatchPricingDialog(
      { kind, kindLabel: catalogFacility(catalog, kind).name, options },
      {
        preview: (target, opts) => this.deps.kit().previewRentBatch(kind, target, opts)!,
        apply: (target, opts) => {
          // Capture BEFORE the mutation (the dialog applies asynchronously, so the
          // synchronous captureUndo in handleEditAction is stale) → an undoable batch.
          this.deps.captureUndo("Set prices");
          const engine = this.deps.engine();
          const codes = this.deps.codes();
          const rec = engine.rentBatch(codes.kind(kind), batchTargetCode(target), opts.onlyDefaultPriced ?? false);
          const res = outcome(engine, rec);
          this.deps.commitUndo();
          // The dialog offers only priced kinds and their targets, so a refusal
          // is the engine's call; say why and let the dialog close unsummed.
          if (!res.ok) {
            this.refuse(res.reason ?? "Those prices could not be set.");
            return Promise.resolve(null);
          }
          const batch = Object.fromEntries(BATCH_COUNTERS.map((name) => [name, codes.slot(rec, "rentBatch", name)])) as unknown as BatchRentResult;
          return Promise.resolve(batch);
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

  async handleEditAction(action: string, root: HTMLElement): Promise<void> {
    const selected = this.deps.selected();
    if (!selected) return;
    const kit = this.deps.kit();
    const engine = this.deps.engine();
    const codes = this.deps.codes();
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
      batchKind: "Edit",
    };
    this.deps.captureUndo(UNDO_LABELS[action] ?? "Edit");
    if (selected.type === "unit") {
      const u = kit.cards.unit(selected.id);
      if (!u) return this.deps.clearSelection();
      if (action === "sell") {
        if (!(await this.deps.build.tryRemoveUnit(u, "sell"))) return;
        this.deps.audio.sfx("sell");
        this.deps.commitUndo();
        return this.deps.clearSelection();
      }
      if (action === "rename") {
        const input = root.querySelector<HTMLInputElement>("#ed-name");
        if (input) {
          // The port takes any length; the cap stays here until it moves into the engines (see the PR).
          if (input.value.length > MAX_TEXT) return this.refuse(INVALID_COMMAND);
          const res = outcome(engine, engine.labelUnit(u.id, input.value));
          if (!res.ok) return this.refuse(res.reason ?? "That name could not be saved.");
        }
        this.deps.audio.sfx("click");
        this.deps.refreshEditor();
      } else if (action === "rentUp" || action === "rentDown") {
        if (outcome(engine, engine.stepRent(u.id, action === "rentUp" ? 1 : -1)).ok) {
          this.deps.audio.sfx("click");
          this.deps.refreshEditor();
        }
      } else if (action === "rung") {
        // The Classic rung picker commits on change: a rung applies through the
        // engine's one price choke point; "noRate" takes the unit off the
        // market (charges nothing, blocks move-ins, never evicts). Announced
        // with the pinned strings (ux-pricing-split-editor §1.4 / §5).
        const sel = root.querySelector<HTMLSelectElement>("#ed-rung");
        const shape = priceOptionsFor(kit.catalog(), u.kind);
        if (sel && shape?.shape === "ladder") {
          if (sel.value === "noRate") {
            if (outcome(engine, engine.noRate(u.id)).ok) {
              this.deps.audio.sfx("click");
              this.deps.announce("No Rate: off the market. Charges nothing; no one moves in.");
            }
          } else {
            const rung = shape.rungs[Number(sel.value)];
            if (rung && outcome(engine, engine.setRent(u.id, rung.value)).ok) {
              let what = "Rent";
              if (u.kind === "condo") what = "Sale price";
              else if (isHotelKind(u.kind)) what = "Room rate";
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
        engine.setFilm(u.id, codes.code("filmPolicies", next));
        this.deps.audio.sfx("click");
        this.deps.refreshEditor();
      } else if (action === "changeVariety") {
        // Canon retail reroll: picks a §7 name different from the current
        // (`Simulation.rerollSubtype`). Refused for non-retail kinds and for
        // single-entry lists; both cases are already gated by the editor card
        // only rendering the button for retail.
        if (outcome(engine, engine.rerollUnit(u.id)).ok) {
          this.deps.audio.sfx("click");
          this.deps.refreshEditor();
        }
      } else if (action === "batchKind") {
        this.openBatchPricing(u.kind);
      }
    } else {
      const t = kit.cards.shaft(selected.id);
      if (!t) return this.deps.clearSelection();
      if (action === "sell") {
        if (!(await this.deps.build.removeTransportWithRefund(t, "sell"))) return this.deps.clearSelection();
        this.deps.audio.sfx("sell");
        this.deps.commitUndo();
        return this.deps.clearSelection();
      }
      if (action === "addcar" || action === "removecar") {
        // The engine checks the car limit and the balance and moves the money
        // (a removed car is a sale, so it pays out half back). Only the money
        // refusal speaks: at the car limit or on the last car the button is
        // disabled anyway, and a toast would blame the wrong constraint.
        const res = outcome(engine, engine.changeCars(t.id, action === "addcar"));
        kit.cards.forget();
        if (!res.ok) return res.reason === NOT_ENOUGH_MONEY ? this.refuse(res.reason) : undefined;
        this.deps.audio.sfx(action === "addcar" ? "build" : "click");
        this.deps.refreshEditor();
      } else if (action === "schedule") {
        // Stops, staging, and scheduling share ONE surface (#464): the old
        // stops/express/allstops card actions live inside this dialog now.
        this.openSchedule();
      } else if (action === "extendUp" || action === "extendDown") {
        const up = action === "extendUp";
        const res = outcome(engine, engine.extendShaft(t.id, up, up ? t.top + 1 : t.bottom - 1));
        kit.cards.forget();
        if (!res.ok) {
          // Short of money: refused before anything moved, so no undo step.
          if (res.reason === NOT_ENOUGH_MONEY) return this.refuse(res.reason);
          this.deps.audio.sfx("error");
          if (res.reason) this.deps.ui.toast(res.reason, "bad");
        } else {
          this.deps.audio.sfx("build");
        }
        this.deps.refreshEditor();
      }
    }
    this.deps.commitUndo();
  }

  /** Rename the tower from the top bar. A refused name (longer than the
   *  engine takes) says why, as a refused unit name does. */
  renameTower(name: string): void {
    if (name.length > MAX_TEXT) return this.refuse(INVALID_COMMAND);
    const engine = this.deps.engine();
    const res = outcome(engine, engine.nameTower(name));
    if (!res.ok) this.refuse(res.reason ?? "That name could not be saved.");
  }

  /** An engine refusal on an editor action: error sfx plus the engine's
   *  reason as a toast. Nothing moved, so no undo step is committed. */
  private refuse(reason: string): void {
    this.deps.audio.sfx("error");
    this.deps.ui.toast(reason, "bad");
  }
}
