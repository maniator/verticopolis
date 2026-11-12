/**
 * The cosmetic fx sequences (`santaFxSeq`, the explosion, thief, treasure and
 * VIP records) and the emergency counters (fires, gutted rooms, bombs) sit
 * outside the hashed views, so the conformance lock never sees them (#879).
 * The checkpoint detail carries them (`FX_SLOTS`), the seeded differential
 * compares them every hour, and this suite pins them at the end of the
 * scenarios that reach each site on the shipped build: an off-by-one at any
 * site changes a pinned value.
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FX_SLOTS, type CheckpointDetail, type FxSlot } from "../conformance/checkpointDetail";
import { CONFORMANCE_DIR, loadScenario, runScenario } from "../conformance/scenario";
import { hasWasmPackage, startWasmEngine } from "../conformance/wasmEngine";

type Nonzero = Partial<Record<FxSlot, number>>;

/** Every slot a scenario leaves non-zero at its last checkpoint. A slot not
 *  listed is 0 (the basement is floor 0, so a treasure there lists no floor). */
const PINNED: Record<string, Nonzero> = {
  "scenarios/holidays-classic.json": { santaFxSeq: 2, thiefSeq: 1, thiefCaught: 1, thiefFloor: 77 },
  "scenarios/events-classic.json": { explosionSeq: 1, explosionFloor: 5, explosionX: 174.5, thiefFloor: 1, fires: 1, firesGutRooms: 1, bombs: 1 },
  // After the direct threat detonates, a second threat is called in during
  // the last two days, with Security sold and nobody to search (#1973).
  "scenarios/ransom-ignored-modern.json": { explosionSeq: 2, explosionFloor: 22, explosionX: 272, thiefFloor: 1, bombs: 2 },
  "scenarios/fire-rescue-ignored-modern.json": { thiefFloor: 1, vipFxSeq: 1, fires: 2, firesGutRooms: 17 },
  "scenarios/vip-review-modern.json": { thiefFloor: 1, vipFxSeq: 1 },
  "fuzz-corpus/fx-thief-uncaught.json": { thiefSeq: 3, thiefFloor: 1 },
  // Sixty days at three stars also cross the holidays and light a fire.
  "fuzz-corpus/fx-thief-caught.json": { santaFxSeq: 3, thiefSeq: 1, thiefCaught: 1, thiefFloor: 1, fires: 1, firesGutRooms: 1 },
  "fuzz-corpus/fx-treasure-cap.json": { treasureSeq: 3, treasureX: 172, thiefFloor: 1 },
};

const asRecord = (d: CheckpointDetail): Nonzero => Object.fromEntries(Object.entries(d.fx).filter(([, v]) => v !== 0)) as Nonzero;

/** A month or two of game time; the longest takes several seconds on a busy runner. */
const SLOW = 180_000;

const run = hasWasmPackage();

describe.runIf(run)("the fx sequences and emergency counters, pinned on the shipped build", () => {
  for (const [file, expected] of Object.entries(PINNED)) {
    it(`${file}: the shipped build ends on the pinned values`, () => {
      const wasm: CheckpointDetail[] = [];
      runScenario(loadScenario(resolve(CONFORMANCE_DIR, file)), startWasmEngine, wasm);
      expect(asRecord(wasm[wasm.length - 1])).toEqual(expected);
    }, SLOW);
  }

  it("reaches every slot at least once across the pinned scenarios, so no site goes unpinned", () => {
    const reached = new Set<string>();
    for (const expected of Object.values(PINNED)) for (const k of Object.keys(expected)) reached.add(k);
    // The positions (floor and x) can legitimately be 0; every sequence, flag and counter must be reached.
    const sites = FX_SLOTS.filter((k) => !/(Floor|X)$/.test(k));
    expect(sites.filter((k) => !reached.has(k))).toEqual([]);
  });
});
