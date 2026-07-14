import { describe, expect, it, beforeEach } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { FACILITIES, GRID, isFixedSpanTransport } from "../../engine/facilities";
import { ECON, rentConfig, rentOf, carResaleRefund, resaleRefund } from "../../engine/econConfig";
import type { FacilityKind, Transport, Unit } from "../../engine/types";
import type { Picked, TowerEngine } from "../../render/excalibur/TowerEngine";
import type { Tool } from "../../ui/UI";
import { unitEditorHtml, transportEditorHtml } from "../../ui/editorHtml";
import { announceForPlacement, snapX, type PlaceOutcome } from "../../ui/placement";
import { BuildActions } from "../../game/buildActions";
import { EditorActions } from "../../game/editorActions";
import { SaveLoad } from "../../game/saveLoad";
import { InspectorController } from "../../game/inspector";
import { KeyboardPlay } from "../../game/keyboardPlay";
import { render, type TemplateResult } from "lit-html";

/** The src/game/ controllers extracted from the GameApp class run against the
 *  real (headless) Simulation with minimal fake ui/audio ports — these tests
 *  pin the money paths, the inspector's ✕-latch, and the keyboard cursor's
 *  announce lines that were previously locked inside main.ts. */

/** The most recent entry (tsconfig's lib predates Array.prototype.at). */
function last<T>(arr: T[]): T {
  return arr[arr.length - 1];
}

/** The inspector card is a lit template since E6-S2; render it detached and
 *  hand back the text so the content assertions keep reading plain strings. */
function renderedText(tpl: TemplateResult): string {
  const div = document.createElement("div");
  render(tpl, div);
  return div.textContent ?? "";
}

