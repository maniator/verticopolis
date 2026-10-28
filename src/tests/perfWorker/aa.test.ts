import { describe, expect, it } from "vitest";
import { aggregate, ranOf, ratios, validate } from "./analysis";
import { comparability } from "./beforeAfter";
import { after, before } from "./beforeAfterFixture";
import { config as comparisonConfig, run } from "./analysisFixture";
import { AA_SLOTS, aaBanner, aaLimitation, checkAaFolder, parseAa } from "./aa";
import { limitations, makeConfig, metricsCsv, parseArgs, ratiosCsv } from "./main";
import { markdown } from "./report";
import type { ModeRun } from "./runner";

/** `perf:worker --aa ts|wasm` (#1111): the same mode in both slots, recorded under the slots' labels. */
const aaConfig = (aa: "ts" | "wasm") => makeConfig(parseArgs(["--aa", aa, "--reps", "6"]), ["small"]);
const slotRuns = (aa: "ts" | "wasm"): ModeRun[] =>
  Array.from({ length: 6 }, (_, rep) => AA_SLOTS.map((slot) => ({ ...run(rep, aa, 1 + rep / 100), mode: slot, ranMode: aa }))).flat();

describe("the arguments and the configuration", () => {
  it("takes --aa ts or --aa wasm and nothing else", () => {
    expect(parseArgs(["--aa", "wasm"]).aa).toBe("wasm");
    expect(parseArgs(["--aa", "ts"]).aa).toBe("ts");
    expect(parseArgs([]).aa).toBeNull();
    expect(() => parseArgs(["--aa", "wasm-worker"])).toThrow(/ts or wasm/);
    expect(() => parseArgs(["--aa"])).toThrow(/needs a value/);
    expect(() => parseAa("")).toThrow(/ts or wasm/);
    expect(() => parseArgs(["--aa", "ts", "--read-model"])).toThrow(/takes no --aa/);
  });

  it("runs the two slots, labelled ts and wasm, and records the mode in the configuration", () => {
    const c = aaConfig("wasm");
    expect(c.aa).toBe("wasm");
    expect(c.modes).toEqual(["ts", "wasm"]);
    expect(comparisonConfig.aa).toBeNull();
    expect(makeConfig(parseArgs(["--reps", "6"]), ["small"]).modes).toEqual(["ts", "wasm"]);
  });

  it("opens the limitations with the A/A line, which a comparison does not have", () => {
    expect(limitations(aaConfig("ts"))[0]).toBe(aaLimitation("ts"));
    expect(limitations(aaConfig("ts"))[0]).toMatch(/An A\/A pass: the TypeScript mode ran in both slots/);
    expect(limitations(comparisonConfig).some((l) => l.startsWith("An A/A pass"))).toBe(false);
  });
});

describe("the results folder name", () => {
  it("needs the marker for the mode in an explicit --out, and refuses it for a comparison", () => {
    expect(() => checkAaFolder("2026-10-21-aa-wasm-1", "wasm")).not.toThrow();
    expect(() => checkAaFolder("AA-TS-run", "ts")).not.toThrow();
    expect(() => checkAaFolder("pass-1", "wasm")).toThrow(/needs an --out folder name containing aa-wasm/);
    expect(() => checkAaFolder("aa-ts-aa-wasm", "wasm")).toThrow(/also names the aa-ts marker/);
    expect(() => checkAaFolder("candidate-aa-ts", null)).toThrow(/names an A\/A folder, but this run is a comparison/);
    expect(() => checkAaFolder("candidate", null)).not.toThrow();
  });
});

describe("the run records and validation", () => {
  it("reads the mode a run ran from ranMode, and from the slot in older results", () => {
    expect(ranOf({ mode: "ts", ranMode: "wasm" })).toBe("wasm");
    expect(ranOf({ mode: "ts" })).toBe("ts");
  });

  it("accepts runs that ran the asked-for mode and fails a slot that ran another", () => {
    const c = aaConfig("wasm");
    const asked = (runs: ModeRun[]) => validate(c, runs).errors.filter((e) => /was asked for/.test(e));
    expect(asked(slotRuns("wasm"))).toEqual([]);
    const wrong = slotRuns("wasm").map((r, i) => (i === 3 ? { ...r, ranMode: "ts" as const } : r));
    expect(asked(wrong)).toEqual(["rep 1 wasm: the run was asked for wasm but recorded ts"]);
    // A comparison needs each run to have run its own slot.
    const mixed = [{ ...run(0, "wasm", 1), ranMode: "ts" as const }];
    expect(validate({ ...comparisonConfig, reps: 1 }, mixed).errors.join()).toMatch(/rep 0 wasm: the run was asked for wasm but recorded ts/);
  });

  it("samples a slot by the mode it ran: a WASM run in the ts slot still has its linear memory", () => {
    const c = aaConfig("wasm");
    const combined = (slot: "ts" | "wasm") => aggregate(c, slotRuns("wasm")).find((m) => m.metric.startsWith("JS heaps + WASM") && m.mode === slot)!.values;
    expect(combined("ts")).toEqual(Array(6).fill(17));
    expect(combined("wasm")).toEqual(Array(6).fill(17));
  });
});

