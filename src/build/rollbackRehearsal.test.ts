import { describe, expect, it } from "vitest";
import type { CompatRecord } from "./engineCompat.ts";
import {
  buildReport,
  diffSaves,
  judgeDiffs,
  parseAllowedLosses,
  preflight,
  renderReport,
  rehearseCase,
  staleAllowances,
  type AllowedLoss,
  type BuildFacts,
  type EngineHandle,
  type EnginePackage,
} from "./rollbackRehearsal.ts";

const compat = (over: Partial<CompatRecord> = {}): CompatRecord => ({
  crateVersion: "1.5.2",
  lockDigest: "x",
  saveVersion: 7,
  oldestSaveVersion: 1,
  frameLayoutVersion: 1,
  viewLayoutVersion: 8,
  catalogVersion: 5,
  identitySchema: 1,
  interfaceDigest: "y",
  ...over,
});
const facts = (label: string, appVersion: string, over: Partial<CompatRecord> = {}): BuildFacts => ({ label, appVersion, compat: compat(over) });

/** An engine double: loads JSON, optionally rewrites it on the way out, and counts the minutes played. */
function fakePackage(label: string, rewrite: (save: Record<string, unknown>) => Record<string, unknown> = (s) => s, refuse?: string): EnginePackage {
  return {
    label,
    fromSave(text: string): EngineHandle {
      if (refuse) throw new Error(refuse);
      let save = JSON.parse(text) as Record<string, unknown>;
      return {
        serialize: () => JSON.stringify(rewrite(save)),
        tick(minutes: number) {
          save = { ...save, minutes: (save.minutes as number) + minutes };
        },
        free() {},
      };
    },
  };
}

/** The final step of a case. */
const last = <T,>(xs: readonly T[]): T | undefined => xs[xs.length - 1];

const TOWER = JSON.stringify({ version: 7, minutes: 100, money: 5000, towerName: "Test", units: [{ id: 1, kind: "office", x: 3 }, { id: 2, kind: "condo", x: 9, rent: 120 }], extra: { booked: [4, 5] } });

describe("diffSaves", () => {
  it("finds nothing between equal saves, ignoring key order", () => {
    expect(diffSaves(JSON.parse('{"a":1,"b":[1,2]}'), JSON.parse('{"b":[1,2],"a":1.0}'))).toEqual([]);
  });

  it("names dropped, added and changed paths with indices folded", () => {
    const before = { money: 1, units: [{ id: 1, rent: 5 }, { id: 2, rent: 6 }], booked: [1] };
    const after = { money: 2, units: [{ id: 1 }, { id: 2 }], fresh: true };
    const found = diffSaves(before, after);
    const by = (kind: string, path: string) => found.find((e) => e.kind === kind && e.path === path);
    expect(by("changed", "money")?.count).toBe(1);
    expect(by("dropped", "units[].rent")).toMatchObject({ count: 2, example: "units[0].rent: 5 -> (absent)" });
    expect(by("dropped", "booked")?.count).toBe(1);
    expect(by("added", "fresh")?.count).toBe(1);
  });

  it("reports a list of another length once, at the list's path", () => {
    expect(diffSaves({ units: [1, 2, 3] }, { units: [1, 2] })).toEqual([{ kind: "changed", path: "units[] length", count: 1, example: "units: 3 -> 2" }]);
  });

  it("treats a type change as a change", () => {
    expect(diffSaves({ a: 1 }, { a: "1" })[0]).toMatchObject({ kind: "changed", path: "a" });
    expect(diffSaves(null, 3)[0]).toMatchObject({ kind: "changed", path: "(root)" });
  });

  it("refuses an absurdly deep save instead of overflowing the stack", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100; i++) deep = { n: deep };
    expect(() => diffSaves(deep, deep)).toThrow(/nests deeper/);
  });
});

describe("judgeDiffs", () => {
  const allowed: AllowedLoss[] = [{ id: "EX-1", kind: "dropped", path: "extra.booked", reason: "an older build ignores the list" }];

  it("accepts only the named kind and path, and never fails on an addition", () => {
    const entries = diffSaves({ extra: { booked: [1] }, money: 1 }, { extra: {}, money: 2, more: 1 });
    const j = judgeDiffs(entries, allowed);
    expect(j.explained.map((e) => e.allowed.id)).toEqual(["EX-1"]);
    expect(j.unexplained.map((e) => e.path)).toEqual(["money"]);
    expect(j.added.map((e) => e.path)).toEqual(["more"]);
  });

  it("does not let a changed value hide behind a dropped-field allowance", () => {
    const j = judgeDiffs(diffSaves({ extra: { booked: [1] } }, { extra: { booked: [2] } }), allowed);
    expect(j.explained).toEqual([]);
    expect(j.unexplained).toHaveLength(1);
  });
});

