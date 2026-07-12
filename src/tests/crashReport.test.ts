import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { Simulation } from "../engine/Simulation";
import { SaveGame } from "../storage/SaveGame";
import { buildCrashDetails, buildCrashReportZip, bugReportUrl } from "../game/crashReport";
import type { CrashDescription } from "../game/crashReport";

const CRASH: CrashDescription = { kind: "webgl-context-lost", repeat: false, saveFlushed: true };

describe("crash report packaging", () => {
  it("buildCrashDetails captures the build, the tower summary, and the frame-error trail", () => {
    const sim = new Simulation();
    sim.tower.towerName = "Crash Test Tower";
    sim.money = 424_242;
    const details = buildCrashDetails(sim, CRASH, {
      version: "9.9.9",
      speed: 3,
      frameErrors: [{ at: "2026-07-12T00:00:00.000Z", message: "boom" }],
    });
    expect(details.report).toBe("verticopolis-crash");
    expect(details.version).toBe("9.9.9");
    expect(details.crash).toEqual(CRASH);
    expect(details.tower.name).toBe("Crash Test Tower");
    expect(details.tower.money).toBe(424_242);
    expect(details.tower.units).toBe(sim.tower.units.length);
    expect(details.tower.speed).toBe(3);
    expect(details.recentFrameErrors).toEqual([{ at: "2026-07-12T00:00:00.000Z", message: "boom" }]);
    // createdAt must be a real ISO timestamp — it becomes the zip's filename stamp.
    expect(new Date(details.createdAt).toISOString()).toBe(details.createdAt);
  });

  it("the zip holds crash-report.json and a .vctower save that re-imports to the same tower", async () => {
    const sim = new Simulation();
    sim.money = 314_159;
    const details = buildCrashDetails(sim, CRASH, { version: "1.2.3", speed: 2, frameErrors: [] });
    const { filename, bytes } = await buildCrashReportZip(sim, details);
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
    // Simulate a browser without CompressionStream: SaveGame.export throws.
    const original = SaveGame.export;
    SaveGame.export = () => Promise.reject(new Error("no CompressionStream"));
    try {
      const details = buildCrashDetails(sim, CRASH, { version: "1.2.3", speed: 0, frameErrors: [] });
      const { bytes } = await buildCrashReportZip(sim, details);
      const files = unzipSync(bytes);
      expect(Object.keys(files).sort()).toEqual(["crash-report.json", "tower.json"]);
      const save = JSON.parse(strFromU8(files["tower.json"]));
      expect(save.money).toBe(271_828);
    } finally {
      SaveGame.export = original;
    }
  });

  it("bugReportUrl targets the bug-report form with the version and attach instructions prefilled", () => {
    const url = new URL(bugReportUrl({ version: "1.19.0", crash: { ...CRASH, repeat: true } }));
    expect(url.origin + url.pathname).toBe("https://github.com/maniator/verticopolis/issues/new");
    expect(url.searchParams.get("template")).toBe("bug_report.yml");
    expect(url.searchParams.get("version")).toBe("1.19.0");
    const what = url.searchParams.get("what-happened")!;
    expect(what).toContain("graphics context was lost");
    expect(what).toContain("crashed twice in a row");
    expect(what).toContain("attaching it to this issue");
  });
});
