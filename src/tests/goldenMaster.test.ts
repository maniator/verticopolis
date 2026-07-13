import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { Simulation } from "../engine/Simulation";
import type { FacilityKind } from "../engine/types";

/**
 * Golden-master determinism net for the large-file split refactor.
 *
 * The refactor moves method groups out of the engine giants (Simulation, Tower,
 * Crowd, EconomySystem) into friend modules. Every one of those moves is
 * supposed to be behavior-preserving. This test is how we prove it: build a
 * fixed tower through the real money-aware `build` API, run the full v2 sim for
 * a fixed number of in-game days, then pin a hash of the stable-stringified
 * `serialize()` output. If a "pure move" changes a single field of the saved
 * state, the hash flips and this test goes red.
 *
 * It is seeded and deterministic (seeded rng, deterministic clock), so the hash
 * is stable run-to-run. If the sim's behavior legitimately changes in some
 * OTHER PR, update PINNED_STATE_HASH in that PR with intent — never in a
 * refactor that claims to change nothing.
 */

/**
 * Deterministic build script over the starter lobby footprint (newGame seeds a
 * 40-tile ground lobby centered on the lot). We lay a floor slab on floors 2..6
 * directly above it, then drop rooms and an elevator onto that slab, so nothing
 * is detached and no surprise bridge-fill runs. `SLAB_LEFT`/`SLAB_RIGHT` sit
 * inside the starter lobby span. Each build step is asserted to succeed, so a
 * silently-degraded fixture can't quietly test a different tower.
 */
const SLAB_LEFT = 168;
const SLAB_RIGHT = 205; // inclusive; inside the starter lobby (≈167..206)
const ROOM_FLOORS = [2, 3, 4, 5, 6];

const BUILD_SCRIPT: { kind: FacilityKind; floor: number; x: number }[] = [
  // Floor slab above the starter lobby (each tile rests on the story below).
  ...ROOM_FLOORS.flatMap((f) =>
    Array.from({ length: SLAB_RIGHT - SLAB_LEFT + 1 }, (_, i) => ({
      kind: "floor" as FacilityKind,
      floor: f,
      x: SLAB_LEFT + i,
    })),
  ),
  // Offices on floors 2..6 (width 9), two per floor. Offices unlock at 1★, so
  // no star-gating fiddliness; they still drive commuters, rent and move-ins.
  ...ROOM_FLOORS.flatMap((f) => [
    { kind: "office" as FacilityKind, floor: f, x: SLAB_LEFT + 2 },
    { kind: "office" as FacilityKind, floor: f, x: SLAB_LEFT + 12 },
  ]),
  // Fast food (1★) to wake the lunchtime crowd and traffic income.
  { kind: "fastFood", floor: 2, x: SLAB_LEFT + 22 },
  { kind: "fastFood", floor: 3, x: SLAB_LEFT + 22 },
];

function buildFixedTower(sim: Simulation): void {
  sim.money = 500_000_000;
  for (const step of BUILD_SCRIPT) {
    const res = sim.build(step.kind, step.floor, step.x);
    expect(res.ok, `build ${step.kind} @ f${step.floor} x${step.x}: ${res.reason ?? ""}`).toBe(true);
  }
  // Standard elevator spanning the low-rise, on the lobby column (transport API).
  const ev = sim.buildTransport("elevatorStandard", SLAB_LEFT, 1, 6);
  expect(ev.ok, `elevator: ${ev.reason ?? ""}`).toBe(true);
}

/** Stable JSON: object keys sorted recursively so key-order can't jitter the hash. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, function replacer(_k, v) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[key] = (v as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return v;
  });
}

function runFixedScenario(): Simulation {
  const sim = Simulation.newGame(20260713, "classic");
  buildFixedTower(sim);
  // Drive three full in-game days in hourly steps: exercises onHour/onDay,
  // move-ins, rent, crowd spawning, housekeeping, star evaluation.
  for (let i = 0; i < 24 * 3; i++) sim.tick(60);
  sim.evaluateStar();
  return sim;
}

describe("golden master: Simulation serialize() is byte-stable across refactors", () => {
  it("is deterministic run-to-run", () => {
    const a = stableStringify(runFixedScenario().serialize());
    const b = stableStringify(runFixedScenario().serialize());
    expect(a).toEqual(b);
  });

  it("round-trips through deserialize without drift", () => {
    const once = runFixedScenario().serialize();
    const twice = Simulation.deserialize(once).serialize();
    expect(stableStringify(twice)).toEqual(stableStringify(once));
  });

  it("matches the pinned state hash (a pure refactor must not change it)", () => {
    const hash = createHash("sha256").update(stableStringify(runFixedScenario().serialize())).digest("hex");
    expect(hash).toEqual(PINNED_STATE_HASH);
  });
});

/** sha256 of the stable-stringified serialize() output of the fixed scenario.
 *  Pinned from the pre-refactor baseline. */
const PINNED_STATE_HASH = "f54d44516f7ebd8b0e6ad16aec2b49bdb615bd8b969cd7a477402458a9993673";
