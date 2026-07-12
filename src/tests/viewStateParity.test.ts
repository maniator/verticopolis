import { describe, expect, it, beforeEach, vi } from "vitest";
import { inflateSync } from "fflate";
import towerFile from "./fixtures/towerone_6.vctower?raw";
import { Simulation } from "../engine/Simulation";
import { FLOOR, TILE, TowerEngine } from "../render/excalibur/TowerEngine";
import { GRID } from "../engine/facilities";
import type { SerializedGame, SerializedView } from "../engine/types";
import { VIEW_ZOOM_MAX, VIEW_ZOOM_MIN } from "../engine/types";
import { SaveGame } from "../storage/SaveGame";
import { SaveLoad } from "../game/saveLoad";
import {
  TDT_DEFAULT_VIEW_X,
  TDT_DEFAULT_VIEW_Y,
  viewFromViewWords,
  viewWordsFromView,
} from "../storage/tdtFormat";
import { buildTDT } from "../storage/tdtExport";
import { parseTDT } from "../storage/tdtImport";
import { buildTdt, sampleTowerSpec } from "./fixtures/tdtBuilder";

/**
 * View-state save parity: the camera (tile/floor/zoom) rides inside every
 * save so a tower moved between devices reopens where its player was
 * standing, matching what the 1994 TDT header already carries at 0x26/0x28.
 * See _bmad-output/implementation-artifacts/story-view-state-save-parity.md.
 */

/** Decode a `.vctower` container without DecompressionStream (env-agnostic). */
function decodeVctower(text: string): SerializedGame {
  const b64 = text.slice(text.indexOf("\n") + 1).trim();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(inflateSync(bytes))) as SerializedGame;
}

const readHdrU16 = (bytes: Uint8Array, off: number): number => bytes[off] | (bytes[off + 1] << 8);

describe("SerializedView through Simulation serialize/deserialize (trust boundary)", () => {
  it("round-trips a stamped view exactly, and an unstamped sim writes no view key at all", () => {
    const sim = new Simulation();
    expect(sim.view).toBeNull();
    expect("view" in sim.serialize()).toBe(false); // undo snapshots must not grow a null field

    sim.view = { tile: 123.5, floor: 42.25, zoom: 1.7 };
    const data = sim.serialize();
    expect(data.view).toEqual({ tile: 123.5, floor: 42.25, zoom: 1.7 });
    expect(Simulation.deserialize(data).view).toEqual({ tile: 123.5, floor: 42.25, zoom: 1.7 });
  });

  it("keeps a zoomless view (a TDT import has no zoom to carry)", () => {
    const data = { ...new Simulation().serialize(), view: { tile: 10, floor: 5 } };
    expect(Simulation.deserialize(data).view).toEqual({ tile: 10, floor: 5 });
  });

  it("tolerates zoom: null as absent (a common JSON encoding of a missing optional)", () => {
    const data = { ...new Simulation().serialize(), view: { tile: 10, floor: 5, zoom: null } };
    expect(Simulation.deserialize(data as unknown as SerializedGame).view).toEqual({ tile: 10, floor: 5 });
  });

  it("drops a malformed view whole: wrong container, wrong member types, non-finite members", () => {
    const base = new Simulation().serialize();
    const forged = (view: unknown) =>
      Simulation.deserialize({ ...base, view } as SerializedGame).view;
    expect(forged("over there")).toBeNull();
    expect(forged(42)).toBeNull();
    expect(forged({})).toBeNull();
    expect(forged({ tile: "12", floor: 5 })).toBeNull();
    expect(forged({ tile: NaN, floor: 5 })).toBeNull();
    expect(forged({ tile: 12, floor: Infinity })).toBeNull();
    expect(forged({ tile: 12, floor: 5, zoom: NaN })).toBeNull();
    expect(forged({ tile: 12, floor: 5, zoom: "big" })).toBeNull();
  });

  it("clamps out-of-range finite values into the grid and the zoom range", () => {
    const base = new Simulation().serialize();
    const view = Simulation.deserialize({
      ...base,
      view: { tile: 1e9, floor: -1e9, zoom: 1e308 },
    } as SerializedGame).view!;
    expect(view.tile).toBe(GRID.width);
    expect(view.floor).toBe(GRID.minFloor);
    expect(view.zoom).toBe(VIEW_ZOOM_MAX);
    const low = Simulation.deserialize({
      ...base,
      view: { tile: -5, floor: 1e9, zoom: 0 },
    } as SerializedGame).view!;
    expect(low.tile).toBe(0);
    expect(low.floor).toBe(GRID.maxFloor);
    expect(low.zoom).toBe(VIEW_ZOOM_MIN);
  });

  it("the committed pre-view fixture still loads, viewless (center fallback)", () => {
    const data = decodeVctower(towerFile);
    expect("view" in data).toBe(false);
    expect(Simulation.deserialize(data).view).toBeNull();
  });
});