/** Recording fakes for the narrow ui/audio ports the controllers take. */
function fakes() {
  const toasts: { text: string; kind?: "info" | "good" | "bad" | "money" }[] = [];
  const sfx: string[] = [];
  return {
    toasts,
    sfx,
    ui: {
      toast: (text: string, kind?: "info" | "good" | "bad" | "money") => {
        toasts.push({ text, kind });
      },
      downloadFile: () => {},
      showImportReport: () => {},
      showExportReport: () => {},
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

describe("BuildActions (the money boundary)", () => {
  let sim: Simulation;
  let office: Unit;
  let lift: Transport;
  let f: ReturnType<typeof fakes>;
  let build: BuildActions;

  beforeEach(() => {
    ({ sim, office, lift } = fixture());
    f = fakes();
    build = new BuildActions({
      getSim: () => sim,
      ui: f.ui,
      audio: f.audio,
      selectedId: () => null,
      clearSelection: () => {},
    });
  });

  it("tryRemoveUnit pays the shared resale refund on sell", () => {
    const before = sim.money;
    expect(build.tryRemoveUnit(office, "sell")).toBe(true);
    expect(sim.money - before).toBe(resaleRefund("office"));
    expect(sim.tower.units.some((u) => u.id === office.id)).toBe(false);
  });

  it("removeTransportWithRefund pays the one shared shaft resale", () => {
    const before = sim.money;
    build.removeTransportWithRefund(lift);
    expect(sim.money - before).toBe(resaleRefund("elevatorStandard"));
    expect(sim.tower.transports.some((t) => t.id === lift.id)).toBe(false);
  });

  it("canAfford refuses with an error toast and sfx, passes silently when funded", () => {
    sim.money = 99;
    expect(build.canAfford(100)).toBe(false);
    expect(f.toasts).toEqual([{ text: "Not enough money.", kind: "bad" }]);
    expect(f.sfx).toEqual(["error"]);
    sim.money = 100;
    expect(build.canAfford(100)).toBe(true);
    expect(f.toasts).toHaveLength(1); // no extra feedback on success
  });

  it("paintBrush reports honestly: already-built strip vs the engine's refusal", () => {
    // The fixture's floor-2 strip already carries floor under the whole brush.
    const already = build.paintBrush("floor", 20, 2);
    expect(already.placed).toBe(0);
    expect(already.reason).toBe("Floor already built here");
    // A broke player painting fresh tiles gets the engine's reason instead.
    sim.money = 0;
    const broke = build.paintBrush("floor", 20, 3);
    expect(broke.placed).toBe(0);
    expect(broke.reason).toBe("Not enough money.");
  });
});

describe("EditorActions (editor-card money paths)", () => {
  let sim: Simulation;
  let office: Unit;
  let lift: Transport;
  let f: ReturnType<typeof fakes>;
  let editor: EditorActions;
  let sel: { type: "unit" | "transport"; id: number } | null;
  let undo: { captures: string[]; commits: number };
  let root: HTMLElement;

  beforeEach(() => {
    ({ sim, office, lift } = fixture());
    f = fakes();
    sel = null;
    undo = { captures: [], commits: 0 };
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
        showStopsDialog: () => {},
        showBatchPricingDialog: () => {},
      },
      audio: f.audio,
      build,
      selected: () => sel,
      selectedUnit: () => (sel?.type === "unit" ? sim.tower.units.find((x) => x.id === sel!.id) : undefined),
      selectedTransport: () =>
        sel?.type === "transport" ? sim.tower.transports.find((x) => x.id === sel!.id) : undefined,
      clearSelection: () => (sel = null),
      refreshEditor: () => {},
      captureUndo: (label) => undo.captures.push(label),
      commitUndo: () => undo.commits++,
      announce: () => {},
    });
  });

  it("sell (unit) pays the resale refund, clears the selection, commits the undo step", () => {
    sel = { type: "unit", id: office.id };
    root.innerHTML = unitEditorHtml(sim, office);
    const before = sim.money;
    editor.handleEditAction("sell", root);
    expect(sim.money - before).toBe(resaleRefund("office"));
    expect(sim.tower.units.some((u) => u.id === office.id)).toBe(false);
    expect(sel).toBeNull();
    expect(undo.captures).toEqual(["Sell"]);
    expect(undo.commits).toBe(1);
    expect(f.sfx).toContain("sell");
  });

  it("sell (transport) routes through the one shared refund path", () => {
    sel = { type: "transport", id: lift.id };
    root.innerHTML = transportEditorHtml(sim, lift);
    const before = sim.money;
    editor.handleEditAction("sell", root);
    expect(sim.money - before).toBe(resaleRefund("elevatorStandard"));
    expect(sim.tower.transports.some((t) => t.id === lift.id)).toBe(false);
    expect(sel).toBeNull();
  });

  it("mobile editor folds in the card's diagnostics and drops the duplicate access row", () => {
    const { sim, office } = fixture();
    const mobile = unitEditorHtml(sim, office, true);
    const desktop = unitEditorHtml(sim, office, false);
    // Mobile folds in the card's richer access reachability line as a live
    // block, so the plain "Elevator access: Yes/No" row that would duplicate it
    // is dropped.
    expect(mobile).toContain('data-field="diagnostics"');
    expect(mobile).toContain("Access:"); // the served office reads "Access: reachable…"
    expect(mobile).not.toContain("Elevator access");
    // Desktop keeps the plain access row and leaves the diagnostics to the
    // hover card, so it carries neither the block nor the reachability line.
    expect(desktop).toContain("Elevator access");
    expect(desktop).not.toContain("Access:");
    expect(desktop).not.toContain('data-field="diagnostics"');
  });

  it("mobile editor keeps the access row for a zero-population service kind (no diagnostics access line)", () => {
    const sim = new Simulation();
    for (let x = 10; x < 30; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let x = 10; x < 30; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
    const r = sim.tower.place("security", 2, 12);
    expect(r.ok).toBe(true);
    const sec = sim.tower.units.find((u) => u.id === r.unitId)!;
    sec.state = "occupied";
    // Security has no population and no traffic income, so facilityDiagnostics
    // emits no access line: the mobile editor keeps the plain "Elevator access"
    // row so its connectivity still shows (parity with desktop, not a silent drop).
    expect(unitEditorHtml(sim, sec, true)).toContain("Elevator access");
  });

  it("mobile editor folds the retail patronage block into a shop's panel", () => {
    const sim = new Simulation();
    for (let x = 10; x < 40; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let x = 10; x < 40; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
    const r = sim.tower.place("shop", 2, 12);
    expect(r.ok).toBe(true);
    const shop = sim.tower.units.find((u) => u.id === r.unitId)!;
    shop.state = "occupied";
    expect(unitEditorHtml(sim, shop, true)).toContain("patronage");
    expect(unitEditorHtml(sim, shop, false)).not.toContain("patronage");
  });

  it("rentUp/rentDown clamp a real office to the engine's rent band", () => {
    sel = { type: "unit", id: office.id };
    root.innerHTML = unitEditorHtml(sim, office);
    const band = rentConfig("office")!;
    for (let i = 0; i < 100; i++) editor.handleEditAction("rentUp", root);
    expect(rentOf(office)).toBe(band.max);
    for (let i = 0; i < 200; i++) editor.handleEditAction("rentDown", root);
    expect(rentOf(office)).toBe(band.min);
  });

  it("addcar charges and removecar refunds the half-back car resale", () => {
    sel = { type: "transport", id: lift.id };
    root.innerHTML = transportEditorHtml(sim, lift);
    const cars0 = lift.cars;
    const before = sim.money;
    editor.handleEditAction("addcar", root);
    expect(lift.cars).toBe(cars0 + 1);
    expect(sim.money).toBe(before - ECON.addCarCost);
    editor.handleEditAction("removecar", root);
    expect(lift.cars).toBe(cars0);
    expect(sim.money).toBe(before - ECON.addCarCost + carResaleRefund());
  });

  it("extendUp refuses when broke: toast, error sfx, shaft unchanged", () => {
    sel = { type: "transport", id: lift.id };
    root.innerHTML = transportEditorHtml(sim, lift);
    sim.money = 0;
    const { top, bottom } = lift;
    editor.handleEditAction("extendUp", root);
    expect(lift.top).toBe(top);
    expect(lift.bottom).toBe(bottom);
    expect(f.toasts).toEqual([{ text: "Not enough money.", kind: "bad" }]);
    expect(f.sfx).toContain("error");
  });
});

describe("SaveLoad (tower-swap contracts)", () => {
  let sim: Simulation;
  let f: ReturnType<typeof fakes>;
  let adopted: Simulation[];
  let saveLoad: SaveLoad;

  beforeEach(() => {
    sim = new Simulation();
    f = fakes();
    adopted = [];
    saveLoad = new SaveLoad({
      getSim: () => sim,
      getView: () => null,
      adoptSim: (s) => {
        adopted.push(s);
      },
      ui: f.ui,
      showCrashScreen: () => {},
      attemptGraphicsRecovery: () => {},
      armOnboarding: () => {},
    });
  });

  it("newGame adopts a fresh sim (the dep's shape forbids preserving the undo trail)", () => {
    // SaveLoadDeps.adoptSim deliberately takes no preserveHistory flag — the
    // type itself now guarantees a tower swap through this module invalidates
    // the undo history, so Undo can never resurrect the abandoned tower.
    saveLoad.newGame();
    expect(adopted).toHaveLength(1);
    expect(adopted[0]).toBeInstanceOf(Simulation);
    expect(adopted[0]).not.toBe(sim);
    expect(f.toasts).toEqual([{ text: "New tower founded. Good luck!", kind: "good" }]);
  });

  it("importGame rejects garbage JSON with a toast and never touches the sim", async () => {
    await saveLoad.importGame("{ this is not a tower");
    expect(adopted).toHaveLength(0);
    expect(f.toasts).toHaveLength(1);
    expect(f.toasts[0].kind).toBe("bad");
    expect(f.toasts[0].text).toMatch(/^Import failed: /);
  });
});

describe("InspectorController (✕-dismissal latch)", () => {
  let sim: Simulation;
  let office: Unit;
  let lift: Transport;
  let shown: (string | null)[];
  let anchor: { x: number; floor: number } | null;
  let inspector: InspectorController;
  let officePick: Picked;
  let liftPick: Picked;

  beforeEach(() => {
    ({ sim, office, lift } = fixture());
    shown = [];
    anchor = null;
    inspector = new InspectorController({
      getSim: () => sim,
      // The card is a lit template since E6-S2; record its rendered text so
      // the latch assertions keep reading plain content.
      ui: { showInspector: (tpl) => shown.push(tpl && renderedText(tpl)) },
      setAnchor: (a) => (anchor = a),
    });
    officePick = { type: "unit", id: office.id, kind: "office" };
    liftPick = { type: "transport", id: lift.id, kind: "elevatorStandard" };
  });

  it("dismiss latches the target: same-facility hover picks stay closed, null picks don't spend it", () => {
    inspector.inspectPicked(officePick);
    expect(last(shown)).toContain(FACILITIES.office.name);
    expect(anchor).toEqual({ x: office.x + office.width, floor: office.floor });
    inspector.dismiss();
    expect(last(shown)).toBeNull();
    const calls = shown.length;
    inspector.inspectPicked(officePick); // latched — no re-open, no call at all
    expect(shown.length).toBe(calls);
    inspector.inspectPicked(null); // pointer jitter across a gap: hides again…
    expect(last(shown)).toBeNull();
    inspector.inspectPicked(officePick); // …but the latch survived it
    expect(last(shown)).toBeNull();
  });

  it("picking a DIFFERENT facility spends the latch", () => {
    inspector.inspectPicked(officePick);
    inspector.dismiss();
    inspector.inspectPicked(liftPick); // different facility opens…
    expect(last(shown)).toContain(FACILITIES.elevatorStandard.name);
    inspector.inspectPicked(officePick); // …and re-arms the dismissed one
    expect(last(shown)).toContain(FACILITIES.office.name);
  });

  it("clear() and resetLatch() drop the latch (tower swap / explicit tap)", () => {
    inspector.inspectPicked(officePick);
    inspector.dismiss();
    inspector.clear(); // adoptSim path: recycled ids must not stay muted
    inspector.inspectPicked(officePick);
    expect(last(shown)).toContain(FACILITIES.office.name);
    inspector.dismiss();
    inspector.resetLatch(); // selectPicked path: a tap is fresh intent
    inspector.inspectPicked(officePick);
    expect(last(shown)).toContain(FACILITIES.office.name);
  });
});

describe("KeyboardPlay (commit announcements)", () => {
  const mid = Math.floor(GRID.width / 2);
  let sim: Simulation;
  let announced: string[];
  let tool: Tool;
  let keyboard: KeyboardPlay;
  let undoLog: string[];

  beforeEach(() => {
    sim = new Simulation();
    // Structure under the keyboard cursor's reveal cell (mid-lot, floor 1).
    for (let x = mid - 15; x < mid + 15; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let x = mid - 15; x < mid + 15; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
    announced = [];
    tool = { type: "inspect" };
    const f = fakes();
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
    // Mirrors GameApp.placeSimpleBuild — the injected gesture-shared placement.
    const placeSimpleBuild = (kind: FacilityKind, tile: number, floor: number): PlaceOutcome | null => {
      if (kind === "floor" || kind === "lobby") {
        const r = build.paintBrush(kind, tile, floor);
        return { what: "paint", ok: r.placed > 0, reason: r.reason };
      }
      if (isFixedSpanTransport(kind)) {
        const r = build.tryBuildTransport(kind, snapX(kind, tile), floor, floor + 1);
        return { what: "flight", ok: r.ok, reason: r.reason };
      }
      if (FACILITIES[kind].transport) return null;
      const before = sim.tower.units.length;
      build.tryBuild(kind, floor, snapX(kind, tile));
      return { what: "room", ok: sim.tower.units.length > before };
    };
    const fakeEngine = {
      ensureVisible: () => {},
      preview: null as TowerEngine["preview"],
      transportPreview: null as TowerEngine["transportPreview"],
    };
    keyboard = new KeyboardPlay({
      getSim: () => sim,
      engine: () => fakeEngine,
      audio: f.audio,
      ui: f.ui,
      build,
      tool: () => tool,
      isTransportTool,
      announce: (msg) => announced.push(msg),
      pickedAt,
      selectPicked: () => {},
      placeSimpleBuild,
      updateBuildPreview: () => {},
      captureUndo: (label) => undoLog.push(`capture:${label}`),
      commitUndo: () => undoLog.push("commit"),
    });
    undoLog = [];
  });

  it("paint commit announces the announceForPlacement paint line", () => {
    keyboard.moveCursor(0, 0); // first move reveals the cursor at (mid, 1)
    keyboard.moveCursor(0, 1); // up to floor 2, above the lobby strip
    tool = { type: "build", kind: "floor" };
    keyboard.commitCursor(); // paints on floor 3 support? no — floor 2 already built…
    // …so the honest line is the "already built here" reason, verbatim.
    expect(last(announced)).toBe(announceForPlacement({ what: "paint", ok: false, reason: "Floor already built here" }, "floor", 2));
    keyboard.moveCursor(0, 1); // floor 3: fresh tiles above the strip
    keyboard.commitCursor();
    expect(last(announced)).toBe(announceForPlacement({ what: "paint", ok: true }, "floor", 3));
    expect(last(announced)).toBe("Placed Floor on floor 3");
  });

  it("flight commit announces the announceForPlacement flight line", () => {
    keyboard.moveCursor(0, 0); // (mid, 1)
    tool = { type: "build", kind: "stairs" };
    keyboard.commitCursor();
    expect(last(announced)).toBe(announceForPlacement({ what: "flight", ok: true, reason: "" }, "stairs", 1));
    expect(last(announced)).toBe(`${FACILITIES.stairs.name} built, floors 1 to 2`);
  });

  it("room commit announces the announceForPlacement room line", () => {
    keyboard.moveCursor(0, 0);
    keyboard.moveCursor(0, 1); // (mid, 2) — on the built floor strip
    tool = { type: "build", kind: "office" };
    keyboard.commitCursor();
    expect(last(announced)).toBe(announceForPlacement({ what: "room", ok: true }, "office", 2));
    expect(last(announced)).toBe("Placed Office");
  });

  it("keyboard build and bulldoze bracket undo like the mouse gestures", () => {
    // Undo parity: mouse paths capture on press and commit on release; the
    // keyboard used to skip both, fusing keyboard edits into the previous
    // mouse gesture's undo entry.
    keyboard.moveCursor(0, 0);
    keyboard.moveCursor(0, 1);
    tool = { type: "build", kind: "office" };
    keyboard.commitCursor();
    expect(undoLog).toEqual(["capture:Build Office", "commit"]);
    undoLog.length = 0;
    tool = { type: "bulldoze" };
    keyboard.commitCursor(); // office sits under the cursor
    expect(undoLog).toEqual(["capture:Bulldoze", "commit"]);
    undoLog.length = 0;
    keyboard.commitCursor(); // nothing left here — no capture for a no-op
    expect(last(announced)).toBe("Nothing to bulldoze here");
    expect(undoLog).toEqual([]);
    // Inspect commits never touch undo.
    tool = { type: "inspect" };
    keyboard.commitCursor();
    expect(undoLog).toEqual([]);
  });
});

describe("InspectorController (data-rich cards: parking, recycling, notice)", () => {
  function place(sim: Simulation, kind: FacilityKind, floor: number, x: number): Unit {
    const r = sim.tower.place(kind, floor, x);
    expect(r.ok, `place ${kind} @${floor},${x}`).toBe(true);
    return sim.tower.units.find((u) => u.id === r.unitId)!;
  }
  function makeInspector(sim: Simulation) {
    const shown: (string | null)[] = [];
    const inspector = new InspectorController({
      getSim: () => sim,
      ui: { showInspector: (tpl) => shown.push(tpl && renderedText(tpl)) },
      setAnchor: () => {},
    });
    return { inspector, shown };
  }

  it("a parking ramp shows the tower-wide demand line; a chained space reads connected, an orphan reads dead", () => {
    const sim = new Simulation();
    for (let x = 10; x < 46; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let x = 10; x < 46; x++) expect(sim.tower.place("floor", 0, x).ok).toBe(true);
    const ramp = place(sim, "parkingRamp", 0, 20); // tiles 20–35 (canon 16-wide ramp)
    const good = place(sim, "parking", 0, 36); // abuts the ramp → connected
    const dead = place(sim, "parking", 0, 42); // gap at 40–41 → orphaned
    [ramp, good, dead].forEach((u) => (u.state = "empty")); // operational (not construction)

    const { inspector, shown } = makeInspector(sim);
    inspector.inspectPicked({ type: "unit", id: ramp.id, kind: "parkingRamp" });
    expect(last(shown)).toContain("Demand:");

    inspector.inspectPicked({ type: "unit", id: good.id, kind: "parking" });
    expect(last(shown)).toContain("Ramp access: connected");

    inspector.inspectPicked({ type: "unit", id: dead.id, kind: "parking" });
    expect(last(shown)).toContain("Ramp access: none");
    expect(last(shown)).toContain("dead");
  });

  it("a recycling center shows its fill and the capacity/demand verdict", () => {
    const sim = new Simulation();
    for (let x = 10; x < 40; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (const f of [0, -1]) for (let x = 10; x < 40; x++) expect(sim.tower.place("floor", f, x).ok).toBe(true);
    const rec = place(sim, "recycling", -1, 12); // 2-floor, width-20 center
    rec.state = "empty"; // operational

    const { inspector, shown } = makeInspector(sim);
    inspector.inspectPicked({ type: "unit", id: rec.id, kind: "recycling" });
    expect(last(shown)).toContain("Fill:");
    expect(last(shown)).toMatch(/demand met|Over capacity/);
  });

  it("a tenant on notice spells out the cause, a time bound, and the recovery target", () => {
    const { sim, office } = fixture();
    office.state = "vacating";
    office.vacateReason = "rent";
    office.vacateAt = sim.clock.minutes + 2 * 60; // ~2 hours left
    office.satisfaction = 0.3;

    const { inspector, shown } = makeInspector(sim);
    inspector.inspectPicked({ type: "unit", id: office.id, kind: "office" });
    const card = last(shown)!;
    expect(card).toContain("Giving notice");
    expect(card).toContain("rent set too high");
    expect(card).toContain("hour(s)");
    expect(card).toContain("30%"); // current satisfaction in the recovery line
  });
});
