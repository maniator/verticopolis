import { describe, expect, it } from "vitest";
import { isUnlocked, newViewReader, quoteShaft } from "../../game/portAccess";
import { PortCodes } from "../../simport/portCodes";
import { MID, layTile, newSeededDraft } from "../portKit/draftFixtures";
import { engineFromSave, noEngine } from "../portKit/rustEngine";

/**
 * The answers the shaft drag preview reads, on the Rust engine: whether a span
 * fits and whether the star rating has unlocked the kind. The preview's wiring
 * over those answers is unit-tested on a mock port in
 * `src/game/engineWiring.test.ts`.
 */

describe.skipIf(noEngine)("the shaft drag preview's answers on the engine", () => {
  it("fits a span over built floors, refuses one past them, and locks express at one star", () => {
    const draft = newSeededDraft(1, "classic");
    const x = MID - 10;
    for (let tile = x; tile < x + 20; tile++) layTile(draft, "floor", 2, tile);
    const engine = engineFromSave(draft.saveText());
    const codes = new PortCodes(engine);
    const reader = newViewReader(engine);
    reader.update();
    expect(quoteShaft(engine, codes, "elevatorStandard", x, 1, 2).ok).toBe(true);
    // Floor 5 has no structure at the column: the engine refuses the span.
    expect(quoteShaft(engine, codes, "elevatorStandard", x, 1, 5)).toMatchObject({ ok: false, reason: expect.any(String) });
    expect([isUnlocked({ reader }, "elevatorStandard"), isUnlocked({ reader }, "elevatorExpress")]).toEqual([true, false]);
  });
});
