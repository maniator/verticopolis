import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
 *    one and by its Rust name when it has none (`tick`, `serialize`). A shape
 *    it cannot name (a getter, setter or constructor, a second exported type,
 *    a `cfg_attr` binding) fails the test, so the parser is taught before
 *    such an export ships.
 * 2. No source outside the allowed scope calls a tier 3 op, on the binding or
 *    on the TypeScript instance the relay mirrors, and none assigns `.money`
 *    (the relay turns that write into `setMoney`). The allowed scope: the
 *    TypeScript engine itself (`src/engine/`, whose own calls are its
 *    implementation), the relay (`src/dualrun/`), the host and its suppressed
 *    frame sync (`src/wasmhost/`), the generated package (`src/public/engine/`),
 *    tests (`src/tests/`, `*.test.*`, `e2e/`, which is not scanned) and the
 *    tooling in `scripts/` (not scanned). Everything else under `src/`, `api/`
 *    and `tools/` is scanned, untracked new files included: the UI, the game,
 *    the renderer, storage, the boot.
 * 3. No scanned source outside that scope calls a host-loop op the binding
 *    alone has (`frameView`, `logSince`, ...) or imports the binding's
 *    declaration (`dualrun/binding` or `dualrun/engine`). `tick`,
 *    `drainGameplayEvents` and `free` share their names with the TypeScript
 *    instance and the renderer, so for them the guard fails on a call through
 *    something named `engine` (`handle.current()?.engine.tick(dt)`) and on
 *    any use of the global host handle `__vcEngine`, and the import check
 *    covers the rest: the boot (`src/bootstrap.ts`) holds
 *    the loaded module through `wasmhost/startWasmHost` and hands it straight
 *    to the host.
 *
 * The matchers read call and write shapes written out on one line
 * (`x.setCars(`, `x.setCars?.(`, `x.setCars.call(`, `x.money = `,
 * `x.money ??= `, `++x.money`). A computed member (`x["setCars"]`), a
 * destructured method or target (`const { setCars } = x`,
 * `({ a: x.money } = o)`), a cast receiver (`(engine as E).tick()`), a write
 * split across lines, an inline block comment inside a write and a write through
 * `Object.assign` are out of their reach, as with the other source guards.
 */

const WASM_RS = "engine-rs/src/wasm.rs";
const ALLOWED_DIRS = ["src/engine/", "src/dualrun/", "src/wasmhost/", "src/public/engine/", "src/tests/"];
const SCANNED_TREES = ["src", "api", "tools"];
const SOURCE = /\.(m|c)?[jt]sx?$/;
const TEST = /\.test\.(m|c)?[jt]sx?$/;
/** Host-loop names the TypeScript side also uses for its own methods. */
const SHARED_LOOP_NAMES: readonly BindingExport[] = ["tick", "drainGameplayEvents", "free"];

interface ParsedExports {
  names: string[];
  /** Exported items the parser cannot name, with the reason. */
  unsupported: string[];
}

/** Each attribute on one line, however rustfmt wrapped it. */
function joinAttributes(rust: string): string[] {
  const out: string[] = [];
  let pending: string | null = null;
  let depth = 0;
  for (const line of rust.split("\n")) {
    if (pending === null && !/^\s*#\[/.test(line)) {
      out.push(line);
      continue;
    }
    pending = pending === null ? line : `${pending} ${line.trim()}`;
    for (const ch of line) {
      if (ch === "[") depth++;
      else if (ch === "]") depth--;
    }
    if (depth <= 0) {
      out.push(pending);
      pending = null;
      depth = 0;
    }
  }
  if (pending !== null) out.push(pending);
  return out;
}

/** The JavaScript names `wasm.rs` exports, in source order. An item under
 *  `#[cfg(test)]` is skipped: it never reaches a build. */