describe("SaveLoad stamps the live camera onto the CURRENT tower's saves", () => {
  const camera: SerializedView = { tile: 42, floor: 3, zoom: 1.5 };
  let sim: Simulation;
  let adopted: Simulation[];
  let importReports: { open: () => void }[];
  let saveLoad: SaveLoad;

  beforeEach(() => {
    localStorage.clear();
    document.getElementById("splash")?.remove();
    sim = new Simulation();
    adopted = [];
    importReports = [];
    saveLoad = new SaveLoad({
      getSim: () => sim,
      getView: () => ({ ...camera }),
      adoptSim: (s) => {
        adopted.push(s);
      },
      ui: {
        toast: () => {},
        downloadFile: () => {},
        showImportReport: (_report, cb) => importReports.push({ open: cb.onOpen }),
        showExportReport: () => {},
      },
      showCrashScreen: () => {},
      armOnboarding: () => {},
    });
  });

  it("save() stamps the view; the reloaded autosave carries it", () => {
    saveLoad.save(true);
    expect(SaveGame.load()!.view).toEqual(camera);
  });

  it("a null camera (headless) stamps nothing and never erases a view the sim already carries", () => {
    sim.view = { tile: 7, floor: 8 }; // e.g. brought over by a TDT import
    saveLoad = new SaveLoad({
      getSim: () => sim,
      getView: () => null,
      adoptSim: () => {},
      ui: { toast: () => {}, downloadFile: () => {}, showImportReport: () => {}, showExportReport: () => {} },
      showCrashScreen: () => {},
      armOnboarding: () => {},
    });
    saveLoad.save(true);
    expect(sim.view).toEqual({ tile: 7, floor: 8 });
    expect(SaveGame.load()!.view).toEqual({ tile: 7, floor: 8 });
  });

  it("autosave() stamps the view on the async path too", async () => {
    await saveLoad.autosave();
    expect(SaveGame.load()!.view).toEqual(camera);
  });

  it("exportGame() stamps the view into the .vctower payload", async () => {
    let file = "";
    saveLoad = new SaveLoad({
      getSim: () => sim,
      getView: () => ({ ...camera }),
      adoptSim: () => {},
      ui: {
        toast: () => {},
        downloadFile: (_name, contents) => {
          file = contents as string;
        },
        showImportReport: () => {},
        showExportReport: () => {},
      },
      showCrashScreen: () => {},
      armOnboarding: () => {},
    });
    await saveLoad.exportGame();
    expect(decodeVctower(file).view).toEqual(camera);
  });

  it("importLegacy: the imported sim keeps the TDT file's view, never the live camera's; the pre-adopt flush keeps the live one", () => {
    // Words for a view centered on tile 200, floor 20 (see the mapping tests).
    const words = viewWordsFromView({ tile: 200, floor: 20 });
    const buf = buildTdt({ ...sampleTowerSpec(), viewX: words.x, viewY: words.y });
    saveLoad.importLegacy(buf.buffer as ArrayBuffer, "MOVED.TDT");
    importReports[0].open();
    // The adopted tower and its fresh-slot copy carry the FILE's view
    // (zoomless, fractional: the words quantize to 8px/36px).
    expect(adopted[0].view!.zoom).toBeUndefined();
    expect(adopted[0].view!.tile).toBeCloseTo(200, 1);
    expect(adopted[0].view!.floor).toBeCloseTo(20, 1);
    expect(SaveGame.loadSlot(1)!.view!.tile).toBeCloseTo(200, 1);
    expect(SaveGame.loadSlot(1)!.view!.floor).toBeCloseTo(20, 1);
    // The previous tower's autosave flush carries the live camera.
    expect(SaveGame.load()!.view).toEqual(camera);
  });
});

