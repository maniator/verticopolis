import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { Simulation } from "../../engine/Simulation";
import { SaveGame } from "../../storage/SaveGame";
import { buildCrashDetails, buildCrashReportZip, bugReportUrl } from "../../game/crashReport";
import type { CrashDescription, CrashEngines, CrashTower, RustCrashDescription } from "../../game/crashReport";
import { facilityFloors } from "../../engine/facilities";
import { TsEngine } from "../../engine/port/tsEngine";
import { ViewReader } from "../../simport/viewReader";

/** The crash report's view of `sim`, through the port as the game reads it. */
function towerOf(sim: Simulation): CrashTower {
  const port = new TsEngine(sim);
  return { port, view: new ViewReader(port, facilityFloors) };
}

const CRASH: CrashDescription = { kind: "webgl-context-lost", repeat: false, saveFlushed: true, behindSplash: false, recoveryFailed: false };

describe("crash report packaging", () => {
  it("buildCrashDetails captures the build, the tower summary, and the frame-error trail", () => {
    const sim = new Simulation();
    sim.tower.towerName = "Crash Test Tower";
    sim.money = 424_242;
    const tower = towerOf(sim);
    const details = buildCrashDetails(tower, CRASH, {
      version: "9.9.9",
      speed: 3,
      frameErrors: [{ at: "2026-07-12T00:00:00.000Z", message: "boom" }],
    });
    expect(details.report).toBe("verticopolis-crash");
    expect(details.version).toBe("9.9.9");
    expect(details.crash).toEqual(CRASH);
    expect(details.tower?.name).toBe("Crash Test Tower");
    expect(details.tower?.money).toBe(424_242);
    expect(details.tower?.units).toBe(sim.tower.units.length);
    expect(details.tower?.speed).toBe(3);
    expect(details.recentFrameErrors).toEqual([{ at: "2026-07-12T00:00:00.000Z", message: "boom" }]);
    // createdAt must be a real ISO timestamp; it becomes the zip's filename stamp.
    expect(new Date(details.createdAt).toISOString()).toBe(details.createdAt);
  });

  it("the zip holds crash-report.json and a .vctower save that re-imports to the same tower", async () => {
    const sim = new Simulation();
    sim.money = 314_159;
    const tower = towerOf(sim);
    const details = buildCrashDetails(tower, CRASH, { version: "1.2.3", speed: 2, frameErrors: [] });
    const { filename, bytes } = await buildCrashReportZip(tower, details);
    expect(filename).toMatch(/^verticopolis-crash-report-[\d-]+\.zip$/);
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(["crash-report.json", "tower.vctower"]);
    const report = JSON.parse(strFromU8(files["crash-report.json"]));
    expect(report.version).toBe("1.2.3");
    expect(report.tower.money).toBe(314_159);
    // The save inside the zip is a first-class .vctower: the normal import
    // path must accept it and reproduce the tower.
    const imported = await SaveGame.import(strFromU8(files["tower.vctower"]));
    expect(imported.money).toBe(314_159);
  });

  it("falls back to raw tower.json when the .vctower container can't be built", async () => {
    const sim = new Simulation();
    sim.money = 271_828;
    const tower = towerOf(sim);
    // Simulate a browser without CompressionStream: SaveGame.export throws.
    const original = SaveGame.export;
    SaveGame.export = () => Promise.reject(new Error("no CompressionStream"));
    try {
      const details = buildCrashDetails(tower, CRASH, { version: "1.2.3", speed: 0, frameErrors: [] });
      const { bytes } = await buildCrashReportZip(tower, details);
      const files = unzipSync(bytes);
      expect(Object.keys(files).sort()).toEqual(["crash-report.json", "tower.json"]);
      const save = JSON.parse(strFromU8(files["tower.json"]));
      expect(save.money).toBe(271_828);
    } finally {
      SaveGame.export = original;
    }
  });

  it("still builds the report when the engine cannot be read, with the reason in place of the tower", async () => {
    const trapped = (): never => {
      throw new Error("unreachable executed");
    };
    const view = { get header(): never { return trapped(); }, get tower(): never { return trapped(); } };
    const tower = { view, port: { serialize: trapped } };
    const details = buildCrashDetails(tower, CRASH, { version: "1.2.3", speed: 1, frameErrors: [] });
    expect(details.tower).toBeNull();
    expect(details.towerError).toBe("unreachable executed");
    const files = unzipSync((await buildCrashReportZip(tower, details)).bytes);
    expect(Object.keys(files).sort()).toEqual(["crash-report.json", "tower-unavailable.txt"]);
    expect(strFromU8(files["tower-unavailable.txt"])).toContain("unreachable executed");
  });

  it("bugReportUrl targets the bug-report form with the version and attach instructions prefilled", () => {
    const url = new URL(bugReportUrl({ version: "1.20.0", crash: { ...CRASH, repeat: true } }));
    expect(url.origin + url.pathname).toBe("https://github.com/maniator/verticopolis/issues/new");
    expect(url.searchParams.get("template")).toBe("bug_report.yml");
    expect(url.searchParams.get("version")).toBe("1.20.0");
    const what = url.searchParams.get("what-happened")!;
    expect(what).toContain("graphics context was lost");
    expect(what).toContain("crashed twice in a row");
    expect(what).toContain("attaching it to this issue");
  });

  const RUST_CRASH: RustCrashDescription = { kind: "rust-engine-trap", crashes: 2, reason: "trap-tick", stage: "start" };
  const ENGINES: CrashEngines = { rust: { version: "0.21.0", sourceHash: "d".repeat(64) }, typescript: { version: "2.0", sources: "e".repeat(64) } };

  it("a Rust crash report names both engines and the fault, with the running engine's save", async () => {
    const sim = new Simulation();
    sim.tower.towerName = "Held Tower";
    const tower = towerOf(sim);
    const details = buildCrashDetails(tower, RUST_CRASH, { version: "2.53.0", speed: 1, frameErrors: [], engines: ENGINES });
    expect(details.crash).toEqual(RUST_CRASH);
    expect(details.engines).toEqual(ENGINES);
    const files = unzipSync((await buildCrashReportZip(tower, details)).bytes);
    expect(JSON.parse(strFromU8(files["crash-report.json"]))).toMatchObject({ crash: RUST_CRASH, engines: ENGINES, tower: { name: "Held Tower" } });
    expect(files["tower.vctower"]).toBeDefined();
  });

  it("bugReportUrl titles a Rust crash and names its engine and fault", () => {
    const url = new URL(bugReportUrl({ version: "2.53.0", crash: RUST_CRASH, engines: ENGINES }));
    expect(url.searchParams.get("title")).toBe("Rust engine crashed");
    const what = url.searchParams.get("what-happened")!;
    expect(what).toContain("crashed 2 times, so the game switched to the TypeScript engine");
    expect(what).toContain(`Rust engine: 0.21.0, source ${"d".repeat(12)}. Fault: trap-tick at start.`);
    expect(what).toContain("attaching it to this issue");
    // An engine the boot could not name still reads.
    const unnamed = new URL(bugReportUrl({ version: "2.53.0", crash: RUST_CRASH, engines: { ...ENGINES, rust: { version: null, sourceHash: null } } }));
    expect(unnamed.searchParams.get("what-happened")).toContain("Rust engine: version unknown. Fault:");
  });
});