describe("parseAllowedLosses", () => {
  it("accepts a complete entry", () => {
    expect(parseAllowedLosses([{ id: "EX-1", kind: "dropped", path: "a.b", reason: "why" }])).toHaveLength(1);
  });

  it.each([
    ["not a list", {}],
    ["no exception id", [{ id: "x", kind: "dropped", path: "a", reason: "r" }]],
    ["an added kind", [{ id: "EX-2", kind: "added", path: "a", reason: "r" }]],
    ["no path", [{ id: "EX-2", kind: "dropped", path: "", reason: "r" }]],
    ["no reason", [{ id: "EX-2", kind: "dropped", path: "a", reason: " " }]],
    ["a non-object entry", [3]],
  ])("rejects %s", (_name, raw) => {
    expect(() => parseAllowedLosses(raw)).toThrow();
  });
});

describe("preflight", () => {
  const fails = (a: BuildFacts, b: BuildFacts) => preflight(a, b).filter((f) => f.level === "fail");

  it("passes when both builds write the same save version", () => {
    expect(fails(facts("prev", "2.77.4", { crateVersion: "1.5.1" }), facts("cand", "2.78.0"))).toEqual([]);
  });

  it("fails a save-format bump", () => {
    const found = fails(facts("prev", "2.77.4", { crateVersion: "1.5.1" }), facts("cand", "3.0.0", { saveVersion: 8 }));
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toMatch(/save-format bump/);
  });

  it("fails swapped arguments and notes a differing layout", () => {
    expect(fails(facts("prev", "3.0.0"), facts("cand", "2.77.4", { crateVersion: "1.4.0" })).map((f) => f.message)[0]).toMatch(/may be swapped/);
    const notes = preflight(facts("prev", "2.77.4", { crateVersion: "1.5.1", catalogVersion: 4 }), facts("cand", "2.78.0")).map((f) => f.message);
    expect(notes.some((m) => /catalog version differs/.test(m))).toBe(true);
  });
});

