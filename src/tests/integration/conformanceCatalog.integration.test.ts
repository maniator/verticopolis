import { afterAll, afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { catalogFor, householdPrice, transportBuildCost } from "../../engine/catalog";
import { ALL_KINDS, FACILITIES } from "../../engine/facilities";
import { Simulation } from "../../engine/Simulation";
import type { GameMode } from "../../engine/types";
import { digest } from "../conformance/canonical";
import { CONFORMANCE_DIR } from "../conformance/scenario";

/**
 * The catalog lock (#913): the canonical hash of each mode's catalog
 * (`catalogFor(mode)`, `src/engine/catalog.ts`) is pinned in
 * `conformance/catalog.json`, and the Rust engine (`engine-rs/src/catalog.rs`)
 * must hash the same, checked by its unit test and by the referee. A moved hash
 * means a price, size or build rule changed: regenerate with the scenario
 * lock's switch, `VC_CONFORMANCE_UPDATE=1 npx vitest run --project integration
 * conformance`, and commit the new lock with the Rust change in the same pull
 * request.
 */

const LOCK = resolve(CONFORMANCE_DIR, "catalog.json");
const UPDATE = process.env.VC_CONFORMANCE_UPDATE === "1";
if (UPDATE && process.env.CI) throw new Error("VC_CONFORMANCE_UPDATE is a local regeneration switch and never runs in CI");

const MODES: GameMode[] = ["classic", "modern"];
type Lock = { catalog: Record<GameMode, string> };
const lock: Lock | undefined = existsSync(LOCK) ? (JSON.parse(readFileSync(LOCK, "utf8")) as Lock) : undefined;
const fresh: Partial<Record<GameMode, string>> = {};

describe("catalog conformance", () => {
  let failed = false;
  afterEach((ctx) => {
    if (ctx.task.result?.state === "fail") failed = true;
  });
  afterAll(() => {
    if (!UPDATE) return;
    if (failed) throw new Error("catalog lock NOT written; a test in this run failed");
    const missing = MODES.filter((m) => fresh[m] === undefined);
    if (missing.length) throw new Error(`catalog lock NOT written; these modes did not finish: ${missing.join(", ")}`);
    writeFileSync(LOCK, `${JSON.stringify({ catalog: { classic: fresh.classic, modern: fresh.modern } }, null, 2)}\n`);
  });

  for (const mode of MODES) {
    it(`the ${mode} catalog matches its pinned hash`, () => {
      const hash = digest(catalogFor(mode));
      if (UPDATE) {
        fresh[mode] = hash;
        return;
      }
      expect(lock, "conformance/catalog.json is missing; regenerate it").toBeDefined();
      expect(Object.keys(lock!.catalog).sort()).toEqual([...MODES].sort());
      expect(hash).toBe(lock!.catalog[mode]);
    });
  }

  it("is plain JSON with one row per kind in catalog order", () => {
    for (const mode of MODES) {
      const c = catalogFor(mode);
      // No undefined, no functions, no shared references: a JSON round trip
      // gives back the same value.
      expect(JSON.parse(JSON.stringify(c))).toEqual(c);
      expect(c.facilities.map((f) => f.key)).toEqual(ALL_KINDS);
      for (const f of c.facilities) expect(f.cost).toBe(FACILITIES[f.key].cost);
    }
  });

  it("states the canon caps, pools, spans and cars", () => {
    const row = (k: string) => catalogFor("classic").facilities.find((f) => f.key === k)!;
    for (const k of ["elevatorStandard", "elevatorService", "elevatorExpress"]) {
      expect(row(k)).toMatchObject({ buildCap: 24, capPool: "elevator shafts", maxCars: 8, fixedSpan: false });
    }
    for (const k of ["stairs", "escalator"]) {
      expect(row(k)).toMatchObject({ buildCap: 64, capPool: "stairs/escalators", maxCars: null, maxSpan: 1, fixedSpan: true });
    }
    expect(row("elevatorStandard").maxSpan).toBe(30);
    expect(row("elevatorService").maxSpan).toBe(30);
    expect(row("elevatorExpress").maxSpan).toBe(109);
    expect(row("metro")).toMatchObject({ buildCap: 1, capPool: null });
    expect(row("office").buildCap).toBeNull();
  });

  it("resolves rent per mode", () => {
    const classic = catalogFor("classic").facilities.find((f) => f.key === "condo")!.rent!;
    expect(classic).toMatchObject({ shape: "ladder", default: 150_000, noRate: true, band: null, household: null, cadence: "sale" });
    const modern = catalogFor("modern").facilities.find((f) => f.key === "condo")!.rent!;
    expect(modern).toMatchObject({ shape: "band", default: 160_000, noRate: false, ladder: null, household: { sizes: [2, 3, 4, 5], reference: 3 } });
    const fit = catalogFor("classic").facilities.find((f) => f.key === "fitnessClub")!;
    expect(fit.available).toBe(false);
    expect(fit.rent).toBeNull();
    expect(householdPrice(160_000, 5)).toBe(266_667);
  });

  it("quotes what the build path charges for a shaft", () => {
    const sim = Simulation.newGame(7, "classic");
    sim.money = 10_000_000;
    sim.star = 5;
    for (let x = 150; x < 200; x++) for (let fl = 1; fl <= 12; fl++) sim.build("floor", fl, x);
    const before = sim.money;
    expect(sim.buildTransport("elevatorStandard", 160, 1, 11).ok).toBe(true);
    expect(before - sim.money).toBe(transportBuildCost("elevatorStandard", 10));
    expect(transportBuildCost("elevatorStandard", 10)).toBe(250_000);
    expect(transportBuildCost("stairs", 1)).toBe(5_000);
  });
});
