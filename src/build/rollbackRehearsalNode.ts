/**
 * The file and engine-package side of the rollback rehearsal
 * (`./rollbackRehearsal.ts` holds the logic): read a build's records from a
 * checkout, load its Node engine package (`engine-rs/pkg/`, written by
 * `npm run wasm:build`), and make the candidate-written saves the previous
 * build is rehearsed against. Node only and ERASABLE, like its sibling.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import type { Engine } from "../dualrun/engine";
import { COMPAT_RECORD_PATH, type CompatRecord } from "./engineCompat.ts";
import type { BuildFacts, EngineHandle, EnginePackage } from "./rollbackRehearsal.ts";

/** Where `npm run wasm:build` leaves the Node package inside a checkout. */
export const NODE_PACKAGE_DIR = "engine-rs/pkg";

const GLUE = "verticopolis_engine.js";
const BINARY = "verticopolis_engine_bg.wasm";
const MARKER = "package.json";

interface NodeBinding {
  Engine: typeof Engine;
  engineIdentity(): string;
}

/** Read a checkout's compatibility record and app version. */
export function buildFactsOf(tree: string, label: string): BuildFacts {
  const root = resolve(tree);
  const compatPath = join(root, COMPAT_RECORD_PATH);
  if (!existsSync(compatPath)) throw new Error(`${label}: ${compatPath} does not exist; is this an engine checkout?`);
  const compat = JSON.parse(readFileSync(compatPath, "utf8")) as CompatRecord;
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string };
  return { label, appVersion: pkg.version ?? "unknown", compat };
}

/** The Node package of a checkout, or the reason it cannot be loaded. */
export function nodePackageProblem(tree: string): string | undefined {
  const dir = join(resolve(tree), NODE_PACKAGE_DIR);
  for (const f of [GLUE, BINARY, MARKER]) {
    if (!existsSync(join(dir, f))) return `${join(dir, f)} is missing; run npm run wasm:build in that checkout`;
  }
  return undefined;
}

/** A build's engine, started from save text. The package is CommonJS inside an ESM repository, so it loads through `require`. */
export function loadEnginePackage(tree: string, label: string): EnginePackage & { binding: NodeBinding } {
  const problem = nodePackageProblem(tree);
  if (problem) throw new Error(`${label}: ${problem}`);
  const binding = createRequire(import.meta.url)(join(resolve(tree), NODE_PACKAGE_DIR, GLUE)) as NodeBinding;
  // A package built from another commit than the checkout's records would make the rehearsal test the wrong engine.
  const built = (JSON.parse(binding.engineIdentity()) as { crate?: { version?: string } }).crate?.version;
  const recorded = buildFactsOf(tree, label).compat.crateVersion;
  if (built !== recorded) throw new Error(`${label}: the engine package in ${tree} is crate ${String(built)} but the checkout's compat record says ${recorded}; run npm run wasm:build there`);
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
