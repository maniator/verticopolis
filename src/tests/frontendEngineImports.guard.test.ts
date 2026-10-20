import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { repoRel, repoRoot, sourceFiles } from "./guardFiles";
import { isTestFile, resolveRelative, scanRuntimeImports } from "./importScan";

/**
 * The frontend's runtime imports of the TypeScript engine, held to a ratchet.
 *
 * The engine stays as 3.0.0's fallback, and its retirement removes `src/engine/`
 * (roadmap row 7, `architecture-engine-rust-port-2026-10-08.md`, "Retiring the
 * TypeScript engine: the inventory"). Each runtime import the frontend keeps is
 * one more thing that retirement has to move or replace, so new frontend code
 * reads the catalog, the frame view (`src/wasmhost/frameView.ts`) or an engine
 * query (#868) instead. This guard parses every non-test file under `src/`
 * except the engine, the test tree and the host and save code (see
 * {@link NOT_FRONTEND}), so a new directory or entry page is scanned without
 * anyone listing it. It pins, in `frontendEngineImports.ratchet.txt`, which
 * engine modules each file imports at runtime, leaving out the catalog handle
 * ({@link CATALOG_HANDLE}).
 *
 * An import counts the way the retirement inventory counts it (the rules are
 * in `importScan.ts`, which the `Simulation` reach guard shares): type-only
 * when it says `import type` or `export type`, or marks every name it brings
 * in with `type`, and anything else is a runtime import, including a bare
 * `import "..."`, a dynamic `import()`, `new URL("...", import.meta.url)` and
 * `import.meta.glob`. A name used only as a type but imported without `type`
 * counts as runtime (the build drops it, the guard cannot tell), so mark it
 * `type`. A dynamic `import()` whose module is not a string literal fails,
 * since the guard cannot read it.
 *
 * A runtime import the list does not name fails, and so does a line that names
 * more than its file imports. The list shrinks as the frontend moves off the
 * engine; it grows only with a reason the PR states and a reviewer accepts.
 * Imports through another module are not seen: a module outside `src/engine/`
 * that re-exports engine values to the frontend is a review matter. When the
 * list is empty, delete it and this guard's stale-entry check.
 */
const here = dirname(fileURLToPath(import.meta.url));

/** What under `src/` is not frontend: the engine itself, the test tree, and
 *  the host and save code (`src/wasmhost/`, `src/dualrun/`, `src/storage/`),
 *  whose engine imports the retirement inventory's own tables cover. */
const NOT_FRONTEND = ["src/engine/", "src/tests/", "src/wasmhost/", "src/dualrun/", "src/storage/"] as const;

/** The catalog handle (#921): how the frontend reads the catalog, from
 *  whichever engine runs the tower. The inventory moves it out of
 *  `src/engine/` before retirement rather than deleting it, so its imports
 *  are not counted. When it moves, the check below fails; delete this list. */
const CATALOG_HANDLE = ["towerCatalog", "catalogTypes"] as const;
const counted = (mod: string): boolean => !(CATALOG_HANDLE as readonly string[]).includes(mod);

/** The engine module a relative specifier names from `rel`, as its path under
 *  `src/engine/` without query or extension (`index` for the directory
 *  itself), or null for anything else. */
function engineModule(rel: string, spec: string): string | null {
  const target = resolveRelative(rel, spec);
  if (target === "src/engine") return "index";
  return target?.startsWith("src/engine/") ? target.slice("src/engine/".length) : null;
}

/** The engine modules one file imports at runtime, sorted, and the dynamic
 *  imports it holds that the guard cannot read. */
function runtimeEngineImports(rel: string, text: string): { modules: string[]; unreadable: string[] } {
  const { imports, unreadable } = scanRuntimeImports(rel, text);
  const modules = new Set(imports.map((i) => engineModule(rel, i.spec)).filter((mod): mod is string => mod !== null));
  return { modules: [...modules].sort(), unreadable };
}

/** Every non-test frontend file under `src/`, repo-relative. */
function frontendFiles(): string[] {
  return sourceFiles("src", [".ts", ".tsx"])
    .map(repoRel)
    .filter((rel) => !rel.endsWith(".d.ts") && !isTestFile(rel) && !NOT_FRONTEND.some((dir) => rel.startsWith(dir)))
    .sort();
}

/** `frontendEngineImports.ratchet.txt`: `<file> <module> <module> ...` per
 *  line; `#` starts a comment, on its own line or after the modules. */
function parseRatchet(text: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [file, ...mods] = line.split(/\s+/);
    if (mods.length === 0) throw new Error(`frontendEngineImports.ratchet.txt: "${file}" names no module; delete the line`);
    if (out.has(file)) throw new Error(`frontendEngineImports.ratchet.txt: ${file} is listed twice`);
    if (new Set(mods).size !== mods.length) throw new Error(`frontendEngineImports.ratchet.txt: ${file} names a module twice`);
    out.set(file, new Set(mods));
  }
  return out;
}