describe("rehearseCase", () => {
  const opts = { hours: 1, allowed: [] as AllowedLoss[] };

  it("passes when the previous build keeps every field", () => {
    const r = rehearseCase("tower", TOWER, fakePackage("prev"), fakePackage("cand"), opts);
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => s.step)).toEqual(["candidate-read", "previous-load", "previous-read", "previous-play", "roll-forward"]);
  });

  it("fails on a field the previous build drops, and passes once the loss is accepted", () => {
    const dropsBooked = fakePackage("prev", (s) => ({ ...s, extra: {} }));
    const bad = rehearseCase("tower", TOWER, dropsBooked, fakePackage("cand"), opts);
    expect(bad.ok).toBe(false);
    expect(bad.steps.find((s) => s.step === "previous-read")?.judgement?.unexplained[0]).toMatchObject({ kind: "dropped", path: "extra.booked" });

    const allowed: AllowedLoss[] = [{ id: "EX-9", kind: "dropped", path: "extra.booked", reason: "test" }];
    const good = rehearseCase("tower", TOWER, dropsBooked, fakePackage("cand"), { hours: 1, allowed });
    expect(good.ok).toBe(true);
    expect(staleAllowances(allowed, [good])).toEqual([]);
    expect(staleAllowances(allowed, [rehearseCase("tower", TOWER, fakePackage("prev"), fakePackage("cand"), { hours: 1, allowed })])).toEqual(allowed);
  });

  it("fails on a value the previous build changes while only reading", () => {
    const rewrites = fakePackage("prev", (s) => ({ ...s, money: 0 }));
    const r = rehearseCase("tower", TOWER, rewrites, fakePackage("cand"), opts);
    expect(r.ok).toBe(false);
    expect(r.steps.find((s) => s.step === "previous-read")?.judgement?.unexplained[0]?.path).toBe("money");
  });

  it("reports the save size in UTF-8 bytes", () => {
    const save = JSON.stringify({ towerName: "Tôkyô é", money: 1 });
    const r = rehearseCase("tower", save, fakePackage("prev"), fakePackage("cand"), opts);
    expect(r.bytes).toBe(new TextEncoder().encode(save).length);
    expect(r.bytes).toBeGreaterThan(save.length);
  });

  it("fails when the previous build refuses the save", () => {
    const r = rehearseCase("tower", TOWER, fakePackage("prev", undefined, "version 9 is unknown"), fakePackage("cand"), opts);
    expect(r.ok).toBe(false);
    expect(last(r.steps)).toEqual({ step: "previous-load", ok: false, error: "prev refused the save: version 9 is unknown" });
  });

  it("fails when the previous build traps while playing", () => {
    const traps: EnginePackage = {
      label: "prev",
      fromSave: () => ({
        serialize: () => TOWER,
        tick() {
          throw new Error("unreachable");
        },
        free() {},
      }),
    };
    const r = rehearseCase("tower", TOWER, traps, fakePackage("cand"), opts);
    expect(r.ok).toBe(false);
    expect(last(r.steps)).toMatchObject({ step: "previous-play", ok: false, error: "prev failed while playing: unreachable" });
  });

  it("fails the case, not the run, when serialize traps", () => {
    const traps: EnginePackage = {
      label: "prev",
      fromSave: () => ({
        serialize() {
          throw new Error("memory access out of bounds");
        },
        tick() {},
        free() {},
      }),
    };
    const r = rehearseCase("tower", TOWER, traps, fakePackage("cand"), opts);
    expect(r.ok).toBe(false);
    expect(last(r.steps)).toMatchObject({ step: "previous-read", ok: false, error: "prev failed while serializing: memory access out of bounds" });
  });

  it("fails when the candidate cannot read what the previous build wrote", () => {
    let loads = 0;
    const base = fakePackage("cand");
    const picky: EnginePackage = {
      label: "cand",
      fromSave(text) {
        if (++loads > 1) throw new Error("no thanks");
        return base.fromSave(text);
      },
    };
    const r = rehearseCase("tower", TOWER, fakePackage("prev"), picky, opts);
    expect(last(r.steps)).toMatchObject({ step: "roll-forward", ok: false, error: "cand refused the save: no thanks" });
  });

  it("fails when the candidate drops a field the previous build wrote", () => {
    const r = rehearseCase("tower", TOWER, fakePackage("prev"), fakePackage("cand", (s) => ({ ...s, towerName: undefined })), opts);
    expect(last(r.steps)?.judgement?.unexplained[0]).toMatchObject({ kind: "dropped", path: "towerName" });
  });

  it("fails on text that is not JSON", () => {
    expect(rehearseCase("bad", "{", fakePackage("prev"), fakePackage("cand"), opts).ok).toBe(false);
  });

  it("does not blame the previous build for the candidate's own normalization", () => {
    const normalizes = fakePackage("cand", (s) => ({ ...s, milestones: [1, 2, 3] }));
    const same = fakePackage("prev", (s) => ({ ...s, milestones: [1, 2, 3] }));
    const save = JSON.stringify({ version: 7, minutes: 0, milestones: [1, 2] });
    expect(rehearseCase("t", save, same, normalizes, opts).ok).toBe(true);
    expect(rehearseCase("t", save, fakePackage("prev"), normalizes, opts).ok).toBe(false);
  });

  it("fails when the candidate refuses its own save", () => {
    const r = rehearseCase("t", TOWER, fakePackage("prev"), fakePackage("cand", undefined, "bad"), opts);
    expect(r.steps).toEqual([{ step: "candidate-read", ok: false, error: "cand refused the save: bad" }]);
  });

  it("plays the clock forward by the requested hours", () => {
    let seen = 0;
    const counts: EnginePackage = {
      label: "prev",
      fromSave: () => ({
        serialize: () => JSON.stringify({ minutes: seen }),
        tick(m) {
          seen += m;
        },
        free() {},
      }),
    };
    rehearseCase("t", JSON.stringify({ minutes: 0 }), counts, fakePackage("cand"), { hours: 3, allowed: [] });
    expect(seen).toBe(180);
  });
});

describe("buildReport and renderReport", () => {
  const prev = facts("prev", "2.77.4", { crateVersion: "1.5.1" });
  const cand = facts("cand", "2.78.0");

  it("is a pass only with a passing preflight and at least one passing case", () => {
    const ok = rehearseCase("a|b", TOWER, fakePackage("prev"), fakePackage("cand"), { hours: 1, allowed: [] });
    expect(buildReport(prev, cand, 1, [ok], []).ok).toBe(true);
    expect(buildReport(prev, cand, 1, [], []).ok).toBe(false);
    expect(buildReport(prev, facts("cand", "3.0.0", { saveVersion: 8 }), 1, [ok], []).ok).toBe(false);
  });

  it("prints the verdict, the table and every loss with its exception id", () => {
    const allowed: AllowedLoss[] = [{ id: "EX-9", kind: "dropped", path: "extra.booked", reason: "test reason" }];
    const dropsBooked = fakePackage("prev", (s) => ({ ...s, extra: {}, money: 1 }));
    const failing = rehearseCase("a|b", TOWER, dropsBooked, fakePackage("cand"), { hours: 1, allowed });
    const text = renderReport(buildReport(prev, cand, 1, [failing], [...allowed, { id: "EX-8", kind: "dropped", path: "gone", reason: "r" }]));
    expect(text).toContain("FAIL");
    expect(text).toContain("a\\|b");
    expect(text).toContain("UNEXPLAINED changed `money`");
    expect(text).toContain("accepted dropped `extra.booked` (1) under EX-9: test reason");
    expect(text).toContain("EX-8 dropped `gone`");
    expect(text).not.toMatch(/—/);
  });
});
