import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import type { BatchTarget, BatchRentOptions, BatchRentResult } from "../engine/Simulation";
import { FACILITIES, GRID, maxCarsFor } from "../engine/facilities";
import { ECON, rentConfig, rentOf, resaleRefund } from "../engine/econConfig";
import type { Transport, Unit } from "../engine/types";
import type { Picked, TowerEngine } from "../render/excalibur/TowerEngine";
import type { Tool } from "../ui/UI";
import { unitEditorHtml, transportEditorHtml } from "../ui/editorHtml";
import { SaveGame } from "../storage/SaveGame";
import { BuildActions } from "../game/buildActions";
import { EditorActions } from "../game/editorActions";
import { SaveLoad } from "../game/saveLoad";
import { InspectorController } from "../game/inspector";
import { KeyboardPlay } from "../game/keyboardPlay";

/** Coverage companion to gameControllers.test.ts: the same harness idioms
 *  (recording fakes, fixture placements asserted with .ok, real Simulation)
 *  aimed at the branches that file leaves dark — save/load persistence and
 *  GPU-loss recovery, the editor card's dialogs and extend billing, the
 *  keyboard cursor's transport anchor flow, and the paint-run/bulldoze
 *  gauntlets of the money boundary. */

/** The most recent entry (tsconfig's lib predates Array.prototype.at). */
function last<T>(arr: T[]): T {
  return arr[arr.length - 1];
}

