/**
 * The file and engine-package side of the rollback rehearsal
 * (`./rollbackRehearsal.ts` holds the logic): load a checkout's Node engine
 * package and read its records from it, and make the candidate-written saves
 * the previous build is rehearsed against. A checkout's engine is the tooling
 * build `npm ci` installs (`@verticopolis/engine-tooling`); a checkout from
 * before the repository split built it into `engine-rs/pkg/` with
 * `npm run wasm:build`, and that place is still read. Node only and
 * ERASABLE, like its sibling.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import type { Engine } from "@verticopolis/engine-tooling/node/verticopolis_engine";
import type { BuildFacts, CompatRecord, EngineHandle, EnginePackage } from "./rollbackRehearsal.ts";

/** Where a checkout keeps its Node engine package: installed, or built by a
 *  checkout from before the split. */
export const NODE_PACKAGE_DIRS = ["node_modules/@verticopolis/engine-tooling/node", "engine-rs/pkg"] as const;

const GLUE = "verticopolis_engine.js";
const BINARY = "verticopolis_engine_bg.wasm";
const MARKER = "package.json";

interface NodeBinding {
  Engine: typeof Engine;
  engineIdentity(): string;
}

/** The engine's own record of the formats it reads and writes. */
function compatOf(binding: NodeBinding): CompatRecord {
  const id = JSON.parse(binding.engineIdentity()) as {
    crate: { version: string };
    saveVersion: number;
    oldestSaveVersion: number;
    frameLayoutVersion: number;
    catalogVersion: number;
    schema: number;
  };
  const engine = binding.Engine.newGame(1, "classic");
  try {
    const view = JSON.parse(engine.viewLayout()) as { version: number };
    return {
      crateVersion: id.crate.version,
      saveVersion: id.saveVersion,
      oldestSaveVersion: id.oldestSaveVersion,
      frameLayoutVersion: id.frameLayoutVersion,
      viewLayoutVersion: view.version,
      catalogVersion: id.catalogVersion,
      identitySchema: id.schema,
    };
  } finally {
    engine.free();
  }
}

/** Read a checkout's engine records and app version. */
export function buildFactsOf(tree: string, label: string): BuildFacts {
  const pkg = JSON.parse(readFileSync(join(resolve(tree), "package.json"), "utf8")) as { version?: string };
  return { label, appVersion: pkg.version ?? "unknown", compat: compatOf(loadBinding(tree, label)) };
}

/** The Node package folder of a checkout, or the reason it has none. */
function nodePackageDir(tree: string): { dir: string } | { problem: string } {
  for (const rel of NODE_PACKAGE_DIRS) {
    const dir = join(resolve(tree), rel);
    if ([GLUE, BINARY, MARKER].every((f) => existsSync(join(dir, f)))) return { dir };
  }
  return { problem: `${tree} has no Node engine package (${NODE_PACKAGE_DIRS.join(" or ")}); run npm ci in that checkout` };
}

/** The Node package of a checkout, or the reason it cannot be loaded. */
export function nodePackageProblem(tree: string): string | undefined {
  const found = nodePackageDir(tree);
  return "problem" in found ? found.problem : undefined;
}

function loadBinding(tree: string, label: string): NodeBinding {
  const found = nodePackageDir(tree);
  if ("problem" in found) throw new Error(`${label}: ${found.problem}`);
  return createRequire(import.meta.url)(join(found.dir, GLUE)) as NodeBinding;
}

/** A build's engine, started from save text. The package is CommonJS inside an ESM repository, so it loads through `require`. */
export function loadEnginePackage(tree: string, label: string): EnginePackage & { binding: NodeBinding } {
  const binding = loadBinding(tree, label);
  return {
    label,
    binding,
    fromSave(text: string): EngineHandle {
      return binding.Engine.fromSave(text);
    },
  };
}

export interface FixtureSave {
  name: string;
  /** The save text the candidate engine wrote after it loaded the fixture and played. */
  text: string;
}

const TICK_MINUTES = 2;
const MINUTES_PER_HOUR = 60;

/** A fixture file is a `.vctower` export or an original `.TDT` save; anything else is skipped. */
const FIXTURE_FILE = /\.(vctower|tdt)$/i;

/**
 * Candidate-written saves: each fixture goes through the candidate's own
 * importer (the `.vctower` path or the `.TDT` importer), plays `hours` game
 * hours, and is serialized by the candidate. Those are the bytes a player's
 * browser would hold after the candidate build ran.
 */
export function candidateSaves(candidate: { binding: NodeBinding }, fixtureDirs: readonly string[], hours: number, only?: readonly string[]): FixtureSave[] {
  const out: FixtureSave[] = [];
  const unmatched = new Set(only ?? []);
  const seen = new Set<string>();
  for (const dir of fixtureDirs) {
    for (const file of readdirSync(dir).sort()) {
      if (!FIXTURE_FILE.test(file)) continue;
      if (only && !only.includes(file)) continue;
      unmatched.delete(file);
      if (seen.has(file)) throw new Error(`two fixtures are named ${file}; their saves would overwrite each other`);
      seen.add(file);
      const path = join(dir, file);
      const engine = file.toLowerCase().endsWith(".tdt") ? importTdt(candidate.binding, readFileSync(path), file) : candidate.binding.Engine.fromVctower(readFileSync(path, "utf8"));
      try {
        for (let i = 0; i < (hours * MINUTES_PER_HOUR) / TICK_MINUTES; i++) engine.tick(TICK_MINUTES);
        out.push({ name: basename(file), text: engine.serialize() });
      } finally {
        engine.free();
      }
    }
  }
  if (unmatched.size > 0) throw new Error(`no fixture named ${[...unmatched].join(", ")} (in ${fixtureDirs.join(", ")})`);
  return out;
}

/** The importer path the game takes for an original save: load into a new game, then adopt. */
function importTdt(binding: NodeBinding, bytes: Uint8Array, filename: string): Engine {
  const engine = binding.Engine.newGame(1, "classic");
  const refused = (what: string): Error => new Error(`${filename}: ${what}: ${engine.lastReason() ?? "no reason given"}`);
  try {
    if (engine.loadTdt(bytes, filename)[0] !== 1) throw refused("the .TDT importer refused the file");
    if (engine.adoptTdt()[0] !== 1) throw refused("the engine would not adopt the imported tower");
    return engine;
  } catch (e) {
    engine.free();
    throw e;
  }
}