describe("TDT view-word mapping (header 0x26/0x28)", () => {
  it("anchors on the New Tower default: 1105/3491 lands the view on the ground-lobby area", () => {
    const view = viewFromViewWords(TDT_DEFAULT_VIEW_X, TDT_DEFAULT_VIEW_Y)!;
    expect(view.tile).toBeCloseTo(178.125, 3);
    expect(view.floor).toBeGreaterThanOrEqual(1);
    expect(view.floor).toBeLessThanOrEqual(13);
    // The default words are a FIXED POINT of the mapping: re-exporting the
    // imported default view writes the exact same words back (this is what
    // keeps the exporter's export/import/export idempotence intact).
    expect(viewWordsFromView(view)).toEqual({ x: TDT_DEFAULT_VIEW_X, y: TDT_DEFAULT_VIEW_Y });
  });

  it("treats the (0, 0) pair as no saved view (the 1994 top-left-sky failure mode)", () => {
    expect(viewFromViewWords(0, 0)).toBeNull();
    expect(viewFromViewWords(0, 1)).not.toBeNull();
    expect(viewFromViewWords(1, 0)).not.toBeNull();
  });

  it("round-trips any unclamped view within one tile and one floor", () => {
    for (let floor = -2; floor <= 100; floor += 6) {
      for (let tile = 40; tile <= 300; tile += 20) {
        const w = viewWordsFromView({ tile, floor });
        const back = viewFromViewWords(w.x, w.y)!;
        expect(Math.abs(back.tile - tile)).toBeLessThanOrEqual(1);
        expect(Math.abs(back.floor - floor)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("clamps extremes to what the 1994 window can scroll to (ground/basement pinned at the window edge)", () => {
    // A B10-centered view: the 1994 window bottoms out with the basement at
    // its bottom edge, which reads back as a center ~6.5 floors higher.
    const deep = viewWordsFromView({ tile: 170, floor: -9 });
    expect(viewFromViewWords(deep.x, deep.y)!.floor).toBeCloseTo(-3, 1);
    // The far right edge of our wider-than-representable camera range.
    const right = viewWordsFromView({ tile: 340, floor: 10 });
    expect(viewFromViewWords(right.x, right.y)!.tile).toBe(335);
  });

  it("falls back to the default words for non-finite members", () => {
    expect(viewWordsFromView({ tile: NaN, floor: 5 })).toEqual({ x: TDT_DEFAULT_VIEW_X, y: TDT_DEFAULT_VIEW_Y });
    expect(viewWordsFromView({ tile: 5, floor: Infinity })).toEqual({ x: TDT_DEFAULT_VIEW_X, y: TDT_DEFAULT_VIEW_Y });
  });

  it("never manufactures the (0, 0) sentinel for a real view (top-left extreme survives re-import)", () => {
    // An unclamped view (never through coerceView) that clamps to the exact
    // top-left corner must not export as the "no saved view" pair.
    const words = viewWordsFromView({ tile: 20, floor: 150 });
    expect(words).toEqual({ x: 0, y: 1 });
    expect(viewFromViewWords(words.x, words.y)).not.toBeNull();
  });
});

describe("TowerEngine camera restore (prototype on a fake: no canvas)", () => {
  /** Minimal fake on the real prototype, carrying just the fields the camera
   *  methods reach through the getters (cam, viewWidth/viewHeight) and
   *  center(). No canvas or WebGL is ever touched. */
  function fakeEngine(highestFloor = 40) {
    const fake = Object.create(TowerEngine.prototype);
    fake.engine = {
      currentScene: { camera: { pos: { x: 0, y: 0 }, zoom: 0.9 } },
      screen: { resolution: { width: 800, height: 600 } },
    };
    fake.sim = { tower: { highestFloor } };
    return fake;
  }
  const proto = TowerEngine.prototype as any;

  it("viewState() and applyView() are exact inverses on the same device", () => {
    const fake = fakeEngine();
    proto.applyView.call(fake, { tile: 123.5, floor: 42.25, zoom: 1.7 });
    const cam = fake.engine.currentScene.camera;
    expect(cam.pos.x).toBeCloseTo(123.5 * TILE, 6);
    expect(cam.pos.y).toBeCloseTo(-42.25 * FLOOR, 6);
    expect(cam.zoom).toBe(1.7);
    expect(proto.viewState.call(fake)).toEqual({ tile: 123.5, floor: 42.25, zoom: 1.7 });
  });

  it("applyView clamps a foreign view to THIS device's legal camera (zoom range + world bounds)", () => {
    const fake = fakeEngine();
    proto.applyView.call(fake, { tile: 100, floor: 20, zoom: 99 });
    expect(fake.engine.currentScene.camera.zoom).toBe(3); // MAX_ZOOM
    // A view over the top of the world pulls back inside the vertical bounds.
    proto.applyView.call(fake, { tile: 100, floor: 100, zoom: 0.3 });
    const cam = fake.engine.currentScene.camera;
    expect(cam.pos.y).toBeGreaterThanOrEqual(-(100 + 2) * FLOOR + 600 / 2 / 0.3);
  });

  it("a zoomless view (TDT import) keeps the session's current zoom", () => {
    const fake = fakeEngine();
    fake.engine.currentScene.camera.zoom = 1.4;
    proto.applyView.call(fake, { tile: 50, floor: 10 });
    expect(fake.engine.currentScene.camera.zoom).toBe(1.4);
  });

  it("adoptCamera policy: view restores, no view centers, keepCamera (undo) leaves the camera alone", () => {
    const fake: any = fakeEngine();
    fake.applyView = vi.fn();
    fake.center = vi.fn();
    proto.adoptCamera.call(fake, { tile: 1, floor: 2 });
    expect(fake.applyView).toHaveBeenCalledExactlyOnceWith({ tile: 1, floor: 2 });
    expect(fake.center).not.toHaveBeenCalled();

    proto.adoptCamera.call(fake, null);
    expect(fake.center).toHaveBeenCalledTimes(1);

    fake.applyView.mockClear();
    fake.center.mockClear();
    proto.adoptCamera.call(fake, { tile: 1, floor: 2 }, true);
    expect(fake.applyView).not.toHaveBeenCalled();
    expect(fake.center).not.toHaveBeenCalled();
  });
});

describe("TDT export/import carry the view words", () => {
  /** A realistic serialized tower (the sample fixture through the importer). */
  function sampleSave(): SerializedGame {
    const buf = buildTdt(sampleTowerSpec());
    return parseTDT(buf.buffer as ArrayBuffer, "SAMPLE.TDT").save;
  }

  it("buildTDT writes the save's view at 0x26/0x28, and the defaults when absent", () => {
    const save = sampleSave();
    delete save.view;
    const plain = buildTDT(save).bytes;
    expect(readHdrU16(plain, 0x26)).toBe(TDT_DEFAULT_VIEW_X);
    expect(readHdrU16(plain, 0x28)).toBe(TDT_DEFAULT_VIEW_Y);

    save.view = { tile: 200, floor: 20, zoom: 2 }; // zoom is dropped: 1994 has none
    const words = viewWordsFromView(save.view);
    const stamped = buildTDT(save).bytes;
    expect(readHdrU16(stamped, 0x26)).toBe(words.x);
    expect(readHdrU16(stamped, 0x28)).toBe(words.y);
  });

  it("parseTDT brings the words back as a zoomless view; absent words stay absent", () => {
    const words = viewWordsFromView({ tile: 200, floor: 20 });
    const withView = parseTDT(
      buildTdt({ ...sampleTowerSpec(), viewX: words.x, viewY: words.y }).buffer as ArrayBuffer,
      "VIEW.TDT",
    ).save;
    expect(withView.view!.tile).toBeCloseTo(200, 1);
    expect(withView.view!.floor).toBeCloseTo(20, 1);
    expect(withView.view!.zoom).toBeUndefined();

    const without = parseTDT(buildTdt(sampleTowerSpec()).buffer as ArrayBuffer, "PLAIN.TDT").save;
    expect("view" in without).toBe(false);
  });

  it("a full export/import round trip recovers the view within one tile/floor", () => {
    const save = sampleSave();
    save.view = { tile: 178, floor: 7 };
    const back = parseTDT(buildTDT(save).bytes.buffer as ArrayBuffer, "ROUND.TDT").save;
    expect(Math.abs(back.view!.tile - 178)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.view!.floor - 7)).toBeLessThanOrEqual(1);
  });

  it("an out-of-grid word pair clamps at the deserialize trust boundary", () => {
    // viewY = 1 decodes to a floor above our grid (the 1994 sky); the second
    // hardening layer (Simulation.deserialize) clamps it onto the lot.
    const save = parseTDT(
      buildTdt({ ...sampleTowerSpec(), viewX: 8, viewY: 1 }).buffer as ArrayBuffer,
      "SKY.TDT",
    ).save;
    expect(save.view!.floor).toBeGreaterThan(GRID.maxFloor); // raw decode is out of grid
    const sim = Simulation.deserialize(save);
    expect(sim.view!.floor).toBe(GRID.maxFloor);
    expect(sim.view!.tile).toBeGreaterThanOrEqual(0);
  });
});
