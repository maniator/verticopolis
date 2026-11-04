import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { catalogFor } from "../engine/catalog";
import { makeRules } from "../engine/gameRules";
import { CLASSIC_RULES, MODERN_RULES } from "../engine/ruleSets";
import { frontendFiles } from "./frontendFiles";
import { repoRoot } from "./guardFiles";

/**
 * The frontend reads no rule from the TypeScript engine's `GameRules` (#921,
 * part 2c's by-name check).
 *
 * A rule read goes through a tower's `rules` object, so it needs no runtime
 * import of `src/engine/`, and `frontendEngineImports.guard.test.ts` cannot
 * see it. This guard reads the member names off the `GameRules` interface in
 * `src/engine/gameRules.ts` and fails when a non-test frontend file:
 * - reads one through `rules.`, `rules?.` or `rules!.` (spaces and line
 *   breaks around the dot included, and `_rules` too);
 * - destructures a `GameRules` member from a `rules` object
 *   (`const { viewPremium } = rules`; the catalog's `rules` block shares no
 *   name with them);
 * - takes a `rules` object off anything but a catalog: `x.rules`, `x?.rules`
 *   or `x!.rules`, a destructuring that binds `rules` from another source
 *   (`const { rules: r } = sim`) or as a parameter of another type
 *   (`function f({ rules }: Simulation)`), and any `"rules"` string, which is
 *   how a bracket, a computed key or `Reflect.get` names it. A catalog is
 *   `catalog`, a `catalog` property, `["catalog"]`, `catalog()`,
 *   `catalogOf(...)`, `towerCatalog(...)`, `catalogOn(...)`, or
 *   `getCatalog(...)`, and a parameter's catalog type is `Catalog`;
 * - indexes `Simulation`, `Tower` or `SimContext` as a type
 *   (`Simulation["rules"]`);
 * - names the rule set itself (`GameRules`, `makeRules`, `rulesOf`,
 *   `CLASSIC_RULES`, `MODERN_RULES`), which is how a rule object reaches a
 *   typed parameter;
 * - names one of the five rules the UI used to read, wherever it appears.
 *
 * Catalog version 6 carries three of those five in its `rules` block
 * (`variantHouseholds`, `previewNamesRefusal`, `scheduleAssist`), which the UI
 * reads instead. The two drain rules' only readers outside `src/engine/`, the
 * TypeScript reference diagnostics, moved into `src/tests/diagnostics/`,
 * which only tests run: the Rust engine writes the shipped card's lines. The
 * frontend is the set `frontendFiles.ts` defines, which the import guard
 * scans too. This guard goes with `src/engine/` when the TypeScript engine is
 * deleted.
 *
 * It scans text, comments, and strings. Any quoted or backticked `rules`,
 * including a Markdown code span in a comment, trips the guard. Write "the
 * rules block" without code formatting in comments of frontend files.
 * This is a syntax tripwire and checks no types. It trusts catalog-shaped
 * names, so a variable called `catalog` can disguise a simulation object;
 * an untyped parameter or a renamed rule object can also evade it. Review
 * remains necessary.
 */

/** The five rules the UI used to read, banned by name. */
const RETIRED_READS = ["hasVariantHouseholds", "showsPreviewReason", "elevatorScheduleUX", "lobbyDistanceDrain", "unmetDemandDrain"] as const;

/** The rule set's own names, banned by name in the frontend: the interface,
 *  its factory, the two rule sets, and `rulesOf`, the header clock's helper,
 *  now gone. The imports above pin the factory and the sets to these names. */
const RULE_SET_NAMES = ["GameRules", "makeRules", "rulesOf", "CLASSIC_RULES", "MODERN_RULES"] as const;

/** The member names the `GameRules` interface declares. */
function gameRulesMembers(): string[] {
  const text = readFileSync(resolve(repoRoot, "src/engine/gameRules.ts"), "utf8");
  const body = /export interface GameRules \{([\s\S]*?)\n\}/.exec(text)?.[1];
  if (body === undefined) throw new Error("src/engine/gameRules.ts declares no GameRules interface");
  // A member starts at the interface's own indentation, so a deeper line (a
  // return type that runs on) is not taken for one.
  const indent = /^([ \t]+)\S/m.exec(body)?.[1] ?? "";
  const declares = new RegExp(`^${indent}(?:readonly\\s+)?(?:get\\s+)?([A-Za-z]\\w*)\\??\\s*[(:<]`, "gm");
  const names = [...body.matchAll(declares)].map((m) => m[1]);
  return [...new Set(names)].sort();
}

/** What a `rules` object may come off: a catalog, as a name, a property, a
 *  bracketed key or a call, with an optional `?` or `!` after it. */