describe("the output", () => {
  const metrics = aggregate(aaConfig("wasm"), slotRuns("wasm"));
  const rr = ratios(metrics, ["ts", "wasm"]);

  it("adds an aa column to both CSVs, and says A/A where the verdict would be", () => {
    expect(metricsCsv(metrics, "wasm").split("\n")[0]).toMatch(/,unthrottled,values,aa$/);
    expect(metricsCsv(metrics, "wasm").trim().split("\n").slice(1).every((l) => l.endsWith(",wasm"))).toBe(true);
    const header = ratiosCsv(rr, "wasm").split("\n")[0];
    expect(header).toMatch(/,verdict,unthrottled,aa$/);
    const rows = ratiosCsv(rr, "wasm").trim().split("\n").slice(1);
    expect(rows.length).toBe(rr.length);
    expect(rows.every((l) => l.split(",").slice(-3)[0] === "A/A" && l.endsWith(",wasm"))).toBe(true);
    // A comparison's CSVs are unchanged.
    expect(metricsCsv(metrics).split("\n")[0]).toMatch(/,unthrottled,values$/);
    expect(ratiosCsv(rr).split("\n")[0]).toMatch(/,verdict,unthrottled$/);
  });

  it("leads the report with the A/A title and banner, names the slots and prints no verdict words", () => {
    const result = {
      schema: 1 as const, startedAt: "2026-10-21T10:00:00Z", generatedAt: "2026-10-21T14:00:00Z", config: aaConfig("wasm"), browser: { version: "141", executable: null },
      environment: { commitShort: "abc1234", appVersion: "2.40.0", dirty: false, enginePackage: {}, engineBuildHash: "h", cpuModel: "cpu", logicalCpus: 4, totalMemoryBytes: 2 ** 34, os: "linux", node: "22", playwright: "1.61" } as never,
      scenarios: [{ name: "small", sha256: "a".repeat(64), population: 10, units: 2, transports: 1, saveBytes: 5 }],
      scripts: { worker: { raw: 8000, brotli: 2600 }, otherJs: { raw: 1, brotli: 1 }, enginePackage: { raw: 900_000, brotli: 330_000 } }, runs: slotRuns("wasm"), metrics, ratios: rr, validation: { ok: true, errors: [], warnings: [] }, limitations: limitations(aaConfig("wasm")),
    };
    const md = markdown(result);
    expect(md.split("\n")[0]).toBe("# Worker host A/A pass (npm run perf:worker -- --aa wasm)");
    expect(md).toContain(aaBanner("wasm"));
    expect(md).toContain("| slot ts | slot wasm |");
    expect(md).toContain("slot wasm / slot ts (rates: ts / wasm)");
    const cells = md.split("\n").filter((l) => l.startsWith("| small |")).join("\n");
    expect(cells).toMatch(/\d\.\d\dx \[/);
    expect(cells).not.toMatch(/x(?: \[[^\]]+\])? (higher|lower|equivalent|inconclusive)/);
    // A comparison keeps its verdict words.
    const cmp = markdown({ ...result, config: comparisonConfig });
    expect(cmp.split("\n")[0]).toBe("# Worker host benchmark (npm run perf:worker)");
    expect(cmp).not.toContain("A/A pass.");
  });
});

describe("before and after", () => {
  it("refuses an A/A pass as either side", () => {
    const aa = (r: ReturnType<typeof before>) => ({ ...r, config: { ...r.config, aa: "wasm" as const } });
    expect(comparability(aa(before()), after(), 10).join(" ")).toMatch(/BEFORE is an A\/A pass \(wasm in both slots\), not a run of a build/);
    expect(comparability(before(), aa(after()), 10).join(" ")).toMatch(/AFTER is an A\/A pass/);
    expect(comparability(before(), after(), 10).join(" ")).not.toMatch(/A\/A/);
  });
});
