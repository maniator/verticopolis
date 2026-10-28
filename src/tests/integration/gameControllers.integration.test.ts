import { describe, expect, it, beforeEach, vi } from "vitest";
import { catalogFor } from "../../engine/catalog";
import { Simulation } from "../../engine/Simulation";
import { FACILITIES, GRID, isFixedSpanTransport } from "../../engine/facilities";
import { ECON, rentOf, carResaleRefund, resaleRefund } from "../../engine/econConfig";
import type { FacilityKind, Transport, Unit } from "../../engine/types";
import type { Picked, TowerEngine } from "../../render/excalibur/TowerEngine";
import type { Tool } from "../../ui/UI";
import { unitEditor, transportEditor, editorPortDeps, inspectorPortDeps } from "../../game/cardKit.fixture";
import { announceForPlacement, snapX, type PlaceOutcome } from "../../ui/placement";
import { BuildActions } from "../../game/buildActions";
import { EditorActions } from "../../game/editorActions";
import { SaveLoad } from "../../game/saveLoad";
import { InspectorController } from "../../game/inspector";
import { KeyboardPlay } from "../../game/keyboardPlay";
import { render, type TemplateResult } from "lit-html";
import { createTsSim } from "../../simport/tsSim";
import { portDeps } from "../../game/portDeps.fixture";

const CAT = catalogFor("classic");

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
  return renderedCard(tpl).textContent ?? "";
}

/** An editor/inspector template rendered into a detached container, for
 *  structure assertions (the string builders these tests once read retired
 *  with the final sweep). */