describe("the frontend's runtime imports of src/engine/", () => {
  const files = frontendFiles();
  const scans = new Map(files.map((rel) => [rel, runtimeEngineImports(rel, readFileSync(resolve(repoRoot, rel), "utf8"))]));
  const ratchet = parseRatchet(readFileSync(resolve(here, "frontendEngineImports.ratchet.txt"), "utf8"));

  it("scans the frontend and leaves out the engine, the tests, the host and save code", () => {
    // A scan that silently found nothing would pass forever.
    expect(files.length).toBeGreaterThan(150);
    for (const rel of ["src/main.ts", "src/ui/UI.ts", "src/render/excalibur/TowerEngine.ts", "src/helpPage.ts"]) expect(files).toContain(rel);
    for (const dir of NOT_FRONTEND) expect(files.some((rel) => rel.startsWith(dir)), dir).toBe(false);
  });

  it("reads imports the way the inventory counts them", () => {
    const sample = [
      'import type { FacilityKind } from "../engine/types";',
      'import { type Unit } from "../engine/types";',
      'import type {\n  Person,\n} from "../engine/Crowd";',
      'export type { Tower } from "../engine/tower";',
      'export type * from "../engine/typesOnly";',
      'import type Def = require("../engine/typeRequire");',
      '// import { FACILITIES } from "../engine/comment";',
      'const s = "import { x } from \'../engine/string\'";',
      'import { SaveGame } from "../storage/SaveGame";',
      'import { type CatalogFacility, catalogFacility } from "../engine/catalogTypes";',
      'import Default, { type Extra } from "../engine/defaultImport";',
      'import * as ns from "../engine/namespace";',
      'export { GRIPE_WARN } from "../engine/Simulation";',
      'export * from "../engine/starExport";',
      'import {} from "../engine/emptyBraces";',
      'import "../engine/sideEffect";',
      'import req = require("../engine/required");',
      'const later = () => import("../engine/sim/charges");',
      'import { towerCatalog } from "../engine/towerCatalog.ts";',
      'import { gameRules } from "../engine/gameRules.js";',
      'import * as barrel from "../engine";',
      'const worker = new URL("../engine/worker.ts?worker", import.meta.url);',
      'const all = import.meta.glob(["../engine/glob/*.ts"]);',
    ].join("\n");
    expect(runtimeEngineImports("src/ui/sample.ts", sample)).toEqual({
      modules: [
        "Simulation",
        "catalogTypes",
        "defaultImport",
        "emptyBraces",
        "gameRules",
        "glob/*",
        "index",
        "namespace",
        "required",
        "sideEffect",
        "sim/charges",
        "starExport",
        "towerCatalog",
        "worker",
      ],
      unreadable: [],
    });
    expect(runtimeEngineImports("src/render/sprites/sample.ts", 'import { FACILITIES } from "../../engine/facilities";').modules).toEqual(["facilities"]);
    expect(runtimeEngineImports("src/render/sprites/sample.ts", 'import { FACILITIES } from "../engine/facilities";').modules).toEqual([]);
    expect(runtimeEngineImports("src/ui/sample.ts", "const name = 'x';\nawait import(`../engine/${name}`);").unreadable).toEqual(["src/ui/sample.ts:2"]);
  });

  it("leaves out the catalog handle while it lives in src/engine/", () => {
    for (const mod of CATALOG_HANDLE) expect(existsSync(resolve(repoRoot, "src/engine", `${mod}.ts`)), mod).toBe(true);
    // The handle reaches the TypeScript tables only through its default source.
    const handleImports = (mod: string) => runtimeEngineImports(`src/engine/${mod}.ts`, readFileSync(resolve(repoRoot, "src/engine", `${mod}.ts`), "utf8")).modules;
    expect(handleImports("catalogTypes")).toEqual([]);
    expect(handleImports("towerCatalog")).toEqual(["catalog"]);
    expect(["towerCatalog", "catalogTypes", "facilities"].filter(counted)).toEqual(["facilities"]);
  });

  it("every dynamic import in the frontend names its module", () => {
    const unreadable = [...scans.values()].flatMap((s) => s.unreadable);
    expect(unreadable, `The guard cannot tell what these import; give import() a string literal:\n${unreadable.join("\n")}`).toEqual([]);
  });

  it("no frontend file imports an engine module at runtime that the ratchet does not name", () => {
    const grown: string[] = [];
    for (const [rel, { modules }] of scans) {
      const allowed = ratchet.get(rel) ?? new Set<string>();
      for (const mod of modules) if (counted(mod) && !allowed.has(mod)) grown.push(`${rel}: ${mod}`);
    }
    expect(
      grown,
      "New frontend code reads the catalog, the frame view or an engine query instead of src/engine/ (see this guard's comment). " +
        "If the names are types, import them with `import type`. A runtime import that cannot wait goes in " +
        `frontendEngineImports.ratchet.txt, with a # reason on its line and in the PR:\n${grown.join("\n")}`,
    ).toEqual([]);
  });

  it("the ratchet has no stale entries", () => {
    const stale: string[] = [];
    for (const [rel, allowed] of ratchet) {
      const mods = new Set((scans.get(rel)?.modules ?? []).filter(counted));
      for (const mod of allowed) if (!mods.has(mod)) stale.push(`${rel}: ${mod}`);
    }
    expect(stale, `Delete these from frontendEngineImports.ratchet.txt (a file's line goes when it names nothing):\n${stale.join("\n")}`).toEqual([]);
  });

  it("refuses a ratchet line it cannot read", () => {
    expect(() => parseRatchet("src/ui/a.ts")).toThrow(/names no module/);
    expect(() => parseRatchet("src/ui/a.ts # only a reason")).toThrow(/names no module/);
    expect(() => parseRatchet("src/ui/a.ts types\nsrc/ui/a.ts facilities")).toThrow(/listed twice/);
    expect(() => parseRatchet("src/ui/a.ts types types")).toThrow(/names a module twice/);
    expect(parseRatchet("# a comment\n\nsrc/ui/a.ts types facilities # why it stays\r\n")).toEqual(new Map([["src/ui/a.ts", new Set(["types", "facilities"])]]));
  });
});
