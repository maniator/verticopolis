import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Simulation } from "../../engine/Simulation";
import type { Unit } from "../../engine/types";
import {
  CONFORMANCE_DIR,
  firstDivergence,
  loadScenario,
  reloadTsSim,
  runScenario,
  startTsSim,
  tsEngine,
  type Checkpoint,
  type ScenarioEngine,
} from "../conformance/scenario";
import { hasWasmPackage, startWasmHandle, wasm, wasmEngine, wasmRequired } from "../conformance/wasmEngine";
import type { WasmEngine } from "../../dualrun/binding";
import { tsDiagnosticFacts, type DiagnosticFacts } from "../diagnostics/tsDiagnosticFacts";
import { inspectorDisagreements } from "../diagnostics/inspectorAgreement";

/**
 * The diagnostics facts (#1215, facade slice 6c) against the TypeScript
 * reference, over the whole conformance corpus: every scenario runs on each
 * engine, and at every checkpoint (and each side of a reload) the facts of
 * every room are read before the state is hashed. The two runs must agree
 * fact for fact, and both must still reproduce the pinned checkpoints, which
 * is the proof that asking moves no hash on either engine. A third run, on
 * the TypeScript engine alone, renders the inspector card beside each read
 * and checks the reference against it (`inspectorAgreement`); it runs apart
 * because the card fills the demand memo for lines this family does not
 * read, which would shift the reference's later reads off the Rust ones.
 * Floor tiles carry no diagnostics; one per read is compared, the rest are
 * skipped for time.
 */

const SCENARIO_DIR = resolve(CONFORMANCE_DIR, "scenarios");
const lock = JSON.parse(readFileSync(resolve(CONFORMANCE_DIR, "expected.json"), "utf8")) as { scenarios: Record<string, Checkpoint[]> };
const files = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith(".json")).sort();

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

/** One read: the ids asked about and the facts each engine gave. */
interface Read { ids: number[]; facts: DiagnosticFacts[] }

/** Every room, plus the first floor tile, in tower order. */
function idsOf(units: readonly Unit[]): number[] {
  const tile = units.find((u) => u.kind === "floor");
  return units.filter((u) => u.kind !== "floor" || u === tile).map((u) => u.id);
}

/** The TypeScript engine with a read before each hash. */
function tsWithFacts(sim: Simulation, reads: Read[]): ScenarioEngine {
  const base = tsEngine(sim);
  return {
    ...base,
    stateDigest: () => {
      const ids = idsOf(sim.tower.units);
      reads.push({ ids, facts: ids.map((id) => tsDiagnosticFacts(sim, sim.tower.getUnit(id)!)) });
      return base.stateDigest();
    },
    reload: () => tsWithFacts(reloadTsSim(sim), reads),
  };
}

/** The TypeScript engine with the card rendered beside each read; collects
 *  every line the two disagree on. */
function tsWithCard(sim: Simulation, out: string[]): ScenarioEngine {
  const base = tsEngine(sim);
  return {
    ...base,
    stateDigest: () => {
      for (const id of idsOf(sim.tower.units)) {
        const u = sim.tower.getUnit(id)!;
        for (const d of inspectorDisagreements(sim, u, tsDiagnosticFacts(sim, u))) out.push(`day ${sim.clock.day}, unit ${id} (${u.kind}): ${d}`);
      }
      return base.stateDigest();
    },
    reload: () => tsWithCard(reloadTsSim(sim), out),
  };
}

/** The Rust engine with the same reads, asked about the ids the TypeScript
 *  run read at the same point (the pinned hashes hold the two towers equal). */
function wasmWithFacts(handle: WasmEngine, want: readonly Read[], reads: Read[]): ScenarioEngine {
  const base = wasmEngine(handle);
  return {
    ...base,
    stateDigest: () => {
      const ids = want[reads.length]?.ids ?? [];
      const facts = ids.map((id) => {
        const text = handle.diagnosticFacts(id);
        if (text === undefined) throw new Error(`diagnosticFacts(${id}) answered nothing for a unit`);
        return JSON.parse(text) as DiagnosticFacts;
      });
      reads.push({ ids, facts });
      return base.stateDigest();
    },
    reload: () => {
      const loaded = wasm().Engine.fromSave(handle.serialize());
      base.free?.();
      return wasmWithFacts(loaded, want, reads);
    },
  };
}

/** The sections the corpus reached when PR 1 was recorded; a corpus or
 *  engine change that stops reaching one fails the last test, so a section
 *  cannot drop out of the comparison unseen. */
const CORPUS_SECTIONS = [
  "access:cutOff", "access:notConnected", "access:reachable", "farWalk",
  "gripe:access", "gripe:lobbyFar", "gripe:noTransport", "gripe:noise", "gripe:rent", "gripe:transportFar",
  "lobby:slot:support", "noRate:occupied",
  "notice:access", "notice:noTransport", "notice:noise", "notice:relocation", "notice:rent", "notice:transportFar",
  "wontLease:noise", "wontLease:rent", "wontLease:transportFar",
];

/** Which sections the corpus exercised, so a gap in the comparison shows,
 *  and how many scenarios finished the comparison. */
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
    it(`${scenario.id}: every room's facts match the TypeScript reference`, () => {
      const pinned = lock.scenarios[scenario.id];
      if (!pinned) throw new Error(`${scenario.id} is not in the lock; regenerate it with the TypeScript run first`);
      const tsReads: Read[] = [];
      expect(firstDivergence(runScenario(scenario, (start) => tsWithFacts(startTsSim(start), tsReads)), pinned)).toBeNull();
      const rsReads: Read[] = [];
      expect(firstDivergence(runScenario(scenario, (start) => wasmWithFacts(startWasmHandle(start), tsReads, rsReads)), pinned)).toBeNull();
      expect(rsReads.length).toBe(tsReads.length);
      tsReads.forEach((want, i) => {
        want.facts.forEach(tally);
        want.ids.forEach((id, j) => {
          expect(rsReads[i]!.facts[j], `${scenario.id}, read ${i}, unit ${id}`).toEqual(want.facts[j]);
        });
      });
      const disagreements: string[] = [];
      expect(firstDivergence(runScenario(scenario, (start) => tsWithCard(startTsSim(start), disagreements)), pinned)).toBeNull();
      expect(disagreements.slice(0, 20)).toEqual([]);
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
    if (seen.size > 0) console.info(`diagnostics facts compared, by section: ${JSON.stringify(Object.fromEntries([...seen].sort()))}`);
  });
});