function renderedCard(tpl: TemplateResult): HTMLElement {
  const div = document.createElement("div");
  render(tpl, div);
  return div;
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
      sayVisibly: vi.fn(),
      downloadFile: () => true,
      showImportReport: () => {},
      showExportReport: () => {},
    },
    audio: {
      sfx: (name: "build" | "sell" | "error" | "promote" | "money" | "notify" | "click") => {
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
      ...portDeps(sim).deps,
      ui: f.ui,
      audio: f.audio,
      selectedId: () => null,
      clearSelection: () => {},
    });
  });

  it("tryRemoveUnit pays the shared resale refund on sell", async () => {
    const before = sim.money;
    expect(await build.tryRemoveUnit(office, "sell")).toBe(true);
    expect(sim.money - before).toBe(resaleRefund("office"));
    expect(sim.tower.units.some((u) => u.id === office.id)).toBe(false);
  });

  it("removeTransportWithRefund pays the one shared shaft resale", async () => {
    const before = sim.money;
    expect(await build.removeTransportWithRefund(lift, "sell")).toBe(true);
    expect(sim.money - before).toBe(resaleRefund("elevatorStandard"));
    expect(sim.tower.transports.some((t) => t.id === lift.id)).toBe(false);
  });

  it("removeTransportWithRefund reports a refusal (the shaft already gone) and pays nothing", async () => {
    expect(sim.tower.removeTransport(lift.id)).toBeDefined();
    const before = sim.money;
    expect(await build.removeTransportWithRefund(lift, "bulldoze")).toBe(false);
    expect(sim.money).toBe(before);
  });

  it("reports each shell removal to the engine with the gesture as its method, and a refusal as none", async () => {
    // The analytics bridge sends demolish from these; the shell no longer does.
    const removals = () => sim.drainGameplayEvents().filter((e) => e.name === "facility_removed");
    removals();
    expect(await build.tryRemoveUnit(office, "bulldoze")).toBe(true);
    expect(await build.removeTransportWithRefund(lift, "sell")).toBe(true);
    expect(await build.removeTransportWithRefund(lift, "bulldoze")).toBe(false);
    expect(removals().map((e) => e.payload)).toEqual([
      { kind: "office", method: "bulldoze" },
      { kind: "elevatorStandard", method: "sell" },
    ]);
  });

  it("tryRemoveUnit surfaces the engine's refusal: a burning unit stays, no refund", async () => {
    office.state = "fire";
    const before = sim.money;
    expect(await build.tryRemoveUnit(office, "sell")).toBe(false);
    expect(sim.money).toBe(before);
    expect(f.toasts).toEqual([{ text: "You can't sell a burning unit. Call fire rescue or let it burn out.", kind: "bad" }]);
    expect(f.sfx).toEqual(["error"]);
    expect(sim.tower.getUnit(office.id)).toBe(office);
  });

  it("paintBrush reports honestly: already-built strip vs the engine's refusal", async () => {
    // The fixture's floor-2 strip already carries floor under the whole brush.
    const already = await build.paintBrush("floor", 20, 2);
    expect(already.placed).toBe(0);
    expect(already.reason).toBe("Floor already built here");
    // A broke player painting fresh tiles gets the engine's reason instead.
    sim.money = 0;
    const broke = await build.paintBrush("floor", 20, 3);
    expect(broke.placed).toBe(0);
    expect(broke.reason).toBe("Not enough money.");
  });

  it("a press aimed past the lot line onto a built edge says so (#513 sibling: the silent boundary)", async () => {
    // Build the left edge out with lobby, the way a wall-to-wall tower has it.
    expect((await build.paintBrush("lobby", 3, 1)).placed).toBeGreaterThan(0);
    f.toasts.length = 0;
    f.sfx.length = 0;
    // A press beyond the lot clamps onto the edge column; every clamped tile
    // already carries lobby, so before the fix this was a silent dead click.
    const edge = await build.paintBrush("lobby", -5, 1);
    expect(edge.placed).toBe(0);
    expect(edge.reason).toBe("That's the edge of the lot.");
    expect(f.toasts).toEqual([{ text: "That's the edge of the lot.", kind: "bad" }]);
    expect(f.sfx).toEqual(["error"]); // refusal toasts always pair with the sfx
    // The same dead press ON the lot keeps today's quiet already-built report.
    f.toasts.length = 0;
    const on = await build.paintBrush("lobby", 3, 1);
    expect(on.placed).toBe(0);
    expect(on.reason).toBe("Lobby already built here");
    expect(f.toasts).toEqual([]);
    // And an engine refusal keeps precedence even when aiming off-lot: the
    // boundary only claims presses nothing else blocked.
    f.toasts.length = 0;
    sim.money = 0;
    const brokeOff = await build.paintBrush("floor", 900, 3);
    expect(brokeOff.placed).toBe(0);
    expect(brokeOff.reason).not.toBe("That's the edge of the lot.");
    expect(f.toasts).toEqual([]);
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
      ...portDeps(sim).deps,
      ui: f.ui,
      audio: f.audio,
      selectedId: () => sel?.id ?? null,
      clearSelection: () => (sel = null),
    });
    editor = new EditorActions({
      ...editorPortDeps(sim),
      ui: {
        toast: f.ui.toast,
        showBatchPricingDialog: () => {},
        showElevatorScheduleDialog: () => {},
      },
      audio: f.audio,
      build,
      selected: () => sel,
      clearSelection: () => (sel = null),
      refreshEditor: () => {},
      captureUndo: (label) => undo.captures.push(label),
      commitUndo: () => undo.commits++,
      announce: () => {},
    });
  });

  it("sell (unit) pays the resale refund, clears the selection, commits the undo step", async () => {
    sel = { type: "unit", id: office.id };
    render(unitEditor(sim, office), root);
    const before = sim.money;
    await editor.handleEditAction("sell", root);
    expect(sim.money - before).toBe(resaleRefund("office"));
    expect(sim.tower.units.some((u) => u.id === office.id)).toBe(false);
    expect(sel).toBeNull();
    expect(undo.captures).toEqual(["Sell"]);
    expect(undo.commits).toBe(1);
    expect(f.sfx).toContain("sell");
  });

  it("sell (transport) routes through the one shared refund path", async () => {
    sel = { type: "transport", id: lift.id };
    render(transportEditor(sim, lift), root);
    const before = sim.money;
    await editor.handleEditAction("sell", root);
    expect(sim.money - before).toBe(resaleRefund("elevatorStandard"));
    expect(sim.tower.transports.some((t) => t.id === lift.id)).toBe(false);
    expect(sel).toBeNull();
  });

  it("mobile editor folds in the card's diagnostics and drops the duplicate access row", () => {
    const { sim, office } = fixture();
    const mobile = renderedCard(unitEditor(sim, office, true));
    const desktop = renderedCard(unitEditor(sim, office, false));
    // Mobile folds in the card's richer access reachability line as a live
    // block, so the plain "Elevator access: Yes/No" row that would duplicate it
    // is dropped.
    expect(mobile.querySelector('[data-field="diagnostics"]')).not.toBeNull();
    expect(mobile.textContent).toContain("Access:"); // the served office reads "Access: reachable…"
    expect(mobile.textContent).not.toContain("Elevator access");
    // Desktop keeps the plain access row and leaves the diagnostics to the
    // hover card, so it carries neither the block nor the reachability line.
    expect(desktop.textContent).toContain("Elevator access");
    expect(desktop.textContent).not.toContain("Access:");
    expect(desktop.querySelector('[data-field="diagnostics"]')).toBeNull();
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
    expect(renderedCard(unitEditor(sim, sec, true)).textContent).toContain("Elevator access");
  });

  it("mobile editor folds the retail patronage block into a shop's panel", () => {
    const sim = new Simulation();
    for (let x = 10; x < 40; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let x = 10; x < 40; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
    const r = sim.tower.place("shop", 2, 12);
    expect(r.ok).toBe(true);
    const shop = sim.tower.units.find((u) => u.id === r.unitId)!;
    shop.state = "occupied";
    expect(renderedCard(unitEditor(sim, shop, true)).textContent).toContain("patronage");
    expect(renderedCard(unitEditor(sim, shop, false)).textContent).not.toContain("patronage");
  });

  it("rentUp/rentDown clamp a real office to the ends of the Classic ladder", async () => {
    sel = { type: "unit", id: office.id };
    render(unitEditor(sim, office), root);
    // A default Simulation is Classic: nudges step whole rungs and clamp at
    // the ladder ends (High $15,000 / Very Low $2,000), never the Modern band.
    for (let i = 0; i < 100; i++) await editor.handleEditAction("rentUp", root);
    expect(rentOf(office)).toBe(15_000);
    for (let i = 0; i < 200; i++) await editor.handleEditAction("rentDown", root);
    expect(rentOf(office)).toBe(2_000);
  });

  it("addcar charges and removecar refunds the half-back car resale", async () => {
    sel = { type: "transport", id: lift.id };
    render(transportEditor(sim, lift), root);
    const cars0 = lift.cars;
    const before = sim.money;
    await editor.handleEditAction("addcar", root);
    expect(lift.cars).toBe(cars0 + 1);
    expect(sim.money).toBe(before - ECON.addCarCost);
    await editor.handleEditAction("removecar", root);
    expect(lift.cars).toBe(cars0);
    expect(sim.money).toBe(before - ECON.addCarCost + carResaleRefund());
  });

  it("extendUp refuses when broke: toast, error sfx, shaft unchanged", async () => {
    sel = { type: "transport", id: lift.id };
    render(transportEditor(sim, lift), root);
    sim.money = 0;
    const { top, bottom } = lift;
    await editor.handleEditAction("extendUp", root);
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
    // Classic founds an empty lot, so the founding toast carries the
    // actionable lobby line instead of the plain send-off.
    expect(f.toasts).toEqual([{ text: "New tower founded. Lay a lobby on the ground line to open it.", kind: "good" }]);
  });

  it("importGame rejects garbage JSON where the player can read it, and never touches the sim", async () => {
    // Says it through `sayVisibly`, not a toast: the OS file picker is not a
    // modal, so this failure can land after the player has opened a dialog,
    // and a dialog paints over the toast rail at any z-index (GH #658). The
    // routing picks the toast itself when nothing is on screen.
    await saveLoad.importGame("{ this is not a tower");
    expect(adopted).toHaveLength(0);
    expect(f.ui.sayVisibly).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.ui.sayVisibly).mock.calls[0][0]).toMatch(/^Import failed: /);
  });

  it("Quick Save surfaces a quota failure honestly: failure toast, no success toast, no escaped throw (AUD-010)", () => {
    // Instance spy, the storage suite's idiom: prototype spies do not re-arm
    // reliably after a mockRestore in the same file.
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    try {
      expect(() => saveLoad.save()).not.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(f.toasts).toEqual([
      {
        text: "Save failed: storage is full or blocked. Free up space or allow site storage, then try again.",
        kind: "bad",
      },
    ]);
    // The success path still works once storage recovers, with its normal copy.
    saveLoad.save();
    expect(f.toasts).toHaveLength(2);
    expect(f.toasts[1].kind).toBe("good");
    expect(f.toasts[1].text).toMatch(/^Saved ✓ · /);
    // The recovery save above wrote a real autosave; drop it so this test
    // leaks no storage state into later suites in the file.
    localStorage.clear();
  });

  it("a camera-stamp throw (context-lost engine) reaches the same failure toast, never the click handler", () => {
    // getView -> engine.viewState() can throw on a disposed/context-lost
    // engine; the manual path's no-escaped-throw contract covers the stamp
    // too, while the silent path still propagates it to its own callers.
    const f2 = fakes();
    const throwing = new SaveLoad({
      getSim: () => sim,
      getView: () => {
        throw new Error("context lost");
      },
      adoptSim: () => {},
      ui: f2.ui,
      showCrashScreen: () => {},
      attemptGraphicsRecovery: () => {},
      armOnboarding: () => {},
    });
    expect(() => throwing.save()).not.toThrow();
    expect(f2.toasts).toEqual([{ text: "Save failed: context lost", kind: "bad" }]);
    expect(() => throwing.save(true)).toThrow(/context lost/);
  });

  it("the SILENT save path still throws on a storage failure (saveBeforeUpdate's callers rely on it)", () => {
    // saveBeforeUpdate must not reload on a failed write, and the context-loss
    // flush words the failure on the crash screen: both catch the throw
    // themselves, so the quota guard on the manual path must not swallow it.
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    try {
      // Match the quota error specifically: a refactor that throws some
      // unrelated TypeError before reaching storage must not satisfy this pin.
      expect(() => saveLoad.save(true)).toThrow(/quota/i);
    } finally {
      spy.mockRestore();
    }
    expect(f.toasts).toEqual([]); // silent path: no toast of either kind
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
      ...inspectorPortDeps(sim),
      // The card is a lit template since E6-S2; record its rendered text so
      // the latch assertions keep reading plain content.
      ui: { showInspector: (tpl) => shown.push(tpl && renderedText(tpl)) },
      setAnchor: (a) => (anchor = a),
    });
    officePick = { type: "unit", id: office.id, kind: "office" };
    liftPick = { type: "transport", id: lift.id, kind: "elevatorStandard" };
  });

  it("resetLatch spends the dismissal: the peek path's fresh-intent seam re-raises the card (#696)", () => {
    inspector.inspectPicked(officePick);
    inspector.dismiss();
    const calls = shown.length;
    // A hover pick alone stays closed (the latch is doing its hover-jitter job)...
    inspector.inspectPicked(officePick);
    expect(shown.length).toBe(calls);
    // ...but spending the latch first (what onLongPress and selectPicked both
    // do: an explicit hold or tap is fresh intent) re-raises the card. The
    // count check keeps this non-vacuous: last(shown) already held the office
    // card from the opening pick, so only a NEW show may pass the test.
    inspector.resetLatch();
    inspector.inspectPicked(officePick);
    expect(shown.length).toBe(calls + 1);
    expect(last(shown)).toContain(FACILITIES.office.name);
  });

  it("dismiss latches the target: same-facility hover picks stay closed, null picks don't spend it", () => {
    inspector.inspectPicked(officePick);
    expect(last(shown)).toContain(FACILITIES.office.name);
    expect(anchor).toEqual({ x: office.x + office.width, left: office.x, floor: office.floor });
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
      ...portDeps(sim).deps,
      ui: f.ui,
      audio: f.audio,
      selectedId: () => null,
      clearSelection: () => {},
    });
    const isTransportTool = () => tool.type === "build" && !!FACILITIES[tool.kind].transport;
    // Mirrors pickedAt in src/game/buildPreview.ts: the injected picker contract.
    // Uses the shaft's OWN stored width (tr.width), matching the real impl, so an
    // old save whose stored width differs from the catalog resolves identically.
    const pickedAt = (floor: number, tile: number): Picked | null => {
      const u = sim.tower.unitAt(floor, tile);
      if (u && u.kind !== "floor" && u.kind !== "lobby") return { type: "unit", id: u.id, kind: u.kind };
      const t = sim.tower.transports.find(
        (tr) => tile >= tr.x && tile < tr.x + tr.width && floor >= tr.bottom && floor <= tr.top,
      );
      return t ? { type: "transport", id: t.id, kind: t.kind } : null;
    };
    // Mirrors placeSimpleBuild in src/game/buildPreview.ts: the injected gesture-shared placement.
    const placeSimpleBuild = (kind: FacilityKind, tile: number, floor: number): PlaceOutcome | null => {
      if (kind === "floor" || kind === "lobby") {
        const r = build.paintBrush(kind, tile, floor);
        return { what: "paint", ok: r.placed > 0, reason: r.reason };
      }
      if (isFixedSpanTransport(kind)) {
        const r = build.tryBuildTransport(kind, snapX(CAT, kind, tile), floor, floor + 1);
        return { what: "flight", ok: r.ok, reason: r.reason };
      }
      if (FACILITIES[kind].transport) return null;
      return { what: "room", ok: build.tryBuild(kind, floor, snapX(CAT, kind, tile)) };
    };
    const fakeEngine = {
      ensureVisible: () => {},
      preview: null as TowerEngine["preview"],
      transportPreview: null as TowerEngine["transportPreview"],
    };
    keyboard = new KeyboardPlay({
      ...portDeps(sim).deps,
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

  it("paint commit announces the announceForPlacement paint line", async () => {
    keyboard.moveCursor(0, 0); // first move reveals the cursor at (mid, 1)
    keyboard.moveCursor(0, 1); // up to floor 2, above the lobby strip
    tool = { type: "build", kind: "floor" };
    await keyboard.commitCursor(); // paints on floor 3 support? no: floor 2 already built…
    // …so the honest line is the "already built here" reason, verbatim.
    expect(last(announced)).toBe(announceForPlacement({ what: "paint", ok: false, reason: "Floor already built here" }, CAT, "floor", 2));
    keyboard.moveCursor(0, 1); // floor 3: fresh tiles above the strip
    await keyboard.commitCursor();
    expect(last(announced)).toBe(announceForPlacement({ what: "paint", ok: true }, CAT, "floor", 3));
    expect(last(announced)).toBe("Placed Floor on floor 3");
  });

  it("flight commit announces the announceForPlacement flight line", async () => {
    keyboard.moveCursor(0, 0); // (mid, 1)
    tool = { type: "build", kind: "stairs" };
    await keyboard.commitCursor();
    expect(last(announced)).toBe(announceForPlacement({ what: "flight", ok: true, reason: "" }, CAT, "stairs", 1));
    expect(last(announced)).toBe(`${FACILITIES.stairs.name} built, floors 1 to 2`);
  });

  it("room commit announces the announceForPlacement room line", async () => {
    keyboard.moveCursor(0, 0);
    keyboard.moveCursor(0, 1); // (mid, 2) — on the built floor strip
    tool = { type: "build", kind: "office" };
    await keyboard.commitCursor();
    expect(last(announced)).toBe(announceForPlacement({ what: "room", ok: true }, CAT, "office", 2));
    expect(last(announced)).toBe("Placed Office");
  });

  it("keyboard build and bulldoze bracket undo like the mouse gestures", async () => {
    // Undo parity: mouse paths capture on press and commit on release; the
    // keyboard used to skip both, fusing keyboard edits into the previous
    // mouse gesture's undo entry.
    keyboard.moveCursor(0, 0);
    keyboard.moveCursor(0, 1);
    tool = { type: "build", kind: "office" };
    await keyboard.commitCursor();
    expect(undoLog).toEqual(["capture:Build Office", "commit"]);
    undoLog.length = 0;
    tool = { type: "bulldoze" };
    await keyboard.commitCursor(); // office sits under the cursor
    expect(undoLog).toEqual(["capture:Bulldoze", "commit"]);
    undoLog.length = 0;
    await keyboard.commitCursor(); // nothing left here, so no capture for a no-op
    expect(last(announced)).toBe("Nothing to bulldoze here");
    expect(undoLog).toEqual([]);
    // Inspect commits never touch undo.
    tool = { type: "inspect" };
    await keyboard.commitCursor();
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
      ...inspectorPortDeps(sim),
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
