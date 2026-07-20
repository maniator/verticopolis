import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { BatchTarget, BatchRentOptions, BatchRentResult } from "../../engine/Simulation";
import { FACILITIES, GRID, maxCarsFor } from "../../engine/facilities";
import { ECON, rentOf, resaleRefund } from "../../engine/econConfig";
import type { PriceOptions } from "../../engine/gameRules";
import type { ScheduleDialogCtx } from "../../ui/uiElevatorSchedule";
import type { ElevatorSchedule } from "../../engine/elevatorSchedule";
import type { Transport, Unit } from "../../engine/types";
import type { Picked, TowerEngine } from "../../render/excalibur/TowerEngine";
import type { Tool } from "../../ui/UI";
import { unitEditorTemplate, transportEditorTemplate } from "../../ui/templates/editor";
import { render, type TemplateResult } from "lit-html";
import { SaveGame } from "../../storage/SaveGame";
import type { ExportReport } from "../../storage/tdtExport";
import type { ImportReport } from "../../storage/tdtImport";
import { buildTdt } from "../fixtures/tdtBuilder";
import { BuildActions } from "../../game/buildActions";
import { brushTiles } from "../../ui/placement";
import { EditorActions } from "../../game/editorActions";
import { SaveLoad } from "../../game/saveLoad";
import { InspectorController } from "../../game/inspector";
import { KeyboardPlay } from "../../game/keyboardPlay";

/** Coverage companion to gameControllers.integration.test.ts: the same harness idioms
 *  (recording fakes, fixture placements asserted with .ok, real Simulation)
 *  aimed at the branches that file leaves dark — save/load persistence and
 *  GPU-loss recovery, the editor card's dialogs and extend billing, the
 *  keyboard cursor's transport anchor flow, and the paint-run/bulldoze
 *  gauntlets of the money boundary. */

/** The most recent entry (tsconfig's lib predates Array.prototype.at). */
function last<T>(arr: T[]): T {
  return arr[arr.length - 1];
}

/** An editor template rendered into a detached container: the action tests
 *  hand this to handleEditAction the way production hands it the live card
 *  (the string builders these tests once read retired with the final sweep). */
function renderedCard(tpl: TemplateResult): HTMLElement {
  const div = document.createElement("div");
  render(tpl, div);
  return div;
}

/** Recording fakes for the narrow ui/audio ports the controllers take. */
function fakes() {
  const toasts: { text: string; kind?: "info" | "good" | "bad" | "money" }[] = [];
  const sfx: string[] = [];
  const downloads: { filename: string; contents: string | Uint8Array }[] = [];
  const importReports: { report: ImportReport; open: () => void }[] = [];
  const exportReports: { report: ExportReport; download: () => void }[] = [];
  return {
    toasts,
    sfx,
    downloads,
    importReports,
    exportReports,
    ui: {
      toast: (text: string, kind?: "info" | "good" | "bad" | "money") => {
        toasts.push({ text, kind });
      },
      downloadFile: (filename: string, contents: string | Uint8Array) => {
        downloads.push({ filename, contents });
      },
      showImportReport: (report: ImportReport, cb: { onOpen: () => void }) => {
        importReports.push({ report, open: cb.onOpen });
      },
      showExportReport: (report: ExportReport, cb: { onDownload: () => void }) => {
        exportReports.push({ report, download: cb.onDownload });
      },
    },
    audio: {
      sfx: (name: "build" | "sell" | "error" | "promote" | "money" | "click") => {
        sfx.push(name);
      },
    },
  };
}

/** The editorHtml.test.ts fixture idiom: assert every placement so a silent
 *  fixture failure can't make the assertions below pass for the wrong reason. */
