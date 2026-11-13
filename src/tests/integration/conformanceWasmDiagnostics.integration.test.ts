import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { SerializedGame, Unit, VacateReason } from "../../shared/types";
import {
  CONFORMANCE_DIR,
  firstDivergence,
  loadScenario,
  runScenario,
  type Checkpoint,
  type ScenarioEngine,
} from "../conformance/scenario";
import { hasWasmPackage, reloadWasmHandle, startWasmHandle, wasmEngine } from "../conformance/wasmEngine";
import type { WasmEngine } from "../../engineBinding/binding";

/**
 * The diagnostics facts (#1215, facade slice 6c) over the whole conformance
 * corpus on the Rust engine: every scenario runs, and at every checkpoint
 * (and each side of a reload) the facts of every room are read before the
 * state is hashed. The run must still reproduce the pinned checkpoints, which
 * is the proof that asking moves no hash, and every room must answer facts
 * about itself. What the facts say is held by the Rust tests
 * (`diagnostics::tenant_tests`, `diagnostics::memo_tests`,
 * `rule_tests::diagnostics_towers`); the TypeScript reference they were once
 * compared with, and the inspector card it was checked against, are gone.
 * Floor and lobby tiles carry no tenant section; the first of each per read
 * is asked, the rest are skipped for time.
 */

const SCENARIO_DIR = resolve(CONFORMANCE_DIR, "scenarios");
const lock = JSON.parse(readFileSync(resolve(CONFORMANCE_DIR, "expected.json"), "utf8")) as { scenarios: Record<string, Checkpoint[]> };
const files = readdirSync(SCENARIO_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

/** The parts of `diagnosticFacts(id)` this run tallies (the full shape is
 *  `DiagnosticFacts` in engine-rs/src/diagnostics/mod.rs). */
interface DiagnosticFacts {
  id: number;
  kind: string;
  access?: string;
  noRate?: string;
  farWalk?: true;
  lobby?: { slot: { needsSupport: boolean; clearFirst: boolean } | null };
  gripe?: { cause: VacateReason; binding?: string };
  wontLease?: { gripe?: { cause: VacateReason } };
  notice?: { reason: VacateReason };
}

/** Every room, plus the first floor tile and the first lobby tile, in tower
 *  order. */
function unitsAsked(units: readonly Pick<Unit, "id" | "kind">[]): Pick<Unit, "id" | "kind">[] {
  const floor = units.find((u) => u.kind === "floor");
  const lobby = units.find((u) => u.kind === "lobby");
  return units.filter((u) => (u.kind !== "floor" && u.kind !== "lobby") || u === floor || u === lobby);
}

/** The Rust engine with a read of every room's facts before each hash. */
function wasmWithFacts(handle: WasmEngine, reads: DiagnosticFacts[][]): ScenarioEngine {
  const base = wasmEngine(handle);
  return {
    ...base,
    stateDigest: () => {
      const save = JSON.parse(handle.serialize()) as SerializedGame;
      reads.push(
        unitsAsked(save.units).map((u) => {
          const text = handle.diagnosticFacts(u.id);
          if (text === undefined) throw new Error(`diagnosticFacts(${u.id}) answered nothing for a unit`);
          const facts = JSON.parse(text) as DiagnosticFacts;
          if (facts.id !== u.id || facts.kind !== u.kind) throw new Error(`diagnosticFacts(${u.id}) answered about ${facts.kind} ${facts.id}, not ${u.kind} ${u.id}`);
          return facts;
        }),
      );
      return base.stateDigest();
    },
    reload: () => {
      const loaded = reloadWasmHandle(handle);
      base.free?.();
      return wasmWithFacts(loaded, reads);
    },
  };
}

/** The sections the corpus reached when PR 1 was recorded; a corpus or
 *  engine change that stops reaching one fails the last test, so a section
 *  cannot drop out of the run unseen. */
const CORPUS_SECTIONS = [
  "access:cutOff", "access:notConnected", "access:reachable", "farWalk",
  "gripe:access", "gripe:lobbyFar", "gripe:noTransport", "gripe:noise", "gripe:rent", "gripe:transportFar",
  "lobby:slot:support", "noRate:occupied",
  "notice:access", "notice:noTransport", "notice:noise", "notice:relocation", "notice:rent", "notice:transportFar",
  "wontLease:noise", "wontLease:rent", "wontLease:transportFar",
];

/** Which sections the corpus exercised, so a gap in the run shows,
 *  and how many scenarios finished. */
const seen = new Map<string, number>();
let compared = 0;
function tally(f: DiagnosticFacts): void {
  const bump = (k: string) => seen.set(k, (seen.get(k) ?? 0) + 1);
  if (f.access) bump(`access:${f.access}`);
  if (f.noRate) bump(`noRate:${f.noRate}`);
  if (f.farWalk) bump("farWalk");
  if (f.lobby) bump(f.lobby.slot ? `lobby:slot${f.lobby.slot.needsSupport ? ":support" : ""}${f.lobby.slot.clearFirst ? ":clear" : ""}` : "lobby:noSlot");
  if (f.gripe) bump(`gripe:${f.gripe.cause}${f.gripe.binding ? `:${f.gripe.binding}` : ""}`);
  if (f.wontLease) bump(`wontLease:${f.wontLease.gripe?.cause ?? "none"}`);
  if (f.notice) bump(`notice:${f.notice.reason}`);
}

describe.skipIf(!hasWasmPackage())("diagnostics facts through the WASM binding", () => {
  for (const file of files) {
    const scenario = loadScenario(resolve(SCENARIO_DIR, file));
    it(`${scenario.id}: every room answers its facts without moving a hash`, () => {
      const pinned = lock.scenarios[scenario.id];
      if (!pinned) throw new Error(`${scenario.id} is not in the lock; regenerate it with the Rust run first`);
      const reads: DiagnosticFacts[][] = [];
      expect(firstDivergence(runScenario(scenario, (start) => wasmWithFacts(startWasmHandle(start), reads)), pinned)).toBeNull();
      expect(reads.length, `${scenario.id}: one read per checkpoint`).toBe(pinned.length);
      reads.forEach((read) => read.forEach(tally));
      compared += 1;
    }, 300_000);
  }

  it("reaches each section the corpus is known to reach", (ctx) => {
    // A -t run, or a scenario that failed above, leaves the tally partial.
    if (compared < files.length) {
      ctx.skip("the tally is partial because not every scenario finished; run the whole file to check it");
      return;
    }
    expect(CORPUS_SECTIONS.filter((k) => !seen.has(k))).toEqual([]);
  });

  afterAll(() => {
    if (seen.size > 0) console.info(`diagnostics facts read, by section: ${JSON.stringify(Object.fromEntries([...seen].sort()))}`);
  });
});