const CATALOG = /(?:(?<![\w$])#?catalog(?:\s*\(\s*\))?|(?<![\w$#])(?:towerCatalog|catalogOn|catalogOf|getCatalog)\s*\((?:[^()]|\([^()]*\))*\)|\[\s*["'`]catalog["'`]\s*\])\s*[?!]?\s*$/;

/** The type a destructured `rules` parameter may have: the catalog's. */
const CATALOG_TYPE = /^:\s*(?:Readonly<\s*)?Catalog\b/;

/** Whether the text just before an offset (a `.rules`) ends in a catalog. */
function offCatalog(text: string, offset: number): boolean {
  return CATALOG.test(text.slice(Math.max(0, offset - 200), offset));
}

/** The `GameRules` reads one file's text holds, as `line: text`. */
function ruleReads(text: string, members: readonly string[]): string[] {
  const member = new RegExp(`\\b(?:${members.join("|")})\\b`);
  const viaRules = new RegExp(`(?<![A-Za-z0-9$])_?rules\\s*[?!]?\\s*\\.\\s*(?:${members.join("|")})\\b`, "g");
  // A destructuring counts when it takes a GameRules member: the catalog's
  // own `rules` block shares no name with them.
  const destructured = /\{([^{}]*)\}\s*=\s*[\w$.?]*\brules\b/g;
  // `x.rules`, `x?.rules`, `x!.rules`, but not a spread (`...rules`).
  const property = /(?<!\.)\.\s*rules\b/g;
  // A `"rules"` string, in brackets or anywhere else.
  const quoted = /["'`]rules["'`]/g;
  // A pattern (one nested level), an optional type on it, then what it
  // destructures (`= source`), a `for ... of` source, or a parameter/array boundary.
  const pattern = /\{((?:[^{}]|\{[^{}]*\})*)\}\s*(:[^=;{}()]*?)?\s*(?:=(?![=>])\s*([^;\n]*)|\s+of\s+([^;\n)]*)|[,\])])/g;
  const bindsRules = /(?<![\w$.#])rules\s*(?:[,:=]|$)/;
  // Catalog-shaped accessors are allowed; expression tails must not masquerade
  // as a catalog by ending in its name (e.g. sim ?? catalog).
  const catalogSource = (source: string): boolean => {
    const from = source.trim().replace(/\s+(?:as|satisfies)\s+[\w$.<>, ]+$/, "");
    return CATALOG.test(from) && !/(?:\?\?|\|\||&&|\?(?!\.)|\/[/*]|,\s*[\w$]+\s*=)/.test(from);
  };
  const indexedType = /\b(?:Simulation|Tower|SimContext)\s*\[(?!\s*\])/g;
  const byName = new RegExp(`\\b(?:${[...RULE_SET_NAMES, ...RETIRED_READS].join("|")})\\b`, "g");
  const lines = text.split(/\r?\n/);
  const lineAt = (offset: number): number => text.slice(0, offset).split(/\r?\n/).length;
  const hits = new Set<number>();
  for (const m of text.matchAll(viaRules)) hits.add(lineAt(m.index));
  for (const m of text.matchAll(destructured)) if (member.test(m[1])) hits.add(lineAt(m.index));
  for (const m of text.matchAll(property)) if (!offCatalog(text, m.index)) hits.add(lineAt(m.index));
  for (const m of text.matchAll(quoted)) {
    // Only `catalog["rules"]` (or `catalog?.["rules"]`) passes.
    const before = text.slice(Math.max(0, m.index - 200), m.index);
    const bracket = /\.?\s*\[\s*$/.exec(before);
    if (!bracket || !CATALOG.test(before.slice(0, bracket.index))) hits.add(lineAt(m.index));
  }
  for (const m of text.matchAll(pattern)) {
    if (!bindsRules.test(m[1])) continue;
    const [, , type, assignment, iteration] = m;
    const source = assignment ?? iteration;
    if (source !== undefined) {
      if (!catalogSource(source)) hits.add(lineAt(m.index));
    } else if (m[0].trimEnd().endsWith("]") || (type !== undefined && !CATALOG_TYPE.test(type.trim()))) {
      hits.add(lineAt(m.index));
    }
  }
  for (const m of text.matchAll(indexedType)) hits.add(lineAt(m.index));
  for (const m of text.matchAll(byName)) hits.add(lineAt(m.index));
  return [...hits].sort((a, b) => a - b).map((n) => `${n}: ${lines[n - 1].trim()}`);
}

describe("the frontend reads no TypeScript GameRules rule", () => {
  const members = gameRulesMembers();

  it("finds every GameRules member the two rule sets implement, and none the catalog's rules block uses", () => {
    const implemented = [...new Set([...Object.keys(CLASSIC_RULES), ...Object.keys(MODERN_RULES)])].sort();
    expect(members).toEqual(implemented);
    for (const name of RETIRED_READS) expect(members).toContain(name);
    expect(makeRules("classic")).toBe(CLASSIC_RULES);
    expect(makeRules("modern")).toBe(MODERN_RULES);
    // A catalog rule named after a GameRules member would trip the guard on a
    // valid catalog read: give it another name.
    for (const mode of ["classic", "modern"] as const) {
      expect(Object.keys(catalogFor(mode).rules).filter((key) => members.includes(key)), mode).toEqual([]);
    }
  });

  it("catches the read shapes it names and leaves the catalog's rules block alone", () => {
    const caught = [
      "const v = sim.rules.viewPremium(3);",
      "tower.rules?.mode",
      "sim.rules\n  .viewPremium(3)",
      "const { viewPremium } = sim.rules;",
      "const { viewPremium } = this.sim?.rules;",
      "sim.rules!.viewPremium(3)",
      "const r = app.sim?.rules;",
      "f(sim.rules)",
      'sim.rules["viewPremium"]',
      "f((sim as Simulation).rules)",
      "(tower.rules as unknown).viewPremium",
      // The rule object off any receiver but a catalog, by any route.
      "const r = simulation.rules;",
      "const r = getSim().rules;",
      "const r = s?.rules;",
      "const r = app.simulation.rules;",
      "const r = t.rules;",
      'const K = "rules";\nsim[K];',
      "s.rules[M](3)",
      "const o = { ...s.rules };",
      "const { rules: r } = sim as Simulation;",
      "function f({ rules: r }: Simulation) {}",
      'function f(r: Simulation["rules"]) {}',
      "const { viewPremium } = getSim().rules;",
      'props.rules?.["viewPremium"]',
      "const { rules } = app.sim;\nf(rules);",
      "const { rules: { viewPremium } } = sim;",
      "const {\n  rules: { viewPremium },\n} = this.sim!;",
      "const { rules } = tower satisfies Tower;",
      "const { rules }: Simulation = sim;",
      "// the manifest's signature.rules",
      "const { rules } = useSim ? sim : catalog;",
      "const { rules } = sim ?? catalog;",
      "const { rules } = sim, c = catalog;",
      "const { rules } = sim // not the catalog",
      "for (const { rules } of sims) show(rules);",
      "catalogFor(mode).rules",
      "const [{ rules }] = [sim];",
      "const r = notcatalog.rules;",
      // Each of these is caught by one pattern alone.
      "rules.viewPremium(3)",
      "this._rules.viewPremium(3)",
      "const { viewPremium } = rules;",
      "r.rules",
      'Reflect.get(sim, "rules")',
      'tower?.["rules"]',
      "const { rules } = this.#sim;",
      "function g({ rules }: Tower) {}",
      "type R = Simulation[K];",
      "function f(r: GameRules) {}",
      "const r = makeRules(mode);",
      "if (r.showsPreviewReason()) {}",
    ];
    for (const sample of caught) expect(ruleReads(sample, members), sample).not.toEqual([]);
    for (const name of [...RULE_SET_NAMES, ...RETIRED_READS]) expect(ruleReads(`const x = ${name};`, members), name).not.toEqual([]);
    expect(ruleReads("const r = sim.rules;\nr.viewPremium(3);\nif (r.showsPreviewReason()) {}", members)).toEqual(["1: const r = sim.rules;", "3: if (r.showsPreviewReason()) {}"]);
    expect(ruleReads("sim.rules\n  .viewPremium(3)", members)).toEqual(["1: sim.rules"]);
    const clean = [
      "catalog.rules.previewNamesRefusal",
      "catalog?.rules",
      "catalog!\n  .rules",
      "sim.catalog.rules",
      "kit.catalog().rules",
      "towerCatalog(port).rules",
      "catalogOn(key, \"modern\").rules",
      "ui.getCatalog().rules",
      "this.#catalog.rules",
      "catalogOf(sim).rules",
      "catalogOf(getApp()).rules",
      'tower?.["catalog"].rules',
      'catalog["rules"]',
      'kit.catalog()?.["rules"]',
      "const { rules } = catalog;",
      "const { rules } = sim.catalog;",
      "const { rules } = kit.catalog();",
      "const { rules } = towerCatalog(port);",
      'const { rules } = tower?.["catalog"];',
      "const { rules } = (sim as Simulation).catalog;",
      "const { rules } = catalog as Catalog;",
      "function f({ rules }: Catalog) {}",
      "function f({ rules }: Readonly<Catalog>) {}",
      "f({ rules })",
      "const o = { ...rules };",
      "const { mode } = sim;",
      "const { scheduleAssist } = catalog.rules;",
      "scheduleDialogUX(catalog.rules)",
      "const towers: Tower[] = [];",
      "// the catalog's rules, from its rules block",
    ];
    for (const sample of clean) {
      expect(ruleReads(sample, members), sample).toEqual([]);
    }
  });

  it("no frontend file reads one", () => {
    // The scan is not empty: it holds the files that read the catalog's rules.
    expect(frontendFiles()).toEqual(expect.arrayContaining(["src/game/buildPreview.ts", "src/game/editorActions.ts", "src/ui/templates/stats.ts"]));
    const found = frontendFiles().flatMap((rel) => ruleReads(readFileSync(resolve(repoRoot, rel), "utf8"), members).map((hit) => `${rel}:${hit}`));
    expect(found, "read the engine catalog (its `rules` block, or a new catalog field) instead of the TypeScript GameRules; any quoted or backticked `rules` (even in comments) trips this guard too, so use plain words in frontend comments").toEqual([]);
  });
});