function parseBindingExports(rust: string): ParsedExports {
  const names: string[] = [];
  const unsupported: string[] = [];
  const jsName = (attrs: string[]): string | undefined => {
    for (const a of attrs) {
      const m = /js_name\s*=\s*"?([A-Za-z_$][\w$]*)"?/.exec(a);
      if (m) return m[1];
    }
    return undefined;
  };
  const isComment = (line: string) => /^\s*(\/\/|$)/.test(line);
  const testOnly = (attrs: string[]) => attrs.some((a) => /#\[cfg\((?:all\()?test\b/.test(a));
  const unnameable = (attrs: string[]) => attrs.find((a) => /wasm_bindgen\([^\]]*\b(constructor|getter|setter|skip_typescript|js_class)\b/.test(a));
  const FN = /^pub(?:\s+(?:const|async|unsafe|extern\s+"[^"]*"))*\s+fn\s+(\w+)/;
  let attrs: string[] = [];
  let inImpl = false;
  for (const line of joinAttributes(rust)) {
    if (/cfg_attr\([^\]]*wasm_bindgen/.test(line)) unsupported.push(`a cfg_attr binding: ${line.trim()}`);
    if (inImpl) {
      if (/^\}/.test(line)) {
        inImpl = false;
        attrs = [];
      } else if (/^ {4}#\[/.test(line)) {
        attrs.push(line);
      } else if (!isComment(line)) {
        const fn = line.startsWith("    ") ? FN.exec(line.slice(4)) : null;
        const skipped = attrs.some((a) => /wasm_bindgen\([^\]]*\bskip\b/.test(a)) || testOnly(attrs);
        const odd = unnameable(attrs);
        if (fn && !skipped && odd) unsupported.push(`${fn[1]}: ${odd.trim()}`);
        else if (fn && !skipped) names.push(jsName(attrs) ?? fn[1]);
        attrs = [];
      }
      continue;
    }
    if (/^#\[/.test(line)) {
      attrs.push(line);
      continue;
    }
    if (isComment(line)) continue;
    if (attrs.some((a) => /^#\[wasm_bindgen\b/.test(a)) && !testOnly(attrs)) {
      const fn = FN.exec(line);
      const odd = unnameable(attrs);
      if (/^impl\b/.test(line)) inImpl = !/\}\s*$/.test(line);
      else if (fn && odd) unsupported.push(`${fn[1]}: ${odd.trim()}`);
      else if (fn) names.push(jsName(attrs) ?? fn[1]);
      else if (!/^pub struct Engine\b/.test(line)) unsupported.push(`an exported item that is not a function: ${line.trim()}`);
    }
    attrs = [];
  }
  return { names, unsupported };
}

/** Every source the confinement guards read, repository-relative: the tracked
 *  ones and any new file git does not ignore, so a guard run before `git add`
 *  still sees it. */
function scannedSources(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...SCANNED_TREES], { cwd: repoRoot, encoding: "utf8" });
  return [...new Set(out.split("\0"))].filter((file) => SOURCE.test(file) && !TEST.test(file) && existsSync(resolve(repoRoot, file)));
}

const allowed = (file: string) => ALLOWED_DIRS.some((dir) => file.startsWith(dir));
/** The port's own loop callers outside the host scope: the shared view
 *  reader takes the frames through `EnginePort` (contract section 5,
 *  `viewFrame`), and the frame loop steps the engine through it (`advance`).
 *  Neither imports the binding. */
const FRAME_READERS = ["src/simport/viewReader.ts", "src/game/frameLoop.ts"];

/** The source with its comments blanked, so prose naming an op
 *  (`// without this, evaluateStar ...`) is not read as a call: block
 *  comments that open a line (doc comments), whole-line `//` comments, and a
 *  trailing `//` after whitespace. A `/*` or `//` inside a string is left
 *  alone, so a glob or a URL in code cannot hide what follows it. */
