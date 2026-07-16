import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { Simulation } from "../../engine/Simulation";
import type { FacilityKind, GameMode } from "../../engine/types";

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
 * OTHER PR, update PINNED_STATE_HASH in that PR with intent, never in a
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

function runFixedScenario(mode: GameMode = "classic"): Simulation {
  const sim = Simulation.newGame(20260713, mode);
  buildFixedTower(sim);
  // Drive three full in-game days in hourly steps. `tick` takes MINUTES, so 60
  // is one hour and 24*3 iterations is three days: exercises onHour/onDay,
  // move-ins, rent, crowd spawning, housekeeping, star evaluation.
  const MINUTES_PER_HOUR = 60;
  for (let i = 0; i < 24 * 3; i++) sim.tick(MINUTES_PER_HOUR);
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

// The same build-and-run scenario founded as a MODERN tower. Modern diverges from
// Classic under an identical footprint (the deeper-economy sinks: operating
// overhead per held unit, and the commercial demand floor that keeps a thin
// tower's venues trading), so its serialized state settles to a different
// fingerprint. Pinning it locks Modern's determinism the same way, so a
// behavior-preserving refactor that only means to move code cannot silently drift
// Modern-mode math either. (The scenario lays no condo, so the variant-household
// RNG path is exercised by its own unit tests, not this fixture.)
describe("golden master (modern): Simulation serialize() is byte-stable across refactors", () => {
  it("is deterministic run-to-run", () => {
    const a = stableStringify(runFixedScenario("modern").serialize());
    const b = stableStringify(runFixedScenario("modern").serialize());
    expect(a).toEqual(b);
  });

  it("round-trips through deserialize without drift", () => {
    const once = runFixedScenario("modern").serialize();
    const twice = Simulation.deserialize(once).serialize();
    expect(stableStringify(twice)).toEqual(stableStringify(once));
  });

  it("differs from the Classic fingerprint (the mode divergence is real)", () => {
    const classicHash = createHash("sha256").update(stableStringify(runFixedScenario("classic").serialize())).digest("hex");
    const modernHash = createHash("sha256").update(stableStringify(runFixedScenario("modern").serialize())).digest("hex");
    expect(modernHash).not.toEqual(classicHash);
  });

  it("matches the pinned Modern state hash (a pure refactor must not change it)", () => {
    const hash = createHash("sha256").update(stableStringify(runFixedScenario("modern").serialize())).digest("hex");
    expect(hash).toEqual(PINNED_MODERN_STATE_HASH);
  });
});

/**
 * The golden-master fingerprint: a sha256 of the stable-stringified `serialize()`
 * output of the fixed build-and-run scenario above. Because the scenario is fully
 * deterministic (fixed seed, fixed clock, fixed build script), this one hash is a
 * fingerprint of the ENTIRE resulting game state (money, every unit's state and
 * accrued fields, population, ratings, the log tail, ...). Any code change that
 * alters the simulation's behavior by even a single serialized field flips the
 * hash and turns the "matches the pinned state hash" test red.
 *
 * Why we keep it: it is the safety net for behavior-preserving work. A refactor
 * that claims to change nothing (a pure code move, an extraction) MUST leave this
 * hash untouched; if it flips, the "pure" change silently altered behavior and
 * the test caught it. Conversely, a PR that legitimately changes behavior
 * re-pins this constant IN THAT PR, with a comment explaining what shifted, so
 * the change is deliberate and reviewable, never an accident.
 *
 * Last re-pinned for the graduated lobby-distance penalty (#394): the fixture's
 * upper rooms sit up to 5 floors above the ground lobby (its highest occupied
 * floor is 6, distance 5), which now falls in the "far" band, so those tenants
 * cap at LOBBY_FAR_CAP (0.7) instead of drifting toward 1.0. Their satisfaction
 * fields (and nothing else) shift. The fixture builds no sky lobby, so it exercises
 * the far ceiling only, not the very-far erosion. The prior re-pin was for
 * commercial demand pools (#393): the fixture's fast-food venues earn a
 * demand-driven share instead of the old tower-wide appeal scalar.
 */
const PINNED_STATE_HASH = "4d3a93016a2d7431c8f1272c0a0418580231d80db10aa7ad882b2ee2033debb3";

/**
 * The Modern-mode golden-master fingerprint: the same fixed build-and-run
 * scenario founded as a Modern tower. Distinct from the Classic hash because
 * Modern applies the deeper-economy sinks (operating overhead per held unit) and
 * the commercial demand floor, so money, accrued income, and the fields they
 * touch settle differently under the identical footprint. Re-pin this IN THE PR
 * that legitimately changes Modern behavior, with intent, exactly like the Classic
 * hash above. First pinned alongside Phase C of commercial demand pools (#393),
 * which added no Modern income math itself (the value simply captures Modern's
 * demand-pools behavior, previously unpinned). Re-pinned for #394: the fixture's
 * upper rooms now feel the Modern far-band ceiling (a smoother continuous curve
 * over the same anchors), shifting their satisfaction fields.
 */
const PINNED_MODERN_STATE_HASH = "faee6fd5ea7f3a75574fd98398ad3f1a3049bb0d83f2e92f5af5f7812611fd97";
