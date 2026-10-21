import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { repoRel, sourceFiles } from "./guardFiles";
import { isTestFile } from "./importScan";

/**
 * Player commands reach the engine through the port (AD-9, facade slice 2):
 * the frontend sends `port.command()` and reads only its answer, so the
 * engine behind the port accepts or refuses each one. This guard fails when a
 * frontend file calls a command method on a simulation or tower again
 * (`sim.build(`, `getSim().tower.setStop(`, `simAtLoss.emit(`), or writes one
 * of the settings a command owns (`sim.view =`, `tower.towerName =`).
 *
 * It scans every non-test file under `src/` except the engine, the port
 * itself, the host, dual-run and save code and the test tree, the same
 * frontend the engine-import guard reads. It matches by text, on a receiver
 * whose name contains `sim` or is `tower`, so a call through some other alias
 * is a review matter; it is a tripwire for the common shapes.
 *
 * The lifecycle writes (a load's or an import's bulletin, the camera a save
 * carries, the bridging preference a tower swap carries) are slice 5's, which
 * queues them on the port; {@link LIFECYCLE} pins them, by file and member,
 * with how many each file holds. The list only shrinks: a stale entry fails
 * too, so it goes with the write.
 */
const NOT_FRONTEND = ["src/engine/", "src/simport/", "src/tests/", "src/wasmhost/", "src/dualrun/", "src/storage/"] as const;

/** The instance's command methods, the port's commands and the raw edits
 *  behind them (tests and tooling only). */
const METHODS = [
  "build",
  "buildTransport",
  "removeFacility",
  "beginExtend",
  "extendTransport",
  "endExtend",
  "addCar",
  "removeCar",
  "setStop",
  "setExpressStops",
  "clearStops",
  "setSchedule",
  "setLabel",
  "adjustRent",
  "setNoRate",
  "priceUnit",
  "applyRentBatch",
  "setFilmPolicy",
  "rerollSubtype",
  "callExterminator",
  "resolveChoice",
  "toggleAutoBridge",
  "emit",
  "sellAt",
  "setCars",
  "resizeTransport",
  "removeUnit",
  "removeTransport",
  "place",
  "placeTransport",
] as const;

const RECEIVER = String.raw`\b(?:[A-Za-z_$]*[Ss]im[A-Za-z_$0-9]*(?:\(\))?|tower)`;
const CALL = new RegExp(String.raw`${RECEIVER}\s*\.\s*(${METHODS.join("|")})\s*\(`, "g");
const WRITE = new RegExp(String.raw`${RECEIVER}\s*\.\s*(towerName|autoBridge|view|money)\s*=(?!=)`, "g");

/** Slice 5's lifecycle writes, as `file member` (a write as `member=`). */
const LIFECYCLE: ReadonlyMap<string, number> = new Map([
  ["src/game/appBoot.ts emit", 1],
  ["src/game/legacyImportAdopt.ts emit", 1],
  ["src/game/saveLoad.ts emit", 1],
  ["src/game/saveLoad.ts view=", 1],
  ["src/game/appModals.ts view=", 1],
  ["src/main.ts autoBridge=", 1],
]);

/** Every direct command or settings write in the frontend, counted as
 *  `file member`. Comments are skipped line by line, so prose that names a
 *  call does not count. */
function scan(): Map<string, number> {
  const found = new Map<string, number>();
  for (const abs of sourceFiles("src", [".ts"])) {
    const rel = repoRel(abs);
    if (NOT_FRONTEND.some((dir) => rel.startsWith(dir)) || isTestFile(rel)) continue;
    const code = readFileSync(abs, "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    for (const m of code.matchAll(CALL)) bump(found, `${rel} ${m[1]}`);
    for (const m of code.matchAll(WRITE)) bump(found, `${rel} ${m[1]}=`);
  }
  return found;
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

describe("command sites", () => {
  it("sends every player command through the port, apart from slice 5's lifecycle writes", () => {
    const found = scan();
    const extra = [...found].filter(([key, n]) => n > (LIFECYCLE.get(key) ?? 0)).map(([key, n]) => `${key} (${n})`);
    expect(extra, "a frontend file calls a command on the simulation or tower; send it through port.command()").toEqual([]);
  });

  it("names no lifecycle write that is gone", () => {
    const found = scan();
    const stale = [...LIFECYCLE].filter(([key, n]) => (found.get(key) ?? 0) < n).map(([key]) => key);
    expect(stale, "a lifecycle write moved to the port; drop or lower its entry").toEqual([]);
  });

  it("catches the shapes it promises", () => {
    const sample = ["sim.build(kind, 2, 5);", "this.deps.getSim().tower.setStop(id, 2, false);", "simAtLoss.emit(text);", "app.sim.view = v;", "sim.tower.towerName = name;"].join("\n");
    expect([...sample.matchAll(CALL)].map((m) => m[1])).toEqual(["build", "setStop", "emit"]);
    expect([...sample.matchAll(WRITE)].map((m) => m[1])).toEqual(["view", "towerName"]);
    expect([..."app.port.command({ op: \"build\" }); x.view == y; app.build.tryBuild(k);".matchAll(CALL)]).toEqual([]);
  });
});