function fixture() {
  const sim = new Simulation();
  for (let x = 10; x < 30; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let x = 10; x < 30; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
  const r = sim.tower.place("office", 2, 12);
  expect(r.ok).toBe(true);
  const office = sim.tower.units.find((u) => u.id === r.unitId)!;
  office.state = "occupied";
  expect(sim.buildTransport("elevatorStandard", 10, 1, 2).ok).toBe(true);
  const lift = sim.tower.transports[sim.tower.transports.length - 1];
  return { sim, office, lift };
}

describe("BuildActions (paint runs, bulldoze gauntlet, transport feedback)", () => {
  let sim: Simulation;
  let office: Unit;
  let lift: Transport;
  let f: ReturnType<typeof fakes>;
  let build: BuildActions;
  let sel: number | null;
  let cleared: number;

  beforeEach(() => {
    ({ sim, office, lift } = fixture());
    f = fakes();
    sel = null;
    cleared = 0;
    build = new BuildActions({
      getSim: () => sim,
      ui: f.ui,
      audio: f.audio,
      selectedId: () => sel,
      clearSelection: () => cleared++,
    });
  });

  it("paintFloorRun drags one continuous run on a floor, resets across floors, and clearPaint drops the anchor", () => {
    // Fresh anchor: a single tile, not a brush strip.
    build.paintFloorRun("floor", 12, 3);
    expect(sim.tower.structureKindAt(3, 12)).toBe("floor");
    expect(sim.tower.structureKindAt(3, 13)).toBeUndefined();
    // Same-floor drag: every cell between the anchor and the pointer fills in.
    build.paintFloorRun("floor", 18, 3);
    for (let x = 13; x <= 18; x++) expect(sim.tower.structureKindAt(3, x)).toBe("floor");
    // Cross-floor move resets the anchor: floor 4 is empty, so the new cursor
    // lays ONE tile (no run dragged over from the floor-3 anchor at column 18,
    // and no bridge, since floor 4 has no other floor to reach yet).
    build.paintFloorRun("floor", 12, 4);
    expect(sim.tower.structureKindAt(4, 12)).toBe("floor");
    for (let x = 13; x <= 17; x++) expect(sim.tower.structureKindAt(4, x)).toBeUndefined();
    // clearPaint (pointer released): the next paint anchors fresh, so it does
    // NOT drag a continuous run back to column 12. It seeds a single tile at the
    // cursor; the gap then fills by the owner-requested floor-tool bridge (the
    // engine auto-floors between the seed and the floor-4 neighbor at 12), which
    // is a separate mechanism from the drag run.
    build.clearPaint();
    build.paintFloorRun("floor", 15, 4);
    expect(sim.tower.structureKindAt(4, 15)).toBe("floor");
    for (let x = 13; x <= 14; x++) expect(sim.tower.structureKindAt(4, x)).toBe("floor");
  });

  it("seedPaint stamps the full brush strip for floor/lobby, so a touch tap matches a desktop click", () => {
    // A touch tap used to seed a single 1-wide tile here while a desktop click
    // laid the whole brush strip, so phones built one brick at a time.
    build.seedPaint("floor", 20, 3);
    for (const x of brushTiles(20)) expect(sim.tower.structureKindAt(3, x)).toBe("floor");
    const strip = brushTiles(20);
    expect(sim.tower.structureKindAt(3, strip[0] - 1)).toBeUndefined();
    expect(sim.tower.structureKindAt(3, last(strip) + 1)).toBeUndefined();
    // The stamp anchors the run: a drag extends from the strip with no gap.
    build.paintFloorRun("floor", last(strip) + 3, 3);
    for (let x = last(strip) + 1; x <= last(strip) + 3; x++) {
      expect(sim.tower.structureKindAt(3, x)).toBe("floor");
    }
    // Lobby taps stamp the same strip (extending the ground lobby sideways).
    // The left boundary can't leak here: every tile left of the stamp is the
    // fixture's pre-built ground lobby, so only the right edge is assertable.
    build.clearPaint();
    const lobbyStrip = brushTiles(32);
    build.seedPaint("lobby", 32, 1);
    for (const x of lobbyStrip) expect(sim.tower.structureKindAt(1, x)).toBe("lobby");
    expect(sim.tower.structureKindAt(1, last(lobbyStrip) + 1)).toBeUndefined();
  });

  it("seedPaint keeps parking's single-module seed and anchors the chain for the drag", () => {
    sim.star = 3; // parking unlocks at 3★
    sim.money = 1e9;
    for (let x = 0; x < 40; x++) sim.tower.place("floor", 0, x); // a basement floor (B1) to build on
    build.seedPaint("parking", 6, 0);
    const seeded = sim.tower.units.filter((u) => u.kind === "parking");
    expect(seeded).toHaveLength(1);
    expect(seeded[0].x).toBe(6); // the seed lands where the tap pointed
    // The seed recorded the run anchor: the drag chains flush from it.
    build.paintFloorRun("parking", 34, 0);
    const w = FACILITIES.parking.width;
    const xs = sim.tower.units
      .filter((u) => u.kind === "parking")
      .map((u) => u.x)
      .sort((a, b) => a - b);
    expect(xs.length).toBeGreaterThan(1);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBe(w);
  });

  it("paintFloorRun chains parking into contiguous spaces (canon drag-to-lay a chain)", () => {
    sim.star = 3; // parking unlocks at 3★
    sim.money = 1e9;
    for (let x = 0; x < 40; x++) sim.tower.place("floor", 0, x); // a basement floor (B1) to build on
    // Drag the parking tool across the floor from x=6.
    build.paintFloorRun("parking", 6, 0);
    build.paintFloorRun("parking", 34, 0);
    const spaces = sim.tower.units.filter((u) => u.kind === "parking");
    expect(spaces.length).toBeGreaterThan(1); // a CHAIN, not one module
    const w = FACILITIES.parking.width;
    const xs = spaces.map((u) => u.x).sort((a, b) => a - b);
    // A true CHAIN: consecutive modules sit flush — exactly one width apart, with
    // no gap (non-contiguous) and no overlap. `=== w` guards both at once.
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBe(w);
  });

  it("a paint tap at the right edge left-shifts to fit (snapX seed), never no-ops off-lot", () => {
    sim.star = 3;
    sim.money = 1e9;
    const W = GRID.width;
    // Ground lobby the basement hangs off, then a full-width basement floor.
    for (let x = 0; x < W; x++) sim.tower.place("lobby", 1, x);
    for (let x = 0; x < W; x++) sim.tower.place("floor", 0, x);
    // A tap at the very last column: a width-4 parking footprint would run off
    // the lot with a raw clamp and silently fail; snapX left-shifts it to fit.
    // Taps commit through seedPaint (the gesture-opening placement).
    build.seedPaint("parking", W - 1, 0);
    const p = sim.tower.units.find((u) => u.kind === "parking");
    expect(p).toBeDefined();
    expect(p!.x + p!.width).toBeLessThanOrEqual(W); // the whole footprint is on-lot
  });

  it("tryBuild toasts the refusal only when loud; quiet drags stay silent", () => {
    sim.money = 0;
    build.tryBuild("floor", 3, 20); // loud (default): error sfx + toast
    expect(f.sfx).toEqual(["error"]);
    expect(f.toasts).toEqual([{ text: "Not enough money.", kind: "bad" }]);
    build.tryBuild("floor", 3, 20, true); // quiet: no extra feedback
    expect(f.sfx).toEqual(["error"]);
    expect(f.toasts).toHaveLength(1);
    sim.money = ECON.startingMoney;
    build.tryBuild("floor", 3, 20); // loud success plays the build sfx
    expect(last(f.sfx)).toBe("build");
    expect(f.toasts).toHaveLength(1);
  });

  it("tryBuildTransport surfaces the build's own failure reason as a toast", () => {
    sim.money = 0;
    const r = build.tryBuildTransport("elevatorStandard", 20, 1, 2);
    expect(r).toEqual({ ok: false, reason: "Not enough money." });
    expect(f.sfx).toEqual(["error"]);
    expect(f.toasts).toEqual([{ text: "Not enough money.", kind: "bad" }]);
  });

  it("transportReason: locked kinds name their star gate; a valid span falls back to the generic line", () => {
    // A 1★ tower asking about the 3★ express gets the unlock line.
    expect(build.transportReason("elevatorExpress", 20, 1, 2)).toBe(
      `${FACILITIES.elevatorExpress.name} unlocks at ${FACILITIES.elevatorExpress.minStar}★.`,
    );
    // validateTransport passes here (clear column, built floors), so the build
    // failed for a reason placement can't diagnose — the generic fallback.
    expect(build.transportReason("elevatorStandard", 20, 1, 2)).toBe(
      "A shaft can't go here. Leave a clear column through built floors.",
    );
  });

  it("bulldozePicked: null and stale picks are no-ops (no sfx, no refund)", () => {
    const before = sim.money;
    build.bulldozePicked(null);
    build.bulldozePicked({ type: "unit", id: 99_999, kind: "office" });
    build.bulldozePicked({ type: "transport", id: 99_999, kind: "elevatorStandard" });
    expect(sim.money).toBe(before);
    expect(f.sfx).toEqual([]);
  });

  it("bulldozePicked on a transport refunds the shaft resale and clears a matching selection", () => {
    sel = lift.id;
    const before = sim.money;
    build.bulldozePicked({ type: "transport", id: lift.id, kind: lift.kind });
    expect(sim.money - before).toBe(resaleRefund("elevatorStandard"));
    expect(sim.tower.transports.some((t) => t.id === lift.id)).toBe(false);
    expect(f.sfx).toEqual(["sell"]);
    expect(cleared).toBe(1);
  });

  it("bulldozePicked on a burning unit refuses — loud toasts, the quiet drag path doesn't", () => {
    office.state = "fire";
    build.bulldozePicked({ type: "unit", id: office.id, kind: "office" }, true); // drag step
    expect(f.toasts).toEqual([]);
    expect(f.sfx).toEqual([]);
    build.bulldozePicked({ type: "unit", id: office.id, kind: "office" }); // deliberate click
    expect(f.sfx).toEqual(["error"]);
    expect(f.toasts).toEqual([
      { text: "You can't bulldoze a burning unit. Call fire rescue or let it burn out.", kind: "bad" },
    ]);
    expect(sim.tower.units.some((u) => u.id === office.id)).toBe(true);
  });

  it("a gutted shell removes but refunds nothing (no salvage value)", () => {
    office.state = "gutted";
    const before = sim.money;
    expect(build.tryRemoveUnit(office, "bulldoze")).toBe(true);
    expect(sim.money).toBe(before);
    expect(sim.tower.units.some((u) => u.id === office.id)).toBe(false);
  });
});

describe("EditorActions (dialogs, extend billing, per-kind buttons)", () => {
  let sim: Simulation;
  let cinema: Unit;
  let office: Unit;
  let condo: Unit;
  let lift: Transport;
  let stairs: Transport;
  let f: ReturnType<typeof fakes>;
  let editor: EditorActions;
  let sel: { type: "unit" | "transport"; id: number } | null;
  let undo: { captures: string[]; commits: number };
  let refreshed: number;
  let announced: string[];
  let root: HTMLElement;
  let batchDlg: {
    ctx: { kind: string; kindLabel: string; options: PriceOptions };
    cb: {
      preview: (target: BatchTarget, opts: BatchRentOptions) => BatchRentResult;
      apply: (target: BatchTarget, opts: BatchRentOptions) => BatchRentResult;
      onApplied: (summary: string) => void;
    };
  } | null;
  let scheduleDlg: {
    ctx: ScheduleDialogCtx;
    cb: { apply: (schedule: ElevatorSchedule) => void };
  } | null;

  /** A richer strip than fixture(): three room floors so the cinema (2 floors,
   *  31 wide — canon), an office, a condo, and elevator/stairs all fit without
   *  overlap (the 8-wide stairs and the elevator must not collide). */
  beforeEach(() => {
    sim = new Simulation();
    for (let x = 5; x < 64; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let fl = 2; fl <= 4; fl++) {
      for (let x = 5; x < 64; x++) expect(sim.tower.place("floor", fl, x).ok).toBe(true);
    }
    const rc = sim.tower.place("cinema", 2, 5); // 31 wide → tiles 5–35
    expect(rc.ok).toBe(true);
    cinema = sim.tower.units.find((u) => u.id === rc.unitId)!;
    const ro = sim.tower.place("office", 2, 38); // clears the wider cinema
    expect(ro.ok).toBe(true);
    office = sim.tower.units.find((u) => u.id === ro.unitId)!;
    office.state = "occupied";
    const rn = sim.tower.place("condo", 4, 5);
    expect(rn.ok).toBe(true);
    condo = sim.tower.units.find((u) => u.id === rn.unitId)!;
    expect(sim.buildTransport("elevatorStandard", 58, 1, 2).ok).toBe(true);
    lift = sim.tower.transports[sim.tower.transports.length - 1];
    expect(sim.buildTransport("stairs", 48, 1, 2).ok).toBe(true); // 8 wide → tiles 48–55, clear of the lift at 58
    stairs = sim.tower.transports[sim.tower.transports.length - 1];

    f = fakes();
    sel = null;
    undo = { captures: [], commits: 0 };
    refreshed = 0;
    announced = [];
    batchDlg = null;
    scheduleDlg = null;
    root = document.createElement("div");
    const build = new BuildActions({
      getSim: () => sim,
      ui: f.ui,
      audio: f.audio,
      selectedId: () => sel?.id ?? null,
      clearSelection: () => (sel = null),
    });
    editor = new EditorActions({
      getSim: () => sim,
      ui: {
        toast: f.ui.toast,
        showBatchPricingDialog: (ctx, cb) => (batchDlg = { ctx, cb }),
        showElevatorScheduleDialog: (ctx, cb) => (scheduleDlg = { ctx, cb }),
      },
      audio: f.audio,
      build,
      selected: () => sel,
      selectedUnit: () => (sel?.type === "unit" ? sim.tower.units.find((x) => x.id === sel!.id) : undefined),
      selectedTransport: () =>
        sel?.type === "transport" ? sim.tower.transports.find((x) => x.id === sel!.id) : undefined,
      clearSelection: () => (sel = null),
      refreshEditor: () => refreshed++,
      captureUndo: (label) => undo.captures.push(label),
      commitUndo: () => undo.commits++,
      announce: (msg) => announced.push(msg),
    });
  });

  it("handleEditAction without a selection is a no-op (no undo capture)", () => {
    editor.handleEditAction("sell", root);
    expect(undo.captures).toEqual([]);
    expect(undo.commits).toBe(0);
  });

  it("a stale selection (entity already removed) clears itself", () => {
    sel = { type: "unit", id: 99_999 };
    editor.handleEditAction("rename", root);
    expect(sel).toBeNull();
    sel = { type: "transport", id: 99_999 };
    editor.handleEditAction("addcar", root);
    expect(sel).toBeNull();
  });

  it("sell on a burning unit refuses: the unit survives and the undo step never commits", () => {
    office.state = "fire";
    sel = { type: "unit", id: office.id };
    render(unitEditorTemplate(sim, office), root);
    editor.handleEditAction("sell", root);
    expect(sim.tower.units.some((u) => u.id === office.id)).toBe(true);
    expect(undo.captures).toEqual(["Sell"]);
    expect(undo.commits).toBe(0);
    expect(f.toasts[0].text).toContain("burning");
  });

  it("rename takes #ed-name's trimmed value and falls back to the facility name when blank", () => {
    sel = { type: "unit", id: office.id };
    render(unitEditorTemplate(sim, office), root);
    const input = root.querySelector<HTMLInputElement>("#ed-name")!;
    input.value = "  Corner Office  ";
    editor.handleEditAction("rename", root);
    expect(office.label).toBe("Corner Office");
    input.value = "   ";
    editor.handleEditAction("rename", root);
    expect(office.label).toBe(FACILITIES.office.name);
    expect(f.sfx).toContain("click");
  });

  it("a sold condo can't be repriced: rent nudges are silent no-ops", () => {
    condo.everOccupied = true; // sold — the engine's priceUnit returns null
    sel = { type: "unit", id: condo.id };
    render(unitEditorTemplate(sim, condo), root);
    const before = rentOf(condo);
    editor.handleEditAction("rentDown", root);
    expect(rentOf(condo)).toBe(before);
    expect(f.sfx).not.toContain("click"); // no feedback for a refused nudge
  });

  it("filmPolicy cycles auto → feature → blockbuster → auto on a cinema", () => {
    sel = { type: "unit", id: cinema.id };
    render(unitEditorTemplate(sim, cinema), root);
    editor.handleEditAction("filmPolicy", root);
    expect(cinema.filmPolicy).toBe("feature");
    editor.handleEditAction("filmPolicy", root);
    expect(cinema.filmPolicy).toBe("blockbuster");
    editor.handleEditAction("filmPolicy", root);
    expect(cinema.filmPolicy).toBe("auto");
    expect(f.sfx).toEqual(["click", "click", "click"]);
  });

  it("the rung action applies the picked rung through the choke point and announces the pinned string", () => {
    sel = { type: "unit", id: office.id };
    render(unitEditorTemplate(sim, office), root);
    const select = root.querySelector<HTMLSelectElement>("#ed-rung")!;
    expect(select).not.toBeNull();
    select.value = "1"; // Low
    editor.handleEditAction("rung", root);
    expect(rentOf(office)).toBe(5_000);
    expect(last(announced)).toBe("Rent set to Low ($5,000).");
    expect(last(f.sfx)).toBe("click");
    expect(undo.captures).toContain("Rent change");
    expect(refreshed).toBeGreaterThan(0);
  });

  it("the rung action's No Rate entry takes the unit off the market and announces the off-market string", () => {
    sel = { type: "unit", id: office.id };
    render(unitEditorTemplate(sim, office), root);
    const select = root.querySelector<HTMLSelectElement>("#ed-rung")!;
    select.value = "noRate";
    editor.handleEditAction("rung", root);
    expect(office.noRate).toBe(true);
    expect(office.state).toBe("occupied"); // never evicts
    expect(rentOf(office)).toBe(0);
    expect(last(announced)).toBe("No Rate: off the market. Charges nothing; no one moves in.");
    // Picking a rung afterwards returns it to the market.
    render(unitEditorTemplate(sim, office), root);
    root.querySelector<HTMLSelectElement>("#ed-rung")!.value = "3";
    editor.handleEditAction("rung", root);
    expect(office.noRate).toBeUndefined();
    expect(rentOf(office)).toBe(15_000);
    expect(last(announced)).toBe("Rent set to High ($15,000).");
  });

  it("the rung action announces condo and hotel phrasing per the copy inventory", () => {
    sel = { type: "unit", id: condo.id };
    render(unitEditorTemplate(sim, condo), root);
    root.querySelector<HTMLSelectElement>("#ed-rung")!.value = "0";
    editor.handleEditAction("rung", root);
    expect(rentOf(condo)).toBe(50_000); // the canon firesale floor, below build cost
    expect(last(announced)).toBe("Sale price set to Very Low ($50,000).");
  });

  it("batchKind opens the batch-pricing dialog wired to the engine's preview/apply, with undo around apply", () => {
    sel = { type: "unit", id: office.id };
    render(unitEditorTemplate(sim, office), root);
    editor.handleEditAction("batchKind", root);
    expect(batchDlg).not.toBeNull();
    // A default Simulation is Classic, so the dialog is handed the ladder shape.
    const options = sim.rules.priceOptions("office")!;
    expect(batchDlg!.ctx).toEqual({ kind: "office", kindLabel: FACILITIES.office.name, options });
    expect(options.shape).toBe("ladder");
    const high = 15_000; // the Classic High rung
    // Preview is pure: it reports without touching the tower.
    const before = rentOf(office);
    const p = batchDlg!.cb.preview(high, {});
    expect(p.matched).toBe(1);
    expect(rentOf(office)).toBe(before);
    // Apply commits exactly what preview showed, inside its own undo step.
    undo = { captures: [], commits: 0 };
    const a = batchDlg!.cb.apply(high, {});
    expect(a.changed).toBe(1);
    expect(rentOf(office)).toBe(high);
    expect(undo.captures).toEqual(["Set prices"]);
    expect(undo.commits).toBe(1);
    // onApplied fans out to sfx, toast, announcer, and the editor refresh.
    batchDlg!.cb.onApplied("1 office repriced");
    expect(last(f.sfx)).toBe("build");
    expect(last(f.toasts)).toEqual({ text: "1 office repriced", kind: "good" });
    expect(last(announced)).toBe("1 office repriced");
    expect(refreshed).toBeGreaterThan(0);
  });

  it("batchKind on a kind without a rent band does nothing", () => {
    sel = { type: "unit", id: cinema.id };
    render(unitEditorTemplate(sim, cinema), root);
    editor.handleEditAction("batchKind", root);
    expect(batchDlg).toBeNull();
  });

  it("schedule opens the elevator-schedule dialog wired to setSchedule, with undo around apply", () => {
    lift.cars = 4;
    sel = { type: "transport", id: lift.id };
    render(transportEditorTemplate(sim, lift), root);
    editor.handleEditAction("schedule", root);
    expect(scheduleDlg).not.toBeNull();
    // The dialog is handed the shaft's live geometry and the mode UX flags.
    expect(scheduleDlg!.ctx.cars).toBe(4);
    expect(scheduleDlg!.ctx.isExpress).toBe(false);
    expect(scheduleDlg!.ctx.ux).toEqual(sim.rules.elevatorScheduleUX());
    expect(lift.schedule).toBeUndefined();
    // Apply writes the authored schedule through one undoable setSchedule.
    undo = { captures: [], commits: 0 };
    scheduleDlg!.cb.apply({
      activeCars: { weekday: Array(24).fill(2), weekend: Array(24).fill(1) },
      waitingCarResponse: 6,
      standardFloorDeparture: 40,
      homeFloors: [1, 1, 2, 2],
    });
    expect(lift.schedule).toBeDefined();
    expect(lift.schedule!.activeCars?.weekday?.[9]).toBe(2);
    expect(lift.schedule!.waitingCarResponse).toBe(6);
    expect(undo.captures).toEqual(["Set elevator schedule"]);
    expect(undo.commits).toBe(1);
    expect(last(f.sfx)).toBe("build");
    expect(last(announced)).toBe("Elevator schedule saved.");
    expect(refreshed).toBeGreaterThan(0);
  });

  it("schedule on a non-elevator transport (stairs) does nothing", () => {
    sel = { type: "transport", id: stairs.id };
    render(transportEditorTemplate(sim, stairs), root);
    editor.handleEditAction("schedule", root);
    expect(scheduleDlg).toBeNull();
  });

  it("addcar refuses at the car cap (before any money talk) and when broke", () => {
    sel = { type: "transport", id: lift.id };
    render(transportEditorTemplate(sim, lift), root);
    lift.cars = maxCarsFor(lift.kind);
    const before = sim.money;
    editor.handleEditAction("addcar", root);
    expect(lift.cars).toBe(maxCarsFor(lift.kind));
    expect(sim.money).toBe(before);
    expect(f.toasts).toEqual([]); // cap refusal is silent — the button is disabled anyway
    lift.cars = 1;
    sim.money = 0;
    editor.handleEditAction("addcar", root);
    expect(lift.cars).toBe(1);
    expect(f.toasts).toEqual([{ text: "Not enough money.", kind: "bad" }]);
  });

  it("the folded-in bulk stop actions: express skips non-lobby middles, allstops restores them (#464)", () => {
    expect(sim.tower.resizeTransport(lift.id, 1, 4).ok).toBe(true);
    sel = { type: "transport", id: lift.id };
    editor.openSchedule();
    const stops = scheduleDlg!.ctx.stops;
    stops.expressStops();
    expect(lift.skipFloors).toEqual([2, 3]); // endpoints always stop; 2–3 aren't lobbies
    expect(sim.tower.stopsAt(lift, 2)).toBe(false);
    stops.allStops();
    expect(lift.skipFloors).toEqual([]);
    expect(sim.tower.stopsAt(lift, 2)).toBe(true);
    expect(undo.commits).toBe(2);
  });

  it("an express is locked to lobbies: the engine refuses a non-lobby stop and clearStops stays lobby-only", () => {
    const r = sim.tower.placeTransport("elevatorExpress", 10, 1, 4);
    expect(r.ok).toBe(true);
    const ex = sim.tower.transports.find((t) => t.id === r.transportId)!;
    // Seeded lobby-only on placement: floors 1 & 4 are endpoints, 2 & 3 are
    // non-lobby middles and start skipped.
    expect(ex.skipFloors).toEqual([2, 3]);
    // The engine lock refuses turning a non-lobby middle into a stop.
    expect(sim.tower.setStop(ex.id, 2, true)).toBe(false);
    expect(sim.tower.stopsAt(ex, 2)).toBe(false);
    // clearStops on an express restores the lobby-only skip list, NOT all floors.
    expect(sim.tower.clearStops(ex.id)).toBe(true);
    expect(ex.skipFloors).toEqual([2, 3]);
  });

  it("a forged non-lobby express stop is coerced back to lobby-only on load", () => {
    const r = sim.tower.placeTransport("elevatorExpress", 10, 1, 4);
    expect(r.ok).toBe(true);
    const data = sim.serialize();
    // Forge the save so the express stops at every floor (empty skip list): the
    // import path writes skipFloors directly, bypassing setStop.
    const forged = data.transports.find((t) => t.id === r.transportId)!;
    forged.skipFloors = [];
    const loaded = Simulation.deserialize(data);
    const ex = loaded.tower.transports.find((t) => t.kind === "elevatorExpress")!;
    // The trust-boundary coercion re-skips the non-lobby middles after load.
    expect(ex.skipFloors).toEqual([2, 3]);
  });

  it("coercion scrubs a forged endpoint out of an express skip list (endpoints always stop)", () => {
    const r = sim.tower.placeTransport("elevatorExpress", 10, 1, 4);
    expect(r.ok).toBe(true);
    const data = sim.serialize();
    // Forge the top endpoint (floor 4) into the skip list: a shaft must never
    // skip its own endpoint. Coercion removes it and still skips the non-lobby
    // middles.
    data.transports.find((t) => t.id === r.transportId)!.skipFloors = [4];
    const ex = Simulation.deserialize(data).tower.transports.find((t) => t.kind === "elevatorExpress")!;
    expect(ex.skipFloors).toEqual([2, 3]);
  });

  it("no card carries stop-config buttons anymore: Schedule… is the one config surface (#464)", () => {
    const r = sim.tower.placeTransport("elevatorExpress", 10, 1, 4);
    expect(r.ok).toBe(true);
    const ex = sim.tower.transports.find((t) => t.id === r.transportId)!;
    for (const t of [ex, lift]) {
      const card = renderedCard(transportEditorTemplate(sim, t));
      expect(card.querySelector('[data-edit="stops"]')).toBeNull();
      expect(card.querySelector('[data-edit="express"]')).toBeNull();
      expect(card.querySelector('[data-edit="allstops"]')).toBeNull();
      expect(card.querySelector('[data-edit="schedule"]')).not.toBeNull();
    }
    // The express card's fixed policy caption survives on its Stops row.
    expect(renderedCard(transportEditorTemplate(sim, ex)).textContent).toContain("lobbies and sky lobbies");
  });

  it("the express Stops readout reports a deliberately skipped (sky) lobby honestly", () => {
    // A legacy/forged save may skip an interior sky lobby (coerceExpressStops
    // preserves it), so the readout must not overstate "lobbies and sky lobbies".
    const s = new Simulation();
    for (let x = 40; x < 52; x++) expect(s.tower.place("lobby", 1, x).ok).toBe(true);
    // Build bottom-up. Floor 15 is the sky lobby (no plain floor tiles there, per
    // sky-lobby canon), and it must be laid before floor 16 so 16 has support.
    for (let fl = 2; fl <= 14; fl++) for (let x = 40; x < 52; x++) expect(s.tower.place("floor", fl, x).ok).toBe(true);
    for (let x = 40; x < 52; x++) expect(s.tower.place("lobby", 15, x).ok).toBe(true); // interior sky lobby
    for (let fl = 16; fl <= 30; fl++) for (let x = 40; x < 52; x++) expect(s.tower.place("floor", fl, x).ok).toBe(true);
    const r = s.tower.placeTransport("elevatorExpress", 42, 1, 30);
    expect(r.ok).toBe(true);
    const ex = s.tower.transports.find((t) => t.id === r.transportId)!;
    expect(renderedCard(transportEditorTemplate(s, ex)).textContent).toContain("lobbies and sky lobbies");
    expect(s.tower.setStop(ex.id, 15, false)).toBe(true); // skip the interior sky lobby
    expect(renderedCard(transportEditorTemplate(s, ex)).textContent).toContain("lobbies and sky lobbies (1 skipped)");
  });

  it("the schedule dialog's stops port lists floors top-down and each toggle is its own undo-bracketed setStop (#464)", () => {
    expect(sim.tower.resizeTransport(lift.id, 1, 4).ok).toBe(true);
    sel = { type: "transport", id: lift.id };
    editor.openSchedule();
    const stops = scheduleDlg!.ctx.stops;
    expect(stops.read().map((fl) => fl.floor)).toEqual([4, 3, 2, 1]);
    expect(stops.read().every((fl) => fl.served)).toBe(true);
    expect(stops.read().find((fl) => fl.floor === 1)!.lobby).toBe(true);
    stops.setServe(3, false);
    expect(sim.tower.stopsAt(lift, 3)).toBe(false);
    expect(stops.read().find((fl) => fl.floor === 3)!.served).toBe(false);
    expect(undo.captures).toEqual(["Elevator stops"]);
    expect(undo.commits).toBe(1);
    expect(refreshed).toBeGreaterThan(0);
    stops.setServe(3, true);
    expect(sim.tower.stopsAt(lift, 3)).toBe(true);
    // The folded-in bulk actions ride the same undo bracket.
    stops.expressStops();
    expect(sim.tower.stopsAt(lift, 3)).toBe(false); // 3 is no lobby
    stops.allStops();
    expect(sim.tower.stopsAt(lift, 3)).toBe(true);
    expect(undo.captures.every((c) => c === "Elevator stops")).toBe(true);
  });

  it("the stops port goes inert when the shaft vanishes mid-dialog (undo past its construction)", () => {
    sel = { type: "transport", id: lift.id };
    editor.openSchedule();
    const stops = scheduleDlg!.ctx.stops;
    sim.tower.removeTransport(lift.id);
    expect(stops.read()).toEqual([]);
    const before = undo.captures.length;
    stops.setServe(1, false); // silent no-op: no undo step, no crash
    stops.expressStops();
    stops.allStops();
    expect(undo.captures.length).toBe(before);
  });

  it("extendUp bills a floor when it fits and auto-lays the floor behind it in open sky", () => {
    sel = { type: "transport", id: lift.id };
    render(transportEditorTemplate(sim, lift), root);
    const before = sim.money;
    editor.handleEditAction("extendUp", root); // floor 3 is built → grows
    expect(lift.top).toBe(3);
    expect(before - sim.money).toBe(ECON.transportFloorCost);
    expect(last(f.sfx)).toBe("build");
    editor.handleEditAction("extendUp", root); // floor 4 built too
    expect(lift.top).toBe(4);
    // Floor 5 is open sky: the extend now brings the floor with it (it rests on
    // floor 4), still billing the single extend cost, and lays plain floor
    // across the shaft's 4-tile footprint at 58..61.
    const mid = sim.money;
    editor.handleEditAction("extendUp", root);
    expect(lift.top).toBe(5);
    expect(mid - sim.money).toBe(ECON.transportFloorCost);
    expect(last(f.sfx)).toBe("build");
    for (let i = 0; i < 4; i++) expect(sim.tower.structureKindAt(5, 58 + i)).toBe("floor");
  });

  it("extendUp toasts the engine's reason when another shaft blocks the column", () => {
    // A second short shaft stacked in the lift's column at floors 3..4 blocks
    // the extend: the editor surfaces the engine's refusal as an error toast.
    expect(sim.buildTransport("elevatorStandard", 58, 3, 4).ok).toBe(true);
    sel = { type: "transport", id: lift.id };
    render(transportEditorTemplate(sim, lift), root);
    editor.handleEditAction("extendUp", root); // floor 3 is occupied by the other shaft
    expect(lift.top).toBe(2); // unchanged
    expect(last(f.sfx)).toBe("error");
    expect(last(f.toasts)).toEqual({ text: "Transport shafts cannot overlap.", kind: "bad" });
  });

  it("extendSelectedTo bills only floors past the drag's high-water mark; wiggles re-bill nothing", () => {
    sel = { type: "transport", id: lift.id };
    const before = sim.money;
    editor.extendSelectedTo("up", 4); // 1..2 → 1..4: two new floors billed
    expect(lift.top).toBe(4);
    expect(before - sim.money).toBe(2 * ECON.transportFloorCost);
    expect(last(f.sfx)).toBe("build");
    editor.extendSelectedTo("up", 3); // shrink back is free…
    expect(lift.top).toBe(3);
    expect(before - sim.money).toBe(2 * ECON.transportFloorCost);
    expect(last(f.sfx)).toBe("click");
    editor.extendSelectedTo("up", 4); // …and regrowing within the hwm re-bills nothing
    expect(lift.top).toBe(4);
    expect(before - sim.money).toBe(2 * ECON.transportFloorCost);
    editor.extendSelectedTo("up", 4); // no change at all: silent early return
    const sfxCount = f.sfx.length;
    expect(f.sfx.length).toBe(sfxCount);
    expect(undo.captures).toEqual(["Extend"]); // ONE capture for the whole drag
    // endExtend closes the gesture: the next drag re-captures. Floor 5 is open
    // sky, but the extend now auto-lays the floor behind it (rests on floor 4),
    // so the shaft grows to 5 and bills the one new floor past the fresh hwm.
    editor.endExtend();
    editor.extendSelectedTo("up", 5);
    expect(lift.top).toBe(5);
    expect(before - sim.money).toBe(3 * ECON.transportFloorCost);
    expect(undo.captures).toEqual(["Extend", "Extend"]);
    for (let i = 0; i < 4; i++) expect(sim.tower.structureKindAt(5, 58 + i)).toBe("floor");
  });

  it("extendSelectedTo guards: no selection, a unit, and a stairway (no extend handles) all bail", () => {
    editor.extendSelectedTo("up", 4);
    sel = { type: "unit", id: office.id };
    editor.extendSelectedTo("up", 4);
    sel = { type: "transport", id: stairs.id };
    editor.extendSelectedTo("up", 4);
    expect(stairs.top).toBe(2);
    expect(undo.captures).toEqual([]); // no gesture ever started
  });
});

describe("SaveLoad (persistence, update flush, GPU-loss recovery)", () => {
  let sim: Simulation;
  let f: ReturnType<typeof fakes>;
  let adopted: Simulation[];
  let crashScreens: {
    crash: { kind: string; repeat: boolean; saveFlushed: boolean; behindSplash: boolean; recoveryFailed: boolean };
    save: { flushed: boolean; behindSplash: boolean; storageBlame: boolean; hadPriorSave: boolean };
    onReload: () => void;
  }[];
  let armed: number;
  /** Pending in-place recovery attempts: each entry is the outcome callback
   *  SaveLoad handed over; a test settles it with true/false to simulate the
   *  rebuild succeeding or failing. */
  let recoveries: ((recovered: boolean) => void)[];
  let saveLoad: SaveLoad;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.getElementById("splash")?.remove();
    sim = new Simulation();
    f = fakes();
    adopted = [];
    crashScreens = [];
    armed = 0;
    recoveries = [];
    saveLoad = new SaveLoad({
      getSim: () => sim,
      getView: () => null,
      adoptSim: (s) => {
        adopted.push(s);
      },
      ui: f.ui,
      showCrashScreen: (info) => crashScreens.push(info),
      attemptGraphicsRecovery: (done) => recoveries.push(done),
      armOnboarding: () => armed++,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.getElementById("splash")?.remove();
  });

  /** The test DOM's location.reload is a navigation no-op, so swap the global
   *  for a minimal recording stand-in. The module reads the bare `location`
   *  binding, which resolves to globalThis in the vitest DOM environment —
   *  window.location itself is non-configurable, so stubbing the global is the
   *  least invasive seam. */
  function stubReload() {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload } as unknown as Location);
    return reload;
  }

  it("save writes the autosave slot and toasts; silent mode saves without feedback", () => {
    saveLoad.save();
    expect(SaveGame.hasSave()).toBe(true);
    // Trailing time is locale-formatted, so match the stable prefix + a leading digit.
    expect(f.toasts).toHaveLength(1);
    expect(f.toasts[0].kind).toBe("good");
    expect(f.toasts[0].text).toMatch(/^Saved ✓ · \d/);
    localStorage.clear();
    saveLoad.save(true);
    expect(SaveGame.hasSave()).toBe(true);
    expect(f.toasts).toHaveLength(1); // no second toast
  });

  it("routine autosave uses the async path and coalesces to the latest tower", async () => {
    let releaseFirst!: () => void;
    const savedMoney: number[] = [];
    const spy = vi.spyOn(SaveGame, "saveAsync").mockImplementation(async (s) => {
      savedMoney.push(s.money);
      if (savedMoney.length === 1) await new Promise<void>((resolve) => (releaseFirst = resolve));
    });
    try {
      sim.money = 100;
      const first = saveLoad.autosave();
      await vi.waitFor(() => expect(savedMoney).toEqual([100]));

      sim.money = 200;
      const second = saveLoad.autosave();
      expect(savedMoney).toEqual([100]);

      releaseFirst();
      await first;
      await second;
      expect(savedMoney).toEqual([100, 200]);
      expect(f.toasts).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("load adopts the saved tower; with nothing saved it only toasts", () => {
    saveLoad.load();
    expect(adopted).toHaveLength(0);
    expect(f.toasts).toEqual([{ text: "No saved tower found.", kind: "bad" }]);
    sim.money = 123_456;
    SaveGame.save(sim);
    saveLoad.load();
    expect(adopted).toHaveLength(1);
    expect(adopted[0]).toBeInstanceOf(Simulation);
    expect(adopted[0].money).toBe(123_456); // round-tripped through localStorage
    expect(last(f.toasts)).toEqual({ text: "Tower loaded.", kind: "good" });
  });

  it("saveBeforeUpdate behind the first-run splash saves nothing (the boot sim is throwaway)", () => {
    const splash = document.createElement("div");
    splash.id = "splash";
    document.body.appendChild(splash);
    saveLoad.saveBeforeUpdate();
    expect(SaveGame.hasSave()).toBe(false);
    expect(f.toasts).toEqual([]);
  });

  it("saveBeforeUpdate in play flushes the autosave silently (the modal already told the player)", () => {
    saveLoad.saveBeforeUpdate();
    expect(SaveGame.hasSave()).toBe(true);
    expect(f.toasts).toEqual([]);
  });

  it("exportGame downloads a .vctower file named after the tower and toasts the size", async () => {
    sim.tower.towerName = "Vertic Opolis";
    // Freeze the clock (Date explicitly: the byte-identity below depends on
    // both exports stamping the same savedAt, not on timer behavior).
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await saveLoad.exportGame();
      expect(f.downloads).toHaveLength(1);
      expect(f.downloads[0].filename).toBe("vertic-opolis.vctower");
      // The controller's contract is "download exactly what SaveGame.export
      // produces"; the container format itself is pinned by storage.test.ts.
      expect(f.downloads[0].contents).toBe(await SaveGame.export(sim));
    } finally {
      vi.useRealTimers();
    }
    expect(f.toasts).toHaveLength(1);
    expect(f.toasts[0].kind).toBe("good");
    expect(f.toasts[0].text).toMatch(/^Tower exported \(\d+\.\d KB\)\. Check your downloads\.$/);
  });

  it("exportGame toasts the failure instead of swallowing it (main.ts fires it with `void`)", async () => {
    // Simulate a browser that can't compress: SaveGame.export rejects, and the
    // controller must surface that as a toast, not download nothing in silence.
    const spy = vi.spyOn(SaveGame, "export").mockRejectedValueOnce(new Error("This browser is too old to create tower files. Try a current browser."));
    await saveLoad.exportGame();
    expect(f.downloads).toHaveLength(0);
    expect(f.toasts).toEqual([
      { text: "Export failed: This browser is too old to create tower files. Try a current browser.", kind: "bad" },
    ]);
    spy.mockRestore();
  });

  it("importGame adopts a Simulation from a SaveGame.export round-trip", async () => {
    sim.money = 777_777;
    await saveLoad.importGame(await SaveGame.export(sim));
    expect(adopted).toHaveLength(1);
    expect(adopted[0]).toBeInstanceOf(Simulation);
    expect(adopted[0].money).toBe(777_777);
    expect(f.toasts).toEqual([{ text: "Tower imported.", kind: "good" }]);
  });

  it("exportLegacy: the reverse fidelity report shows first; nothing downloads until the primary", () => {
    sim.money = 1_234_567;
    saveLoad.exportLegacy();
    expect(f.downloads).toHaveLength(0); // two-step contract
    expect(f.exportReports).toHaveLength(1);
    const { report, download } = f.exportReports[0];
    expect(report.money).toBe(1_234_600); // $100-quantized, said up front
    expect(report.filename).toMatch(/^[A-Z0-9]{1,8}\.TDT$/);
    download();
    expect(f.downloads).toHaveLength(1);
    expect(f.downloads[0].filename).toBe(report.filename);
    const bytes = f.downloads[0].contents as Uint8Array;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes[0]).toBe(0x00); // TDT magic 0x2400 little-endian
    expect(bytes[1]).toBe(0x24);
  });

  it("exportLegacy: a Modern tower is refused with the rules message, nothing shown or downloaded", () => {
    saveLoad.newGame("modern");
    sim = adopted[0];
    f.toasts.length = 0;
    saveLoad.exportLegacy();
    expect(f.exportReports).toHaveLength(0);
    expect(f.downloads).toHaveLength(0);
    expect(f.toasts).toEqual([
      { text: "This tower uses Modern rules. SimTower (1994) can only load Classic towers.", kind: "bad" },
    ]);
  });

  it("importLegacy: a garbage buffer toasts a typed message and never reaches the sim", () => {
    saveLoad.importLegacy(new ArrayBuffer(4), "tiny.TDT");
    expect(adopted).toHaveLength(0);
    expect(f.importReports).toHaveLength(0);
    expect(f.toasts).toEqual([{ text: "This file is too small to be a SimTower save.", kind: "bad" }]);
  });

  it("importLegacy: a valid .TDT shows the fidelity report first; nothing adopted until Open", () => {
    const bytes = buildTdt({ balance: 12345, level: 3 });
    saveLoad.importLegacy(bytes.buffer as ArrayBuffer, "LEGACY.TDT");
    expect(adopted).toHaveLength(0); // report up, tower not adopted yet
    expect(f.toasts).toEqual([]);
    expect(f.importReports).toHaveLength(1);
    const { report, open } = f.importReports[0];
    expect(report.towerName).toBe("LEGACY");
    expect(report.money).toBe(1_234_500);
    expect(report.star).toBe(3);

    // Confirming adopts the tower, flushes the OLD tower to the autosave, and
    // copies the import to the first free manual slot.
    sim.money = 777; // make the pre-import tower recognizable
    open();
    expect(adopted).toHaveLength(1);
    expect(adopted[0]).toBeInstanceOf(Simulation);
    expect(adopted[0].money).toBe(1_234_500);
    expect(SaveGame.load()!.money).toBe(777); // current tower kept safe
    expect(SaveGame.loadSlot(1)!.money).toBe(1_234_500); // fresh-slot copy
    expect(last(f.toasts)).toEqual({ text: "Tower imported and saved to slot 1.", kind: "good" });
  });

  it("importLegacy: a corrupt-but-present slot is NOT treated as free (raw presence wins)", () => {
    // A slot whose payload no longer parses may still be recoverable by a
    // later build; the import's fresh-slot copy must skip it, not reuse it.
    localStorage.setItem("simtower-clone-slot-1", "VCZ1:not-really-deflate");
    saveLoad.importLegacy(buildTdt().buffer as ArrayBuffer, "CAREFUL.TDT");
    f.importReports[0].open();
    expect(localStorage.getItem("simtower-clone-slot-1")).toBe("VCZ1:not-really-deflate");
    expect(SaveGame.loadSlot(2)).not.toBeNull(); // landed on the next raw-free slot
    expect(last(f.toasts).text).toBe("Tower imported and saved to slot 2.");
  });

  it("importLegacy: with every slot full, nothing is overwritten and the toast says so", () => {
    for (let n = 1; n <= 3; n++) SaveGame.saveSlot(n, sim);
    const before = [1, 2, 3].map((n) => localStorage.getItem(`simtower-clone-slot-${n}`));
    saveLoad.importLegacy(buildTdt().buffer as ArrayBuffer, "FULL.TDT");
    f.importReports[0].open();
    expect(adopted).toHaveLength(1);
    expect([1, 2, 3].map((n) => localStorage.getItem(`simtower-clone-slot-${n}`))).toEqual(before);
    expect(last(f.toasts).text).toMatch(/All save slots are full/);
  });

  it("first mid-game context loss: autosave written, then in-place recovery is attempted (no crash screen)", () => {
    const reload = stubReload();
    saveLoad.recoverFromContextLoss();
    expect(SaveGame.hasSave()).toBe(true); // no splash → the tower was flushed first
    // The healthy one-off case recovers in place: no crash screen, no reload,
    // just the "recovering" toast while the rebuild waits on the browser.
    expect(crashScreens).toHaveLength(0);
    expect(recoveries).toHaveLength(1);
    expect(reload).not.toHaveBeenCalled();
    expect(last(f.toasts)).toEqual({ text: "The device reset the game's graphics. Recovering...", kind: "info" });
    // The loss itself is stamped, so a second loss inside 90s reads as a
    // repeat even when no reload ever happens.
    expect(Number(sessionStorage.getItem("vc-gl-lost-reload"))).toBeGreaterThan(0);

    // The rebuild succeeds: the player gets a confirmation toast and a durable
    // bulletin entry (the old silent reload erased all evidence of the crash).
    recoveries[0](true);
    expect(crashScreens).toHaveLength(0);
    expect(last(f.toasts)).toEqual({ text: "Graphics recovered. Your tower was saved.", kind: "good" });
    expect(sim.log.some((e) => e.text.includes("recovered on the spot"))).toBe(true);
  });

  it("a failed in-place recovery falls back to the crash screen; reload stays the player's choice", () => {
    const reload = stubReload();
    saveLoad.recoverFromContextLoss();
    expect(recoveries).toHaveLength(1);
    recoveries[0](false);
    expect(crashScreens).toHaveLength(1);
    // recoveryFailed rides along so the screen can add the device-distress
    // advice even though repeat is false (crashScreen.test pins the wording).
    expect(crashScreens[0].crash).toEqual({
      kind: "webgl-context-lost",
      repeat: false,
      saveFlushed: true,
      behindSplash: false,
      recoveryFailed: true,
    });
    expect(crashScreens[0].save).toEqual({ flushed: true, behindSplash: false, storageBlame: false, hadPriorSave: false });
    // No silent auto-reload: the reload (and its session stamps) is the
    // player's Reload button.
    expect(reload).not.toHaveBeenCalled();
    crashScreens[0].onReload();
    expect(Number(sessionStorage.getItem("vc-gl-lost-reload"))).toBeGreaterThan(0);
    // The recovery resume flag is stamped so the fresh boot drops the player back
    // into their tower instead of showing the title screen (see resolveBootScreen).
    expect(Number(sessionStorage.getItem("vc-resume-after-recovery"))).toBeGreaterThan(0);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a second loss within 90s of the last one is a repeat: crash screen immediately, no recovery attempt", () => {
    stubReload();
    sessionStorage.setItem("vc-gl-lost-reload", String(Date.now()));
    saveLoad.recoverFromContextLoss();
    expect(recoveries).toHaveLength(0); // the device is struggling; don't loop
    expect(crashScreens).toHaveLength(1);
    expect(crashScreens[0].crash.repeat).toBe(true);
    expect(SaveGame.hasSave()).toBe(true); // the tower is still saved first
  });

  it("a loss soon after a successful in-place recovery is a repeat (the loss stamp, not a reload, anchors the window)", () => {
    stubReload();
    saveLoad.recoverFromContextLoss();
    recoveries[0](true); // first loss recovered in place, no reload anywhere
    saveLoad.recoverFromContextLoss();
    expect(recoveries).toHaveLength(1); // no second attempt
    expect(crashScreens).toHaveLength(1);
    expect(crashScreens[0].crash.repeat).toBe(true);
    // The screen followed a repeat gate, never a recovery attempt.
    expect(crashScreens[0].crash.recoveryFailed).toBe(false);
  });

  it("a loss more than 90s after the previous one leaves the repeat window: recovery is attempted again", () => {
    stubReload();
    sessionStorage.setItem("vc-gl-lost-reload", String(Date.now() - 91_000));
    saveLoad.recoverFromContextLoss();
    expect(crashScreens).toHaveLength(0);
    expect(recoveries).toHaveLength(1); // treated as a fresh first loss
  });

  it("the repeat window re-anchors when the recovery COMPLETES, so a slow background restore doesn't defeat it", () => {
    stubReload();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(1_000_000);
      saveLoad.recoverFromContextLoss(); // loss stamped at T0
      // Android restores the context ten minutes later (backgrounded gap).
      vi.setSystemTime(1_000_000 + 10 * 60_000);
      recoveries[0](true);
      // A fresh loss 30s into resumed play is genuine distress: repeat.
      vi.setSystemTime(1_000_000 + 10 * 60_000 + 30_000);
      saveLoad.recoverFromContextLoss();
      expect(recoveries).toHaveLength(1); // no second silent attempt
      expect(crashScreens).toHaveLength(1);
      expect(crashScreens[0].crash.repeat).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("with sessionStorage unavailable the in-memory shadow still trips the repeat guard (no endless recover loop)", () => {
    stubReload();
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    } as unknown as Storage);
    saveLoad.recoverFromContextLoss(); // first loss: recovery attempted
    expect(recoveries).toHaveLength(1);
    recoveries[0](true);
    saveLoad.recoverFromContextLoss(); // seconds later: must escalate
    expect(recoveries).toHaveLength(1);
    expect(crashScreens).toHaveLength(1);
    expect(crashScreens[0].crash.repeat).toBe(true);
  });

  it("a recovery that resolves under an already-open crash screen stays quiet (no contradictory success toast)", () => {
    stubReload();
    saveLoad.recoverFromContextLoss();
    // A parallel loss flow put the crash card up while the rebuild ran.
    const card = document.createElement("dialog");
    card.id = "crash-screen";
    document.body.appendChild(card);
    try {
      const toastCount = f.toasts.length;
      recoveries[0](true);
      expect(f.toasts.length).toBe(toastCount); // the screen owns the session
      expect(sim.log.some((e) => e.text.includes("recovered on the spot"))).toBe(false);
    } finally {
      card.remove();
    }
  });

  it("a tower swap during the recovery wait keeps the saved-tower claim out of the new tower's bulletin", () => {
    stubReload();
    const simAtLoss = sim;
    saveLoad.recoverFromContextLoss();
    sim = new Simulation(); // player loaded/founded a different tower while waiting
    recoveries[0](true);
    // Generic toast only: "your tower was saved" would be about the old tower.
    expect(last(f.toasts)).toEqual({ text: "Graphics recovered.", kind: "good" });
    expect(sim.log.some((e) => e.text.includes("recovered on the spot"))).toBe(false);
    expect(simAtLoss.log.some((e) => e.text.includes("recovered on the spot"))).toBe(false);
  });

  it("a context loss whose save fails says so on the screen, keeps the prior tower, and blames storage", () => {
    const reload = stubReload();
    // A prior autosave exists (the tower was flushed before the crash).
    sim.money = 555_000;
    SaveGame.save(sim);
    // Now the GPU dies AND storage is full: the pre-crash flush throws. Left
    // unhandled this would escape the onContextLost handler and skip the crash
    // screen. Instead the screen must show, and the prior tower must survive.
    const spy = vi.spyOn(SaveGame, "save").mockImplementationOnce(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    saveLoad.recoverFromContextLoss();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    // A failed flush is storage news the player must see: no silent in-place
    // recovery, straight to the screen that words the failure.
    expect(recoveries).toHaveLength(0);
    expect(crashScreens).toHaveLength(1);
    // A prior autosave exists, so the screen reassures the player it's safe
    // (don't imply total loss and send them off to clear the very save that
    // survived).
    expect(crashScreens[0].save).toEqual({ flushed: false, behindSplash: false, storageBlame: true, hadPriorSave: true });
    expect(crashScreens[0].crash.saveFlushed).toBe(false);
    // A failed setItem never clobbers — the prior tower is still loadable.
    expect(SaveGame.load()?.money).toBe(555_000);
    spy.mockRestore();
  });

  it("a context-loss with storage fully disabled (save AND hasSave throw) still shows the screen", () => {
    // Storage disabled (SecurityError), not merely full: BOTH the write and the
    // hasSave() read throw. The catch must not re-throw before the screen shows.
    const saveSpy = vi.spyOn(SaveGame, "save").mockImplementationOnce(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    const hasSaveSpy = vi.spyOn(SaveGame, "hasSave").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    expect(() => saveLoad.recoverFromContextLoss()).not.toThrow();
    expect(crashScreens).toHaveLength(1);
    // Storage is unreadable, so no false "your last saved tower is safe" claim.
    expect(crashScreens[0].save).toEqual({ flushed: false, behindSplash: false, storageBlame: true, hadPriorSave: false });
    saveSpy.mockRestore();
    hasSaveSpy.mockRestore();
  });

  it("a first-session context-loss save failure (no prior save) makes no false safety claim", () => {
    // No prior autosave (crash before the 30s timer fired) AND storage is full.
    const spy = vi.spyOn(SaveGame, "save").mockImplementationOnce(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    saveLoad.recoverFromContextLoss();
    expect(crashScreens).toHaveLength(1);
    // Must NOT claim a saved tower is safe when there is none.
    expect(crashScreens[0].save.hadPriorSave).toBe(false);
    spy.mockRestore();
  });

  it("saveBeforeUpdate propagates a storage failure so the update flow pauses instead of reloading", () => {
    // The update path in main.ts wraps saveBeforeUpdate in try/catch and, on a
    // throw, pauses the update rather than reloading (which would cost progress).
    // That contract lives here: a failed flush must surface as a throw.
    const spy = vi.spyOn(SaveGame, "save").mockImplementationOnce(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    expect(() => saveLoad.saveBeforeUpdate()).toThrow();
    spy.mockRestore();
  });

  it("a non-storage save error (e.g. a serialize/compression bug) is not blamed on storage", () => {
    sim.money = 111_000;
    SaveGame.save(sim); // a prior autosave exists
    // A non-storage failure (not a quota/security DOMException) must not be
    // misdiagnosed as "storage full" and send the player to free up space.
    const spy = vi.spyOn(SaveGame, "save").mockImplementationOnce(() => {
      throw new TypeError("Converting circular structure to JSON");
    });
    saveLoad.recoverFromContextLoss();
    expect(crashScreens).toHaveLength(1);
    // The prior tower is still safe, so still reassure.
    expect(crashScreens[0].save).toEqual({ flushed: false, behindSplash: false, storageBlame: false, hadPriorSave: true });
    spy.mockRestore();
  });

  it("a context loss behind the splash shows the screen without persisting the boot sim", () => {
    const splash = document.createElement("div");
    splash.id = "splash";
    document.body.appendChild(splash);
    saveLoad.recoverFromContextLoss();
    expect(SaveGame.hasSave()).toBe(false);
    // No session to preserve behind the splash, so no in-place recovery.
    expect(recoveries).toHaveLength(0);
    expect(crashScreens).toHaveLength(1);
    // Nothing needed flushing (the splash pauses the sim); the screen words
    // this case separately instead of claiming a tower was saved.
    expect(crashScreens[0].save.flushed).toBe(true);
    expect(crashScreens[0].save.behindSplash).toBe(true);
  });
});

describe("InspectorController (stale-pick hygiene)", () => {
  it("a pick whose entity has been removed hides the card instead of rendering a ghost", () => {
    const { sim, office, lift } = fixture();
    // Only the null (hide) calls matter here, so record the raw values; the
    // card itself is a lit template since E6-S2.
    const shown: unknown[] = [];
    let anchor: { x: number; floor: number } | null = null;
    const inspector = new InspectorController({
      getSim: () => sim,
      ui: { showInspector: (tpl) => shown.push(tpl) },
      setAnchor: (a) => (anchor = a),
    });
    sim.tower.removeUnit(office.id);
    inspector.inspectPicked({ type: "unit", id: office.id, kind: "office" });
    expect(last(shown)).toBeNull();
    expect(anchor).toBeNull();
    sim.tower.removeTransport(lift.id);
    inspector.inspectPicked({ type: "transport", id: lift.id, kind: "elevatorStandard" });
    expect(last(shown)).toBeNull();
    expect(anchor).toBeNull();
  });
});

describe("KeyboardPlay (cursor bounds, transport anchor flow, previews)", () => {
  const mid = Math.floor(GRID.width / 2);
  let sim: Simulation;
  let announced: string[];
  let tool: Tool;
  let keyboard: KeyboardPlay;
  let f: ReturnType<typeof fakes>;
  let office: Unit;
  let engine: { ensureVisible: () => void; preview: TowerEngine["preview"]; transportPreview: TowerEngine["transportPreview"] };
  let previewCalls: { tile: number; floor: number }[];
  let selections: (Picked | null)[];
  let undoLog: string[];

  beforeEach(() => {
    sim = new Simulation();
    for (let x = mid - 15; x < mid + 15; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let x = mid - 15; x < mid + 15; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
    const r = sim.tower.place("office", 2, mid - 10);
    expect(r.ok).toBe(true);
    office = sim.tower.units.find((u) => u.id === r.unitId)!;
    announced = [];
    tool = { type: "inspect" };
    f = fakes();
    previewCalls = [];
    selections = [];
    undoLog = [];
    engine = { ensureVisible: () => {}, preview: null, transportPreview: null };
    const build = new BuildActions({
      getSim: () => sim,
      ui: f.ui,
      audio: f.audio,
      selectedId: () => null,
      clearSelection: () => {},
    });
    const isTransportTool = () => tool.type === "build" && !!FACILITIES[tool.kind].transport;
    // Mirrors GameApp.pickedAt — the injected picker contract.
    const pickedAt = (floor: number, tile: number): Picked | null => {
      const u = sim.tower.unitAt(floor, tile);
      if (u && u.kind !== "floor" && u.kind !== "lobby") return { type: "unit", id: u.id, kind: u.kind };
      const t = sim.tower.transports.find(
        (tr) => tile >= tr.x && tile < tr.x + FACILITIES[tr.kind].width && floor >= tr.bottom && floor <= tr.top,
      );
      return t ? { type: "transport", id: t.id, kind: t.kind } : null;
    };
    keyboard = new KeyboardPlay({
      getSim: () => sim,
      engine: () => engine,
      audio: f.audio,
      ui: f.ui,
      build,
      tool: () => tool,
      isTransportTool,
      announce: (msg) => announced.push(msg),
      pickedAt,
      selectPicked: (p) => selections.push(p),
      // Transports (other than fixed-span flights) fall through to the
      // two-press anchor flow, exactly like GameApp's placeSimpleBuild.
      placeSimpleBuild: () => null,
      updateBuildPreview: (tile, floor) => previewCalls.push({ tile, floor }),
      captureUndo: (label) => undoLog.push(`capture:${label}`),
      commitUndo: () => undoLog.push("commit"),
    });
  });

  it("the cursor clamps at all four grid bounds and reads basements as B-floors", () => {
    expect(keyboard.cursor()).toBeNull(); // not revealed yet
    keyboard.moveCursor(-100_000, 0);
    expect(keyboard.cursor()).toEqual({ tile: 0, floor: 1 });
    expect(last(announced)).toBe("Cursor: floor 1, column 0. Empty.");
    keyboard.moveCursor(100_000, 0);
    expect(keyboard.cursor()).toEqual({ tile: GRID.width - 1, floor: 1 });
    keyboard.moveCursor(0, -100_000);
    expect(keyboard.cursor()).toEqual({ tile: GRID.width - 1, floor: GRID.minFloor });
    expect(last(announced)).toBe(`Cursor: basement ${1 - GRID.minFloor}, column ${GRID.width - 1}. Empty.`);
    keyboard.moveCursor(0, 100_000);
    expect(keyboard.cursor()).toEqual({ tile: GRID.width - 1, floor: GRID.maxFloor });
    expect(last(announced)).toBe(`Cursor: floor ${GRID.maxFloor}, column ${GRID.width - 1}. Empty.`);
  });

  it("the first Enter with no cursor just reveals it (no select, no build)", () => {
    keyboard.commitCursor();
    expect(keyboard.cursor()).toEqual({ tile: mid, floor: 1 });
    expect(selections).toEqual([]);
    expect(last(announced)).toMatch(/^Cursor: floor 1/);
  });

  it("inspect commit announces the selection — or the honest nothing", () => {
    keyboard.moveCursor(0, 0); // (mid, 1)
    keyboard.moveCursor(-5, 1); // (mid-5, 2) — inside the office (mid-10 .. mid-2)
    keyboard.commitCursor();
    expect(last(announced)).toBe(`Selected ${FACILITIES.office.name}`);
    expect(last(selections)).toEqual({ type: "unit", id: office.id, kind: "office" });
    keyboard.moveCursor(10, 0); // (mid+5, 2) — bare floor strip
    keyboard.commitCursor();
    expect(last(announced)).toBe("Nothing to inspect here");
    expect(last(selections)).toBeNull();
  });

  it("elevator two-press flow: first Enter anchors and announces, second builds the span", () => {
    tool = { type: "build", kind: "elevatorStandard" };
    keyboard.moveCursor(0, 0); // (mid, 1)
    keyboard.commitCursor(); // anchor
    expect(last(announced)).toBe(
      `${FACILITIES.elevatorStandard.name} anchored at floor 1. Move to the other end and press Enter.`,
    );
    expect(sim.tower.transports).toHaveLength(0);
    // With an anchor pending, moving shows the live shaft preview (and clears
    // the room ghost) instead of asking GameApp for a build preview.
    keyboard.moveCursor(0, 1); // (mid, 2)
    expect(engine.transportPreview).toEqual({
      kind: "elevatorStandard",
      x: mid,
      bottom: 1,
      top: 2,
      valid: true,
    });
    expect(engine.preview).toBeNull();
    keyboard.commitCursor(); // build floors 1..2
    expect(sim.tower.transports).toHaveLength(1);
    expect(last(f.sfx)).toBe("build");
    expect(last(announced)).toBe(`${FACILITIES.elevatorStandard.name} built, floors 1 to 2`);
    expect(engine.transportPreview).toBeNull();
    // Both presses bracket undo like any other gesture.
    expect(undoLog).toEqual([
      "capture:Build Standard Elevator",
      "commit",
      "capture:Build Standard Elevator",
      "commit",
    ]);
  });

  it("resetAnchor drops a pending anchor: the next Enter re-anchors instead of building", () => {
    tool = { type: "build", kind: "elevatorStandard" };
    keyboard.moveCursor(0, 0);
    keyboard.commitCursor(); // anchor at floor 1
    keyboard.resetAnchor(); // Escape / tool switch
    keyboard.moveCursor(0, 1);
    // No anchor → the move delegates to the shared build preview (clearing the
    // stale shaft ghost is that callback's job in GameApp).
    expect(last(previewCalls)).toEqual({ tile: mid, floor: 2 });
    keyboard.commitCursor();
    expect(sim.tower.transports).toHaveLength(0); // re-anchored, didn't build
    expect(last(announced)).toContain("anchored at floor 2");
  });

  it("a failed transport build plays the error sfx, toasts, and announces the reason", () => {
    tool = { type: "build", kind: "elevatorStandard" };
    keyboard.moveCursor(0, 0);
    keyboard.commitCursor(); // anchor
    sim.money = 0; // broke before the second press
    keyboard.moveCursor(0, 1);
    keyboard.commitCursor();
    expect(sim.tower.transports).toHaveLength(0);
    expect(last(f.sfx)).toBe("error");
    expect(last(f.toasts)).toEqual({ text: "Not enough money.", kind: "bad" });
    expect(last(announced)).toBe("Not enough money.");
    expect(engine.transportPreview).toBeNull(); // the anchor is spent either way
  });

  it("bulldozing the cursor over a transport removes it with a refund and announces it", () => {
    expect(sim.buildTransport("elevatorStandard", mid, 1, 2).ok).toBe(true);
    tool = { type: "bulldoze" };
    const before = sim.money;
    keyboard.moveCursor(0, 0); // (mid, 1) — inside the shaft
    keyboard.commitCursor();
    expect(sim.tower.transports).toHaveLength(0);
    expect(sim.money - before).toBe(resaleRefund("elevatorStandard"));
    expect(last(announced)).toBe(`Bulldozed ${FACILITIES.elevatorStandard.name}`);
    expect(undoLog.slice(-2)).toEqual(["capture:Bulldoze", "commit"]);
  });

  it("bulldozeCursor and refreshCursorPreview are no-ops before the cursor is revealed", () => {
    keyboard.bulldozeCursor();
    expect(announced).toEqual([]);
    keyboard.refreshCursorPreview();
    expect(previewCalls).toEqual([]);
  });

  it("without a pending anchor the cursor delegates its preview to the shared build preview", () => {
    tool = { type: "build", kind: "office" };
    keyboard.moveCursor(0, 0);
    keyboard.moveCursor(0, 1);
    expect(last(previewCalls)).toEqual({ tile: mid, floor: 2 });
    expect(engine.transportPreview).toBeNull();
  });
});
