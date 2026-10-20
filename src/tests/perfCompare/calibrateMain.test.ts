import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stable } from "./calibrate";
import { main, parseCalibrateArgs } from "./calibrateMain";
import { many } from "./calibrateFixture";
import { workerPass } from "../perfWorker/calibrateM4Fixture";

describe("perf:calibrate", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  it("reads folders and a new --out", () => {
    expect(parseCalibrateArgs(["a", "b", "--out", "o"])).toEqual({ folders: ["a", "b"], out: "o" });
    expect(parseCalibrateArgs(["a", "--out", "o", "--min-passes", "20", "--exceedance-limit", "0.05"])).toEqual({ folders: ["a"], out: "o", minPassesPerEngine: 20, exceedanceLimit: 0.05 });
    for (const bad of [["--min-passes", "1"], ["--min-passes", "x"], ["--min-passes"], ["--exceedance-limit", "0"], ["--exceedance-limit", "1.5"], ["--min-passes", "5", "--min-passes", "6"]]) expect(() => parseCalibrateArgs(["a", "--out", "o", ...bad]), bad.join(" ")).toThrow(/--min-passes|--exceedance-limit/);
    expect(() => parseCalibrateArgs(["--out", "o"])).toThrow(/at least one/);
    expect(() => parseCalibrateArgs(["a"])).toThrow(/--out DIR is required/);
    expect(() => parseCalibrateArgs(["a", "--out"])).toThrow(/needs a value/);
    expect(() => parseCalibrateArgs(["a", "--out", "o", "--out", "p"])).toThrow(/given twice/);
    expect(() => parseCalibrateArgs(["a", "--fast"])).toThrow(/unknown argument --fast/);
  });


  it("writes calibration.json and calibration.md, never over an existing folder", () => {
    const repo = mkdtempSync(join(tmpdir(), "calibrate-"));
    dirs.push(repo);
    const names = many(40).map((f, i) => {
      mkdirSync(join(repo, `aa-${i}`));
      writeFileSync(join(repo, `aa-${i}`, "results.json"), JSON.stringify(f.results));
      return `aa-${i}`;
    });
    const limit = ["--exceedance-limit", "0.2"];
    // Twenty passes per engine meet the protocol's 5%; a looser limit is the owner's call, so it exits 1.
    expect(main([...names, "--out", "loose", ...limit], repo)).toBe(1);
    expect(main(names.slice(0, 10).concat(["--out", "strict"]), repo)).toBe(1);
    expect(main([...names, "--out", "cal"], repo, () => "2026-10-21T00:00:00Z")).toBe(0);
    expect(JSON.parse(readFileSync(join(repo, "cal", "calibration.json"), "utf8")).adoptable).toBe(true);
    expect(readFileSync(join(repo, "cal", "calibration.md"), "utf8")).toContain("# δ and ε calibration");
    expect(() => main([...names, "--out", "cal"], repo)).toThrow(/never overwritten/);
    expect(() => main(["missing", "--out", "cal2"], repo)).toThrow(/has no results.json/);
    expect(main(names.slice(0, 3).concat(["--out", "cal3"]), repo)).toBe(1);
    // A folder copied under another name is one pass, and the record keeps each input's hash.
    mkdirSync(join(repo, "copy"));
    writeFileSync(join(repo, "copy", "results.json"), readFileSync(join(repo, "aa-0", "results.json")));
    expect(main([...names, "copy", "--out", "cal4"], repo)).toBe(1);
    const cal = JSON.parse(readFileSync(join(repo, "cal4", "calibration.json"), "utf8"));
    expect(cal.excluded).toEqual([{ folder: "copy", reason: expect.stringMatching(/identical to aa-0's/), sha256: cal.passes[0].sha256 }]);
    expect(cal.passes[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    // A copy re-saved with CRLF line endings, other indentation and another key order is the same pass.
    mkdirSync(join(repo, "resaved"));
    const original = JSON.parse(readFileSync(join(repo, "aa-1", "results.json"), "utf8")) as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(original).reverse());
    writeFileSync(join(repo, "resaved", "results.json"), JSON.stringify(reordered, null, 4).replace(/\n/g, "\r\n"));
    expect(main([...names, "resaved", "--out", "cal7"], repo)).toBe(1);
    expect(JSON.parse(readFileSync(join(repo, "cal7", "calibration.json"), "utf8")).excluded).toEqual([{ folder: "resaved", reason: expect.stringMatching(/identical to aa-1's/), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    expect(stable({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stable({ a: [2, { c: 2, d: 1 }], b: 1 }));
    mkdirSync(join(repo, "bad"));
    writeFileSync(join(repo, "bad", "results.json"), "{}");
    expect(() => main(["bad", "--out", "cal5"], repo)).toThrow(/is not a perf:compare or perf:worker results.json/);
    writeFileSync(join(repo, "bad", "results.json"), "{");
    expect(() => main(["bad", "--out", "cal6"], repo)).toThrow(/not valid JSON/);
    // A UTF-8 byte order mark (PowerShell 5.1 writes one) does not abort the run.
    mkdirSync(join(repo, "bom"));
    writeFileSync(join(repo, "bom", "results.json"), `\uFEFF${JSON.stringify(many(1)[0].results)}`);
    expect(main([...names, "bom", "--out", "cal8"], repo)).toBe(1);
    expect(JSON.parse(readFileSync(join(repo, "cal8", "calibration.json"), "utf8")).excluded[0].reason).toMatch(/identical to aa-0/);
  });

  it("takes perf:worker folders beside perf:compare folders and needs both to pass", () => {
    const repo = mkdtempSync(join(tmpdir(), "calibrate-mixed-"));
    dirs.push(repo);
    const write = (name: string, results: unknown): string => {
      mkdirSync(join(repo, name));
      writeFileSync(join(repo, name, "results.json"), JSON.stringify(results));
      return name;
    };
    const compareFolders = many(40);
    const compare = compareFolders.map((f, i) => write(`aa-${i}`, f.results));
    // The worker folders share the compare folders' machine, browser and engine build unless a test changes one.
    const shared = compareFolders[0].results as unknown as { environment: Record<string, unknown>; browser: Record<string, unknown> };
    const worker = (diff4: number, tag = "", over: { cpu?: string; version?: string } = {}) =>
      Array.from({ length: 40 }, (_, i) => workerPass(i, { diff4 })).map((f) => {
        const r = f.results as unknown as { environment: Record<string, unknown>; browser: Record<string, unknown> };
        r.environment = { ...shared.environment, commit: "fff9999aaa", ...(over.cpu ? { cpuModel: over.cpu } : {}) };
        r.browser = { ...r.browser, version: over.version ?? shared.browser.version, executable: shared.browser.executable, channel: shared.browser.channel, args: shared.browser.args };
        return write(`${f.folder}-${diff4}${tag}`, f.results);
      });
    // Same machine, browser and build: the two halves join. The banner names both windows and both commits.
    expect(main([...compare, ...worker(3), "--out", "both"], repo, () => "2026-10-21T00:00:00Z")).toBe(0);
    const json = JSON.parse(readFileSync(join(repo, "both", "calibration.json"), "utf8"));
    expect(json.adoptable).toBe(true);
    expect(json.problems).toEqual([]);
    expect(json.missingFamilies).toEqual([]);
    expect(json.families.map((f: { id: string }) => f.id)).toContain("M1");
    expect(json.m4.family.candidate).toBe(5);
    const md = readFileSync(join(repo, "both", "calibration.md"), "utf8");
    expect(md).toContain("it covers M1, M2, M3, M4 and M5");
    expect(md).toContain("## M4 long-task ε");
    expect(md).toMatch(/Snapshot of perf:compare A\/A passes started .* to .*, commit [0-9a-f]{7}; perf:worker A\/A passes started 2026-10-21T01:00:00\.000Z to .*, commit fff9999;/);
    expect(md).toContain("pinned by calibrateM4.test.ts");
    expect(md).toContain("**Candidates pass every check of this tool.**");
    // A cap miss in the worker folders fails the whole command, the headline says so, and the problem is in the top-level list.
    expect(main([...compare, ...worker(80), "--out", "miss"], repo)).toBe(1);
    const miss = JSON.parse(readFileSync(join(repo, "miss", "calibration.json"), "utf8"));
    expect(miss.adoptable).toBe(false);
    expect(miss.m4.adoptable).toBe(false);
    expect(miss.problems.some((p: string) => /^perf:worker folders: M4: the candidate 80 ms is above its cap/.test(p))).toBe(true);
    const missMd = readFileSync(join(repo, "miss", "calibration.md"), "utf8");
    expect(missMd).toContain("**Not adoptable yet.** See the problems below.");
    expect(missMd).not.toContain("**Candidates pass every check of this tool.**");
    expect(missMd).toMatch(/## Problems\n\n(- .*\n)*- perf:worker folders: M4: the candidate 80 ms/);
    // Halves from another machine or browser build do not join, even though each half passes alone.
    expect(main([...compare, ...worker(3, "-b", { cpu: "other cpu", version: "150.0.1" }), "--out", "apart"], repo)).toBe(1);
    const apart = JSON.parse(readFileSync(join(repo, "apart", "calibration.json"), "utf8"));
    expect(apart.m4.adoptable).toBe(true);
    expect(apart.adoptable).toBe(false);
    expect(apart.problems).toHaveLength(1);
    expect(apart.problems[0]).toMatch(/perf:compare passes \(commit [0-9a-f]{7}\) and the perf:worker passes \(commit fff9999\) differ in machine or runtime; browser/);
    // A worker-only run says which families it cannot speak for.
    expect(main([...worker(3, "-c"), "--out", "alone"], repo)).toBe(0);
    expect(JSON.parse(readFileSync(join(repo, "alone", "calibration.json"), "utf8")).missingFamilies).toEqual(["M1", "M2", "M3", "M5-1x", "M5-4x"]);
  });
});
