import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BINDING_EXPORT_TIERS, GENERATED_EXPORTS, exportsInTier, type BindingExport } from "../dualrun/exportTiers";
import { repoRoot, repoRel, sourceFiles } from "./guardFiles";

/**
 * The WASM binding's export tiers (#946, cutover plan story S10).
 *
 * 1. Every export `engine-rs/src/wasm.rs` declares is in the tier table
 *    (`src/dualrun/exportTiers.ts`), and every table entry is still exported.
 *    The parse reads the module functions under `#[wasm_bindgen]` and every
 *    `pub fn` of a `#[wasm_bindgen] impl` block, by its `js_name` when it has
 *    one and by its Rust name when it has none (`tick`, `serialize`).
 * 2. No source outside the allowed scope calls a tier 3 op, on the binding or
 *    on the TypeScript instance the relay mirrors, and none assigns
 *    `.money` (the relay turns that write into `setMoney`). The allowed
 *    scope: the TypeScript engine itself (`src/engine/`, whose own calls are
 *    its implementation), the relay (`src/dualrun/`), the host and its
 *    suppressed frame sync (`src/wasmhost/`), the generated package
 *    (`src/public/`), tests (`src/tests/`, `*.test.*`, `e2e/`) and the
 *    tooling (`scripts/`). Everything else tracked under `src/`, `api/` and
 *    `tools/` is scanned: the UI, the game, the renderer, storage, the boot.
 * 3. Only that same scope imports the binding's declaration (`dualrun/binding`
 *    or `dualrun/engine`), so the UI and game cannot hold a binding instance
 *    and reach tier 2's host loop or anything else on it directly.
 *
 * The matcher reads call and write shapes written out (`x.setCars(`,
 * `x.money = `, `x.money += `, `++x.money`); a computed member
 * (`x["setCars"]`) or a write through `Object.assign` is out of its reach, as
 * with the other source guards.
 */

const WASM_RS = "engine-rs/src/wasm.rs";
const ALLOWED_DIRS = ["src/engine/", "src/dualrun/", "src/wasmhost/", "src/public/", "src/tests/"];
const SCANNED_TREES = ["src", "api", "tools"];
const SOURCE = /\.(m|c)?[jt]sx?$/;
const TEST = /\.test\.(m|c)?[jt]sx?$/;

/** The JavaScript names `wasm.rs` exports, in source order. An item under
 *  `#[cfg(test)]` is skipped: it never reaches a build. */
function parseBindingExports(rust: string): string[] {
  const names: string[] = [];
  const jsName = (attrs: string[]): string | undefined => {
    for (const a of attrs) {
      const m = /js_name\s*=\s*"?([A-Za-z_$][\w$]*)"?/.exec(a);
      if (m) return m[1];
    }
    return undefined;
  };
  const isComment = (line: string) => /^\s*(\/\/|$)/.test(line);
  let attrs: string[] = [];
  let inImpl = false;
  for (const line of rust.split("\n")) {
    if (inImpl) {
      if (/^\}/.test(line)) {
        inImpl = false;
        attrs = [];
      } else if (/^ {4}#\[/.test(line)) {
        attrs.push(line);
      } else if (!isComment(line)) {
        const fn = /^ {4}pub fn (\w+)/.exec(line);
        if (fn && !attrs.some((a) => /wasm_bindgen\([^)]*\bskip\b/.test(a))) names.push(jsName(attrs) ?? fn[1]);
        attrs = [];
      }
      continue;
    }
    if (/^#\[/.test(line)) {
      attrs.push(line);
      continue;
    }
    if (isComment(line)) continue;
    const bindgen = attrs.some((a) => /^#\[wasm_bindgen\b/.test(a)) && !attrs.some((a) => /^#\[cfg\(test\)\]/.test(a));
    if (bindgen) {
      if (/^impl\b/.test(line)) inImpl = true;
      const fn = /^pub fn (\w+)/.exec(line);
      if (fn) names.push(jsName(attrs) ?? fn[1]);
    }
    attrs = [];
  }
  return names;
}

/** Every tracked source the confinement guards read, repository-relative. */
function scannedSources(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", ...SCANNED_TREES], { cwd: repoRoot, encoding: "utf8" });
  return out.split("\0").filter((file) => SOURCE.test(file) && !TEST.test(file));
}