function code(text: string): string {
  return text
    .replace(/^([ \t]*)\/\*[\s\S]*?\*\//gm, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? "" : line.replace(/\s\/\/(?!.*["'`]).*$/, "")))
    .join("\n");
}

const escape = (name: string) => name.replace(/[$]/g, "\\$");
/** A call to one of `names` written out: plain, optional, non-null, generic,
 *  or through `call`, `apply` or `bind`. */
function callsAny(names: readonly string[]): RegExp {
  const alt = names.map(escape).join("|");
  return new RegExp(`\\.\\s*(?:${alt})\\s*(?:!|\\?\\.|<[^>()]*>)?\\s*(?:\\(|\\??\\.\\s*(?:call|apply|bind)\\s*\\()`);
}

const TIER3 = exportsInTier(3);
const CALLS_TIER3 = callsAny(TIER3);
const HOST_LOOP = (Object.keys(BINDING_EXPORT_TIERS) as BindingExport[]).filter((name) => BINDING_EXPORT_TIERS[name].tier === 2 && "hostLoop" in BINDING_EXPORT_TIERS[name]);
const CALLS_HOST_LOOP = callsAny(HOST_LOOP.filter((name) => !SHARED_LOOP_NAMES.includes(name)));
/** A write to `.money`, through parentheses and a non-null assertion too
 *  (`(sim.money) += c`, `sim.money! -= c`, `(sim.money)++`); `sim.money != x`
 *  and `if (sim.money) ++n` stay reads, and so does an arrow's `(b = sim.money) =>`. */
const OP = String.raw`(?:\*\*|<<|>>>|>>|&&|\|\||\?\?|[-+*/%&|^])`;
const WRITES_MONEY = new RegExp(
  [
    String.raw`\.\s*money\s*\)*\s*${OP}?=(?![=>])`,
    String.raw`\.\s*money(?:\s*(?:\+\+|--)|(?:\s*\))+(?:\+\+|--))`,
    String.raw`\.\s*money\s*!(?:\s*\)*\s*${OP}=|\s*\)*\s+=(?![=>])|(?:\s*\))*(?:\+\+|--))`,
    String.raw`(?:\+\+|--)\s*\(*\s*[\w$.]*\.money\b`,
  ].join("|"),
);
/** A shared-name host-loop op called on something named `engine`
 *  (`host.engine.tick(dt)`, `handle.current()?.engine.free()`), in the call
 *  shapes `callsAny` reads, or the global host handle, which reaches the same
 *  binding without an import. */
const REACHES_ENGINE_LOOP = new RegExp(
  String.raw`(?<![\w$])engine\s*[?!]?\.\s*(?:${SHARED_LOOP_NAMES.join("|")})\s*(?:!|\?\.|<[^>()]*>)?\s*(?:\(|\??\.\s*(?:call|apply|bind)\s*\()|(?<![\w$])__vcEngine\b`,
);
const IMPORTS_BINDING = /(?:from\s+|import\s+|import\s*\(\s*|require\s*\(\s*)["'`](?:[^"'`]*\/)?dualrun\/(?:binding|engine)(?:\.d)?(?:\.[cm]?[jt]s)?["'`]/;

/** The first offending line of a file, or null. */
function offense(text: string, pattern: RegExp): string | null {
  for (const line of code(text).split("\n")) if (pattern.test(line)) return line.trim();
  return null;
}

describe("WASM binding export tiers", () => {
  const rust = readFileSync(resolve(repoRoot, WASM_RS), "utf8");
  const parsed = parseBindingExports(rust);
  const exported = parsed.names;
  const table = Object.keys(BINDING_EXPORT_TIERS) as BindingExport[];

  it("every export wasm.rs declares has a tier, and every tiered export is still declared", () => {
    const untiered = exported.filter((name) => !(name in BINDING_EXPORT_TIERS));
    expect(untiered, `exports with no tier: add each to BINDING_EXPORT_TIERS in src/dualrun/exportTiers.ts`).toEqual([]);
    const declared = new Set<string>([...exported, ...GENERATED_EXPORTS]);
    expect(table.filter((name) => !declared.has(name)), "tiered names wasm.rs no longer exports").toEqual([]);
    expect(new Set(exported).size, "an export name appears twice").toBe(exported.length);
    expect(exported.length).toBe(table.length - GENERATED_EXPORTS.length);
  });

  it("wasm.rs has no export the parser cannot name", () => {
    expect(parsed.unsupported, "teach parseBindingExports this shape, then tier the export").toEqual([]);
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
    const sample = [
      "#[wasm_bindgen]",
      "pub fn alpha() {}",
      "#[wasm_bindgen]",
      "pub struct Engine {}",
      "#[wasm_bindgen]",
      "impl Engine {",
      "    #[wasm_bindgen(js_name = betaGamma)]",
      "    pub fn beta_gamma(",
      "        #[wasm_bindgen(unchecked_param_type = \"number\")] id: JsValue,",
      "    ) {}",
      "    /// a doc line",
      "    pub fn delta(&self) {}",
      "    fn private_helper(&self) {}",
      "    #[wasm_bindgen(",
      "        js_name = wrappedName,",
      "    )]",
      "    pub fn wrapped_name(&self) {}",
      "    pub async fn later(&self) {}",
      "    #[cfg(test)]",
      "    pub fn test_helper(&self) {}",
      "}",
      "fn not_exported() {}",
      "#[wasm_bindgen(js_name = \"quoted\")]",
      "pub unsafe fn quoted_one() {}",
      "#[cfg(test)]",
      "#[wasm_bindgen]",
      "pub fn in_tests() {}",
    ].join("\n");
    expect(parseBindingExports(sample)).toEqual({ names: ["alpha", "betaGamma", "delta", "wrappedName", "later", "quoted"], unsupported: [] });
    const odd = [
      "#[wasm_bindgen]",
      "impl Engine {",
      "    #[wasm_bindgen(getter)]",
      "    pub fn money(&self) -> f64 { 0.0 }",
      "}",
      "#[wasm_bindgen]",
      "pub enum Kind { A }",
      "#[cfg_attr(feature = \"x\", wasm_bindgen)]",
      "pub fn maybe() {}",
    ].join("\n");
    expect(parseBindingExports(odd).unsupported).toHaveLength(3);
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

    it("no scanned source calls a host-loop op the binding alone has", () => {
      const offenders = files.filter((file) => !allowed(file) && !FRAME_READERS.includes(file)).flatMap((file) => {
        const text = read(file);
        const hit = offense(text, CALLS_HOST_LOOP) ?? offense(text, REACHES_ENGINE_LOOP);
        return hit ? [`${file}: ${hit}`] : [];
      });
      expect(offenders, `the host loop (${HOST_LOOP.join(", ")}) belongs to src/wasmhost/, the dual run and tests`).toEqual([]);
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
      // The allowed scope really does hold the ops, which shows the matchers
      // fire on real code and the scope is what keeps the guard green.
      expect(files.some((f) => f.startsWith("src/dualrun/") && offense(read(f), CALLS_TIER3) !== null)).toBe(true);
      expect(files.some((f) => f.startsWith("src/wasmhost/") && offense(read(f), WRITES_MONEY) !== null)).toBe(true);
      expect(files.some((f) => f.startsWith("src/wasmhost/") && offense(read(f), IMPORTS_BINDING) !== null)).toBe(true);
      expect(files.some((f) => f.startsWith("src/wasmhost/") && offense(read(f), CALLS_HOST_LOOP) !== null)).toBe(true);
      expect(HOST_LOOP).toEqual(expect.arrayContaining(["tick", "drainGameplayEvents", "frameView"]));

      for (const hit of ["sim.tower.setCars(id, 2)", "app.sim.resizeTransport(id, 1, 9)", "tower.removeUnit(u.id)", "sim.evaluateStar()", "engine.setMoney(5)", "engine.towerSetCars(1, 2)", "engine . advanceClock (5)", "sim.setCars?.(id, 2)", "sim.tower.setCars!(id, 2)", "sim.startFire.call(sim)", "sim.setCars?.call(sim, id, 2)", "x.setMoney<number>(1)", 'const g = "assets/*"; sim.setMoney(1);']) {
        expect(offense(hit, CALLS_TIER3), hit).not.toBeNull();
      }
      for (const miss of ["sim.addCar(id)", "sim.setCarsLabel(id)", "// sim.setCars(id, 2)", "/* sim.startFire() */", "kind === \"bombThreat\"", "run(); // sim.setCars(id, 2) is relay-only"]) {
        expect(offense(miss, CALLS_TIER3), miss).toBeNull();
      }
      for (const hit of ["sim.money = 5", "app.sim.money += cost", "sim.money -= 1", "sim.money++", "--sim.money", "s.money*=2", "sim.money ??= 0", "sim.money ||= 1", "sim.money |= 0", "sim.money <<= 1", "++(sim.money)", "(sim.money) += cost", "(sim.money)++", "sim.money! -= cost", "sim.money! = 5", "(sim.money!) = 5"]) {
        expect(offense(hit, WRITES_MONEY), hit).not.toBeNull();
      }
      for (const miss of ["const m = sim.money", "if (sim.money === 0)", "sim.money == x", "sim.money >= cost", "sim.money <= cost", "sim.money !== x", "sim.money != x", "sim.money! !== x", "(sim.money) === 0", "if (sim.money) ++n;", "if (!this.money) --budget;", "if (a.money!) ++n;", "(a.money!) == 0", "moneyLabel = 1", "sim.money ?? 0", "sim.money || 0", "const canAfford = (budget = app.sim.money) => budget >= cost;", "(budget = sim.money!) => budget", "type Fn = (m: typeof sim.money) => void;"]) {
        expect(offense(miss, WRITES_MONEY), miss).toBeNull();
      }
      for (const hit of ['import type { WasmEngine } from "../dualrun/binding";', 'import { Engine } from "../../dualrun/engine.js";', 'await import("../dualrun/binding")', 'require("../dualrun/engine")', 'import type { Engine } from "../dualrun/engine.d.ts";', "await import(`../dualrun/binding`)", 'import "../dualrun/binding.js";', 'import { E } from "dualrun/engine";']) {
        expect(offense(hit, IMPORTS_BINDING), hit).not.toBeNull();
      }
      for (const hit of ["e.frameView()", "e.logSince(3)", "e.gameplayEventsPending()"]) expect(offense(hit, CALLS_HOST_LOOP), hit).not.toBeNull();
      for (const miss of ["app.onboarding.tick()", "this.tick(elapsed)", "sim.tick(dt)", "handle.free()", "source.drainGameplayEvents()"]) expect(offense(miss, CALLS_HOST_LOOP), miss).toBeNull();
      for (const hit of ["handle.current()?.engine.tick(5)", "host.engine.drainGameplayEvents()", "this.engine?.free()", "engine.tick(dt)", "engine.tick.call(e, 1)", "engine.tick<number>(1)", "const h = globalThis.__vcEngine;"]) {
        expect(offense(hit, REACHES_ENGINE_LOOP), hit).not.toBeNull();
      }
      for (const miss of ["this.engine.currentScene", "towerEngine.tick(1)", "app.onboarding.tick()", "g.__vcEngineBoot = state", "$engine.tick()"]) expect(offense(miss, REACHES_ENGINE_LOOP), miss).toBeNull();
      for (const miss of ['import { x } from "../dualrun/engineX";', 'import { y } from "../engine/Simulation";', 'import { z } from "../dualrun/dualRun";']) {
        expect(offense(miss, IMPORTS_BINDING), miss).toBeNull();
      }
    });
  });
});