/** Recording fakes for the narrow ui/audio ports the controllers take. */
function fakes() {
  const toasts: { text: string; kind?: "info" | "good" | "bad" | "money" }[] = [];
  const sfx: string[] = [];
  const downloads: { filename: string; contents: string }[] = [];
  return {
    toasts,
    sfx,
    downloads,
    ui: {
      toast: (text: string, kind?: "info" | "good" | "bad" | "money") => {
        toasts.push({ text, kind });
      },
      downloadFile: (filename: string, contents: string) => {
        downloads.push({ filename, contents });
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
    // Cross-floor move resets the anchor: floor 4 gets ONE tile at the new
    // cursor, not a run dragged over from the floor-3 anchor at column 18.
    build.paintFloorRun("floor", 12, 4);
    expect(sim.tower.structureKindAt(4, 12)).toBe("floor");
    for (let x = 13; x <= 17; x++) expect(sim.tower.structureKindAt(4, x)).toBeUndefined();
    // clearPaint (pointer released): the next paint anchors fresh instead of
    // filling the gap back to column 12.
    build.clearPaint();
    build.paintFloorRun("floor", 15, 4);
    expect(sim.tower.structureKindAt(4, 15)).toBe("floor");
    expect(sim.tower.structureKindAt(4, 13)).toBeUndefined();
    expect(sim.tower.structureKindAt(4, 14)).toBeUndefined();
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
      "A shaft can't go here — leave a clear column through built floors.",
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
      { text: "You can't bulldoze a burning unit — call fire rescue or let it burn out.", kind: "bad" },
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
  let stopsDlg: {
    title: string;
    floors: { floor: number; stop: boolean; lobby: boolean }[];
    onToggle: (floor: number, stop: boolean) => void;
  } | null;
  let batchDlg: {
    ctx: { kind: string; kindLabel: string; band: { default: number; min: number; max: number; step: number } };
    cb: {
      preview: (target: BatchTarget, opts: BatchRentOptions) => BatchRentResult;
      apply: (target: BatchTarget, opts: BatchRentOptions) => BatchRentResult;
      onApplied: (summary: string) => void;
    };
  } | null;

  /** A richer strip than fixture(): three room floors so the cinema (2 floors,
   *  24 wide), a condo, and elevator extends up to floor 4 all fit. */
  beforeEach(() => {
    sim = new Simulation();
    for (let x = 5; x < 45; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let fl = 2; fl <= 4; fl++) {
      for (let x = 5; x < 45; x++) expect(sim.tower.place("floor", fl, x).ok).toBe(true);
    }
    const rc = sim.tower.place("cinema", 2, 5);
    expect(rc.ok).toBe(true);
    cinema = sim.tower.units.find((u) => u.id === rc.unitId)!;
    const ro = sim.tower.place("office", 2, 30);
    expect(ro.ok).toBe(true);
    office = sim.tower.units.find((u) => u.id === ro.unitId)!;
    office.state = "occupied";
    const rn = sim.tower.place("condo", 4, 5);
    expect(rn.ok).toBe(true);
    condo = sim.tower.units.find((u) => u.id === rn.unitId)!;
    expect(sim.buildTransport("elevatorStandard", 40, 1, 2).ok).toBe(true);
    lift = sim.tower.transports[sim.tower.transports.length - 1];
    expect(sim.buildTransport("stairs", 34, 1, 2).ok).toBe(true);
    stairs = sim.tower.transports[sim.tower.transports.length - 1];

    f = fakes();
    sel = null;
    undo = { captures: [], commits: 0 };
    refreshed = 0;
    announced = [];
    stopsDlg = null;
    batchDlg = null;
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
        showStopsDialog: (title, floors, onToggle) => (stopsDlg = { title, floors, onToggle }),
        showBatchPricingDialog: (ctx, cb) => (batchDlg = { ctx, cb }),
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
    root.innerHTML = unitEditorHtml(sim, office);
    editor.handleEditAction("sell", root);
    expect(sim.tower.units.some((u) => u.id === office.id)).toBe(true);
    expect(undo.captures).toEqual(["Sell"]);
    expect(undo.commits).toBe(0);
    expect(f.toasts[0].text).toContain("burning");
  });

  it("rename takes #ed-name's trimmed value and falls back to the facility name when blank", () => {
    sel = { type: "unit", id: office.id };
    root.innerHTML = unitEditorHtml(sim, office);
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
    root.innerHTML = unitEditorHtml(sim, condo);
    const before = rentOf(condo);
    editor.handleEditAction("rentDown", root);
    expect(rentOf(condo)).toBe(before);
    expect(f.sfx).not.toContain("click"); // no feedback for a refused nudge
  });

  it("filmPolicy cycles auto → feature → blockbuster → auto on a cinema", () => {
    sel = { type: "unit", id: cinema.id };
    root.innerHTML = unitEditorHtml(sim, cinema);
    editor.handleEditAction("filmPolicy", root);
    expect(cinema.filmPolicy).toBe("feature");
    editor.handleEditAction("filmPolicy", root);
    expect(cinema.filmPolicy).toBe("blockbuster");
    editor.handleEditAction("filmPolicy", root);
    expect(cinema.filmPolicy).toBe("auto");
    expect(f.sfx).toEqual(["click", "click", "click"]);
  });

  it("batchKind opens the batch-pricing dialog wired to the engine's preview/apply, with undo around apply", () => {
    sel = { type: "unit", id: office.id };
    root.innerHTML = unitEditorHtml(sim, office);
    editor.handleEditAction("batchKind", root);
    expect(batchDlg).not.toBeNull();
    const band = rentConfig("office")!;
    expect(batchDlg!.ctx).toEqual({ kind: "office", kindLabel: FACILITIES.office.name, band });
    // Preview is pure: it reports without touching the tower.
    const before = rentOf(office);
    const p = batchDlg!.cb.preview(band.max, {});
    expect(p.matched).toBe(1);
    expect(rentOf(office)).toBe(before);
    // Apply commits exactly what preview showed, inside its own undo step.
    undo = { captures: [], commits: 0 };
    const a = batchDlg!.cb.apply(band.max, {});
    expect(a.changed).toBe(1);
    expect(rentOf(office)).toBe(band.max);
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
    root.innerHTML = unitEditorHtml(sim, cinema);
    editor.handleEditAction("batchKind", root);
    expect(batchDlg).toBeNull();
  });

  it("addcar refuses at the car cap (before any money talk) and when broke", () => {
    sel = { type: "transport", id: lift.id };
    root.innerHTML = transportEditorHtml(sim, lift);
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

  it("stops/express/allstops: express skips non-lobby middles, allstops restores them", () => {
    expect(sim.tower.resizeTransport(lift.id, 1, 4).ok).toBe(true);
    sel = { type: "transport", id: lift.id };
    root.innerHTML = transportEditorHtml(sim, lift);
    editor.handleEditAction("express", root);
    expect(lift.skipFloors).toEqual([2, 3]); // endpoints always stop; 2–3 aren't lobbies
    expect(sim.tower.stopsAt(lift, 2)).toBe(false);
    editor.handleEditAction("allstops", root);
    expect(lift.skipFloors).toEqual([]);
    expect(sim.tower.stopsAt(lift, 2)).toBe(true);
    // "stops" opens the per-floor dialog.
    editor.handleEditAction("stops", root);
    expect(stopsDlg).not.toBeNull();
    expect(undo.commits).toBe(3);
  });

  it("openStopsDialog lists floors top-down and each toggle is its own undo-bracketed setStop", () => {
    expect(sim.tower.resizeTransport(lift.id, 1, 4).ok).toBe(true);
    sel = { type: "transport", id: lift.id };
    editor.openStopsDialog();
    expect(stopsDlg!.title).toBe(FACILITIES.elevatorStandard.name);
    expect(stopsDlg!.floors.map((fl) => fl.floor)).toEqual([4, 3, 2, 1]);
    expect(stopsDlg!.floors.every((fl) => fl.stop)).toBe(true);
    expect(stopsDlg!.floors.find((fl) => fl.floor === 1)!.lobby).toBe(true);
    stopsDlg!.onToggle(3, false);
    expect(sim.tower.stopsAt(lift, 3)).toBe(false);
    expect(undo.captures).toEqual(["Elevator stops"]);
    expect(undo.commits).toBe(1);
    expect(refreshed).toBe(1);
    stopsDlg!.onToggle(3, true);
    expect(sim.tower.stopsAt(lift, 3)).toBe(true);
  });

  it("openStopsDialog guards: no selection, a unit selection, and a stale shaft all bail", () => {
    editor.openStopsDialog();
    sel = { type: "unit", id: office.id };
    editor.openStopsDialog();
    sim.tower.removeTransport(lift.id);
    sel = { type: "transport", id: lift.id };
    editor.openStopsDialog();
    expect(stopsDlg).toBeNull();
  });

  it("extendUp bills one floor when it fits and toasts the engine's reason when it can't", () => {
    sel = { type: "transport", id: lift.id };
    root.innerHTML = transportEditorHtml(sim, lift);
    const before = sim.money;
    editor.handleEditAction("extendUp", root); // floor 3 is built → grows
    expect(lift.top).toBe(3);
    expect(before - sim.money).toBe(ECON.transportFloorCost);
    expect(last(f.sfx)).toBe("build");
    editor.handleEditAction("extendUp", root); // floor 4 built too
    expect(lift.top).toBe(4);
    editor.handleEditAction("extendUp", root); // floor 5 is open sky → refused
    expect(lift.top).toBe(4);
    expect(last(f.sfx)).toBe("error");
    expect(last(f.toasts)).toEqual({
      text: "Transport must run through built floors — lay floors first.",
      kind: "bad",
    });
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
    // endExtend closes the gesture: the next drag re-captures, and a blocked
    // step (floor 5 is open sky) is silent — the shaft simply stops growing.
    editor.endExtend();
    editor.extendSelectedTo("up", 5);
    expect(lift.top).toBe(4);
    expect(before - sim.money).toBe(2 * ECON.transportFloorCost);
    expect(undo.captures).toEqual(["Extend", "Extend"]);
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
  let bootMessages: { msg: string; withReload?: boolean }[];
  let armed: number;
  let saveLoad: SaveLoad;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.getElementById("splash")?.remove();
    sim = new Simulation();
    f = fakes();
    adopted = [];
    bootMessages = [];
    armed = 0;
    saveLoad = new SaveLoad({
      getSim: () => sim,
      adoptSim: (s) => {
        adopted.push(s);
      },
      ui: f.ui,
      showBootMessage: (msg, withReload) => bootMessages.push({ msg, withReload }),
      armOnboarding: () => armed++,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.getElementById("splash")?.remove();
  });

  /** jsdom's location.reload is "not implemented" (navigation), so swap the
   *  global for a minimal recording stand-in. The module reads the bare
   *  `location` binding, which resolves to globalThis in the vitest jsdom
   *  environment — window.location itself is non-configurable, so stubbing
   *  the global is the least invasive seam. */
  function stubReload() {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload } as unknown as Location);
    return reload;
  }

  it("save writes the autosave slot and toasts; silent mode saves without feedback", () => {
    saveLoad.save();
    expect(SaveGame.hasSave()).toBe(true);
    expect(f.toasts).toEqual([{ text: "Tower saved.", kind: "good" }]);
    localStorage.clear();
    saveLoad.save(true);
    expect(SaveGame.hasSave()).toBe(true);
    expect(f.toasts).toHaveLength(1); // no second toast
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
    await saveLoad.exportGame();
    expect(f.downloads).toHaveLength(1);
    expect(f.downloads[0].filename).toBe("vertic-opolis.vctower");
    // The controller's contract is "download exactly what SaveGame.export
    // produces" — the container format itself is pinned by storage.test.ts.
    expect(f.downloads[0].contents).toBe(await SaveGame.export(sim));
    expect(f.toasts).toHaveLength(1);
    expect(f.toasts[0].kind).toBe("good");
    expect(f.toasts[0].text).toMatch(/^Tower exported \(\d+\.\d KB\) — check your downloads\.$/);
  });

  it("exportGame toasts the failure instead of swallowing it (main.ts fires it with `void`)", async () => {
    // Simulate a browser that can't compress: SaveGame.export rejects, and the
    // controller must surface that as a toast, not download nothing in silence.
    const spy = vi.spyOn(SaveGame, "export").mockRejectedValueOnce(new Error("This browser is too old to create tower files — try a current browser."));
    await saveLoad.exportGame();
    expect(f.downloads).toHaveLength(0);
    expect(f.toasts).toEqual([
      { text: "Export failed: This browser is too old to create tower files — try a current browser.", kind: "bad" },
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

  it("importLegacy never reaches the sim: the .TWR decoder is a planned feature", () => {
    // Garbage that can't even be a .TWR header.
    saveLoad.importLegacy(new ArrayBuffer(4), "tiny.TWR");
    expect(adopted).toHaveLength(0);
    expect(f.toasts).toEqual([
      { text: "This file is too small to be a SimTower .TWR save.", kind: "info" },
    ]);
    // A plausible legacy file is recognized but politely declined for now.
    saveLoad.importLegacy(new ArrayBuffer(64), "tower.TWR");
    expect(adopted).toHaveLength(0);
    expect(last(f.toasts).kind).toBe("info");
    expect(last(f.toasts).text).toContain("planned");
  });

  it("first context loss: autosave written, reload stamped in sessionStorage, page reloaded", () => {
    const reload = stubReload();
    saveLoad.recoverFromContextLoss();
    expect(SaveGame.hasSave()).toBe(true); // no splash → the tower was flushed
    expect(Number(sessionStorage.getItem("vc-gl-lost-reload"))).toBeGreaterThan(0);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(bootMessages).toEqual([]); // no manual card on the first loss
  });

  it("second loss within 90s falls back to the manual boot card — no reload loop", () => {
    const reload = stubReload();
    sessionStorage.setItem("vc-gl-lost-reload", String(Date.now()));
    saveLoad.recoverFromContextLoss();
    expect(reload).not.toHaveBeenCalled();
    expect(bootMessages).toHaveLength(1);
    expect(bootMessages[0].msg).toContain("crashed twice");
    expect(bootMessages[0].withReload).toBe(true);
    expect(SaveGame.hasSave()).toBe(true); // the tower is still saved first
  });

  it("a context loss whose save fails shows a card, keeps the prior tower, and does not reload", () => {
    const reload = stubReload();
    // A prior autosave exists (the tower was flushed before the crash).
    sim.money = 555_000;
    SaveGame.save(sim);
    // Now the GPU dies AND storage is full: the pre-reload flush throws. Left
    // unhandled this would abort the reload and strand the player on a dead
    // canvas — instead we want a card, and the prior tower must survive.
    const spy = vi.spyOn(SaveGame, "save").mockImplementationOnce(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    saveLoad.recoverFromContextLoss();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled(); // did not silently reload past unsaved work
    expect(bootMessages).toHaveLength(1);
    expect(bootMessages[0].withReload).toBe(true);
    expect(bootMessages[0].msg).toContain("couldn't be saved");
    // A prior autosave exists, so the card reassures the player it's safe (don't
    // imply total loss and send them off to clear the very save that survived).
    expect(bootMessages[0].msg).toContain("last saved tower is safe");
    // A failed setItem never clobbers — the prior tower is still loadable.
    expect(SaveGame.load()?.money).toBe(555_000);
    spy.mockRestore();
  });

  it("a context-loss with storage fully disabled (save AND hasSave throw) still shows the card and does not re-abort the reload", () => {
    const reload = stubReload();
    // Storage disabled (SecurityError), not merely full: BOTH the write and the
    // hasSave() read throw. The catch must not re-throw before showing the card.
    const saveSpy = vi.spyOn(SaveGame, "save").mockImplementationOnce(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    const hasSaveSpy = vi.spyOn(SaveGame, "hasSave").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    expect(() => saveLoad.recoverFromContextLoss()).not.toThrow();
    expect(reload).not.toHaveBeenCalled();
    expect(bootMessages).toHaveLength(1);
    expect(bootMessages[0].withReload).toBe(true);
    expect(bootMessages[0].msg).not.toContain("last saved tower is safe");
    saveSpy.mockRestore();
    hasSaveSpy.mockRestore();
  });

  it("a first-session context-loss save failure (no prior save) shows the card without a false safety claim", () => {
    const reload = stubReload();
    // No prior autosave (crash before the 30s timer fired) AND storage is full.
    const spy = vi.spyOn(SaveGame, "save").mockImplementationOnce(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    saveLoad.recoverFromContextLoss();
    expect(reload).not.toHaveBeenCalled();
    expect(bootMessages).toHaveLength(1);
    expect(bootMessages[0].withReload).toBe(true);
    // Must NOT claim a saved tower is safe when there is none.
    expect(bootMessages[0].msg).not.toContain("last saved tower is safe");
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

  it("a non-storage save error (e.g. a serialize/compression bug) shows a neutral card, not misleading storage advice", () => {
    const reload = stubReload();
    sim.money = 111_000;
    SaveGame.save(sim); // a prior autosave exists
    // A non-storage failure (not a quota/security DOMException) must not be
    // misdiagnosed as "storage full" and send the player to free up space.
    const spy = vi.spyOn(SaveGame, "save").mockImplementationOnce(() => {
      throw new TypeError("Converting circular structure to JSON");
    });
    saveLoad.recoverFromContextLoss();
    expect(reload).not.toHaveBeenCalled();
    expect(bootMessages).toHaveLength(1);
    expect(bootMessages[0].withReload).toBe(true);
    expect(bootMessages[0].msg).not.toContain("storage is full or blocked");
    expect(bootMessages[0].msg).not.toContain("Free up space");
    // The prior tower is still safe, so still reassure.
    expect(bootMessages[0].msg).toContain("last saved tower is safe");
    spy.mockRestore();
  });

  it("a context loss behind the splash reloads without persisting the boot sim", () => {
    const reload = stubReload();
    const splash = document.createElement("div");
    splash.id = "splash";
    document.body.appendChild(splash);
    saveLoad.recoverFromContextLoss();
    expect(SaveGame.hasSave()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a hidden tab defers the reload until it becomes visible again", () => {
    const reload = stubReload();
    let visibility: DocumentVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    try {
      saveLoad.recoverFromContextLoss();
      expect(reload).not.toHaveBeenCalled(); // parked on visibilitychange
      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      expect(reload).toHaveBeenCalledTimes(1);
      expect(Number(sessionStorage.getItem("vc-gl-lost-reload"))).toBeGreaterThan(0);
      // The one-shot listener removed itself: another flip doesn't re-reload.
      document.dispatchEvent(new Event("visibilitychange"));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState;
    }
  });
});

describe("InspectorController (stale-pick hygiene)", () => {
  it("a pick whose entity has been removed hides the card instead of rendering a ghost", () => {
    const { sim, office, lift } = fixture();
    const shown: (string | null)[] = [];
    let anchor: { x: number; floor: number } | null = null;
    const inspector = new InspectorController({
      getSim: () => sim,
      ui: { showInspector: (html) => shown.push(html) },
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
      engine,
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
    expect(last(announced)).toBe("Cursor: floor 1, column 0 — empty");
    keyboard.moveCursor(100_000, 0);
    expect(keyboard.cursor()).toEqual({ tile: GRID.width - 1, floor: 1 });
    keyboard.moveCursor(0, -100_000);
    expect(keyboard.cursor()).toEqual({ tile: GRID.width - 1, floor: GRID.minFloor });
    expect(last(announced)).toBe(`Cursor: basement ${1 - GRID.minFloor}, column ${GRID.width - 1} — empty`);
    keyboard.moveCursor(0, 100_000);
    expect(keyboard.cursor()).toEqual({ tile: GRID.width - 1, floor: GRID.maxFloor });
    expect(last(announced)).toBe(`Cursor: floor ${GRID.maxFloor}, column ${GRID.width - 1} — empty`);
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