const allowed = (file: string) => ALLOWED_DIRS.some((dir) => file.startsWith(dir));

/** The source with its whole-line comments blanked, so prose naming an op
 *  (`// without this, evaluateStar ...`) is not read as a call. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? "" : line))
    .join("\n");
}

const TIER3 = exportsInTier(3);
const CALLS_TIER3 = new RegExp(`\\.\\s*(${TIER3.join("|")})\\s*\\(`);
const WRITES_MONEY = /\.\s*money\s*(?:[-+*/%]?=(?!=)|\*\*=|\+\+|--)|(?:\+\+|--)\s*[\w$.]*\.money\b/;
const IMPORTS_BINDING = /(?:from\s+|import\s*\(\s*)["'][^"']*\/dualrun\/(?:binding|engine)(?:\.[jt]s)?["']/;

/** The first offending line of a file, or null. */
function offense(text: string, pattern: RegExp): string | null {
  for (const line of code(text).split("\n")) if (pattern.test(line)) return line.trim();
  return null;
}

describe("WASM binding export tiers", () => {
  const rust = readFileSync(resolve(repoRoot, WASM_RS), "utf8");
  const exported = parseBindingExports(rust);
  const table = Object.keys(BINDING_EXPORT_TIERS) as BindingExport[];

  it("every export wasm.rs declares has a tier, and every tiered export is still declared", () => {
    const untiered = exported.filter((name) => !(name in BINDING_EXPORT_TIERS));
    expect(untiered, `exports with no tier: add each to BINDING_EXPORT_TIERS in src/dualrun/exportTiers.ts`).toEqual([]);
    const declared = new Set<string>([...exported, ...GENERATED_EXPORTS]);
    expect(table.filter((name) => !declared.has(name)), "tiered names wasm.rs no longer exports").toEqual([]);
    expect(new Set(exported).size, "an export name appears twice").toBe(exported.length);
  });

  it("only wasm.rs declares binding exports", () => {
    const others = sourceFiles("engine-rs/src", [".rs"])
      .map(repoRel)
      .filter((file) => file !== WASM_RS && /#\[wasm_bindgen/.test(readFileSync(resolve(repoRoot, file), "utf8")));
    expect(others, "a #[wasm_bindgen] outside wasm.rs is not parsed: move it there or teach the parser").toEqual([]);
  });

  it("the parser reads js_name methods, bare methods and module functions (no false pass)", () => {
    for (const name of ["newGame", "tick", "serialize", "money", "towerSetCars", "catalog", "importTdt", "encodeVctower"]) {
      expect(exported, name).toContain(name);
    }
    expect(exported).not.toContain("Engine");
    expect(exported).not.toContain("tower_set_cars");
    expect(exported.length).toBeGreaterThan(55);
    const sample = [
      "#[wasm_bindgen]",
      "pub fn alpha() {}",
      "#[wasm_bindgen]",
      "pub struct Thing {}",
      "#[wasm_bindgen]",
      "impl Thing {",
      "    #[wasm_bindgen(js_name = betaGamma)]",
      "    pub fn beta_gamma(",
      "        #[wasm_bindgen(unchecked_param_type = \"number\")] id: JsValue,",
      "    ) {}",
      "    /// a doc line",
      "    pub fn delta(&self) {}",
      "    fn private_helper(&self) {}",
      "}",
      "fn not_exported() {}",
      "#[cfg(test)]",
      "#[wasm_bindgen]",
      "pub fn in_tests() {}",
    ].join("\n");
    expect(parseBindingExports(sample)).toEqual(["alpha", "betaGamma", "delta"]);
  });

  it("every tier is populated, and the raw ops the issue names are tier 3", () => {
    for (const tier of [1, 2, 3] as const) expect(exportsInTier(tier).length, `tier ${tier}`).toBeGreaterThan(0);
    for (const name of ["setMoney", "setCars", "resizeTransport", "removeUnit", "removeTransport", "towerSetCars", "towerResizeTransport", "advanceClock", "seedLoopMemos", "seedElevatorTelemetry"] as const) {
      expect(BINDING_EXPORT_TIERS[name].tier, name).toBe(3);
    }
    for (const name of ["addCar", "removeCar", "extendTransport", "removeFacility"] as const) {
      expect(BINDING_EXPORT_TIERS[name].tier, name).toBe(1);
    }
  });

  describe("tier 3 stays in the relay, the host, the engine, the tooling and tests", () => {
    const files = scannedSources();
    const read = (file: string) => readFileSync(resolve(repoRoot, file), "utf8");

    it("no scanned source calls a tier 3 op or writes .money", () => {
      const offenders = files
        .filter((file) => !allowed(file))
        .flatMap((file) => {
          const text = read(file);
          const hit = offense(text, CALLS_TIER3) ?? offense(text, WRITES_MONEY);
          return hit ? [`${file}: ${hit}`] : [];
        });
      expect(
        offenders,
        `tier 3 ops (${TIER3.join(", ")}) and writes to .money skip the engine's charge rules: route the edit through a tier 1 command (addCar, removeCar, extendTransport, removeFacility, ...)`,
      ).toEqual([]);
    });

    it("no scanned source outside the relay and the host imports the binding's declaration", () => {
      const offenders = files.filter((file) => !allowed(file)).filter((file) => offense(read(file), IMPORTS_BINDING) !== null);
      expect(offenders, "only src/dualrun/, src/wasmhost/, tests and tooling may import dualrun/binding or dualrun/engine").toEqual([]);
    });

    it("the scan reaches the UI, game and renderer, and the matchers find what they guard (no false pass)", () => {
      for (const tree of SCANNED_TREES) expect(files.some((f) => f.startsWith(`${tree}/`)), `${tree}/ yielded no sources`).toBe(true);
      for (const dir of ["src/ui/", "src/game/", "src/render/", "src/storage/"]) {
        expect(files.some((f) => f.startsWith(dir) && !allowed(f)), dir).toBe(true);
      }
      // The allowed scope really does hold the ops, so the scope is what
      // keeps the guard green, not a matcher that never fires.
      expect(files.some((f) => f.startsWith("src/dualrun/") && offense(read(f), CALLS_TIER3) !== null)).toBe(true);
      expect(files.some((f) => f.startsWith("src/wasmhost/") && offense(read(f), WRITES_MONEY) !== null)).toBe(true);
      expect(files.some((f) => f.startsWith("src/wasmhost/") && offense(read(f), IMPORTS_BINDING) !== null)).toBe(true);

      for (const hit of ["sim.tower.setCars(id, 2)", "app.sim.resizeTransport(id, 1, 9)", "tower.removeUnit(u.id)", "sim.evaluateStar()", "engine.setMoney(5)", "engine.towerSetCars(1, 2)", "engine . advanceClock (5)"]) {
        expect(offense(hit, CALLS_TIER3), hit).not.toBeNull();
      }
      for (const miss of ["sim.addCar(id)", "sim.setCarsLabel(id)", "// sim.setCars(id, 2)", "/* sim.startFire() */", "kind === \"bombThreat\""]) {
        expect(offense(miss, CALLS_TIER3), miss).toBeNull();
      }
      for (const hit of ["sim.money = 5", "app.sim.money += cost", "sim.money -= 1", "sim.money++", "--sim.money", "s.money*=2"]) {
        expect(offense(hit, WRITES_MONEY), hit).not.toBeNull();
      }
      for (const miss of ["const m = sim.money", "if (sim.money === 0)", "sim.money == x", "sim.money >= cost", "sim.money <= cost", "sim.money !== x", "moneyLabel = 1"]) {
        expect(offense(miss, WRITES_MONEY), miss).toBeNull();
      }
      for (const hit of ['import type { WasmEngine } from "../dualrun/binding";', 'import { Engine } from "../../dualrun/engine.js";', 'await import("../dualrun/binding")']) {
        expect(offense(hit, IMPORTS_BINDING), hit).not.toBeNull();
      }
      for (const miss of ['import { x } from "../dualrun/engineX";', 'import { y } from "../engine/Simulation";', 'import { z } from "../dualrun/dualRun";']) {
        expect(offense(miss, IMPORTS_BINDING), miss).toBeNull();
      }
    });
  });
});
