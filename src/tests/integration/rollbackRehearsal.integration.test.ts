import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildFactsOf, candidateSaves, loadEnginePackage } from "../../build/rollbackRehearsalNode.ts";
import { buildReport, rehearseCase, renderReport, type EnginePackage } from "../../build/rollbackRehearsal.ts";
import { REPO_ROOT } from "../conformance/scenario";
import { hasWasmPackage } from "../conformance/wasmEngine";

/**
 * The rollback rehearsal (#1221) against the real engine package: this
 * checkout stands in for both builds, so a tower the engine wrote must load,
 * play and save on the "previous" engine with no loss, and a previous engine
 * that does lose a field must be caught. The real previous build is a second
 * checkout (`npm run wasm:build` in it); the procedure is
 * `_bmad-output/planning-artifacts/release-3.0-rollback-rehearsal.md`.
 */

const last = <T,>(xs: readonly T[]): T | undefined => xs[xs.length - 1];
const HOURS = 2;
const FIXTURE_DIRS = ["conformance/fixtures", "conformance/fixtures/tdt-reddit"].map((d) => join(REPO_ROOT, d));
const ONLY = ["towerone-vip-pending.vctower", "split-tower.vctower", "TOWER5.TDT", "TOWER8.TDT"];

describe.skipIf(!hasWasmPackage())("rollback rehearsal on the real engine", () => {
  // Built in beforeAll, not in the suite body: a skipped suite's body still runs, and the package may be absent.
  let candidate!: ReturnType<typeof loadEnginePackage>;
  let saves: ReturnType<typeof candidateSaves> = [];
  beforeAll(() => {
    candidate = loadEnginePackage(REPO_ROOT, "candidate");
    saves = candidateSaves(candidate, FIXTURE_DIRS, HOURS, ONLY);
  });
  const facts = (label: string) => buildFactsOf(REPO_ROOT, label);

  it("makes a candidate-written save from a vctower and from an original .TDT", () => {
    expect(saves.map((s) => s.name).sort()).toEqual([...ONLY].sort());
    for (const s of saves) expect(JSON.parse(s.text)).toMatchObject({ version: 7, units: expect.any(Array) });
  });

  it("passes when the previous engine is the same build", () => {
    const cases = saves.map((s) => rehearseCase(s.name, s.text, candidate, candidate, { hours: HOURS, allowed: [] }));
    const report = buildReport(facts("previous"), facts("candidate"), HOURS, cases, []);
    expect(cases.filter((c) => !c.ok).map((c) => c.name)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(renderReport(report)).toContain("PASS");
  });

  it("catches a previous engine that drops a field the candidate wrote", () => {
    const loses: EnginePackage = {
      label: "previous",
      fromSave(text) {
        const engine = candidate.fromSave(text);
        return {
          serialize: () => {
            const save = JSON.parse(engine.serialize()) as Record<string, unknown>;
            delete save.towerName;
            delete save.money;
            return JSON.stringify(save);
          },
          tick: (m) => engine.tick(m),
          free: () => engine.free(),
        };
      },
    };
    const tower = saves.find((s) => s.name === "split-tower.vctower")!;
    const result = rehearseCase(tower.name, tower.text, loses, candidate, { hours: HOURS, allowed: [] });
    expect(result.ok).toBe(false);
    const dropped = result.steps.find((s) => s.step === "previous-read")?.judgement?.unexplained.map((e) => `${e.kind} ${e.path}`) ?? [];
    expect(dropped).toContain("dropped money");
  });

  it("is why the rehearsal looks for dropped fields: an engine loads a save with a field it does not know and quietly drops it", () => {
    const tower = saves.find((s) => s.name === "split-tower.vctower")!;
    const withExtra = { ...(JSON.parse(tower.text) as Record<string, unknown>), aFieldFromTheFuture: { keep: true } };
    const engine = candidate.fromSave(JSON.stringify(withExtra));
    const reread = JSON.parse(engine.serialize()) as Record<string, unknown>;
    engine.free();
    expect(reread.aFieldFromTheFuture).toBeUndefined();
  });

  it("refuses a save from a newer save version, which is why no save-format bump may ship", () => {
    const tower = saves.find((s) => s.name === "split-tower.vctower")!;
    const newer = { ...(JSON.parse(tower.text) as Record<string, unknown>), version: 99 };
    expect(() => candidate.fromSave(JSON.stringify(newer))).toThrow(/newer version/);
  });

  it("fails a previous engine that refuses what the candidate wrote", () => {
    const refuses: EnginePackage = {
      label: "previous",
      fromSave() {
        throw new Error("unknown save");
      },
    };
    const tower = saves[0]!;
    const result = rehearseCase(tower.name, tower.text, refuses, candidate, { hours: HOURS, allowed: [] });
    expect(result.ok).toBe(false);
    expect(last(result.steps)).toMatchObject({ step: "previous-load", ok: false });
  });
});
