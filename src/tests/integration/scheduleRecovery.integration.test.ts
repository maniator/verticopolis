import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { newViewReader } from "../../game/portAccess";
import { acknowledgementKey, shortFleets, type ShaftFacts } from "../../game/scheduleRecovery";
import type { EnginePort } from "../../simport/enginePort";
import { scheduleFromSlots } from "../../simport/scheduleSlots";
import type { FacilityKind } from "../../shared/types";
import { decodeVctower } from "../../storage/vctowerContainer";
import { engineFromSave, look, noEngine } from "../portKit/rustEngine";

/**
 * The schedule review over the repository's saves on the Rust engine (#1548):
 * the shafts it reads from the engine and the schedules the engine answers.
 * The review's rules on hand-built shafts are `src/game/scheduleRecovery.test.ts`.
 */

const FIXTURES = "conformance/fixtures";
const saveOf = (name: string) => JSON.stringify(decodeVctower(readFileSync(`${FIXTURES}/${name}.vctower`, "utf8")));

const shaftsOf = (engine: EnginePort): ShaftFacts[] =>
  look(engine).tower.transports.map((t) => ({ id: t.id as number, kind: t.kind as FacilityKind, x: t.x as number, bottom: t.bottom as number, top: t.top as number, cars: t.cars as number }));

function reviewOf(name: string) {
  const engine = engineFromSave(saveOf(name));
  const shafts = shaftsOf(engine);
  return { engine, shafts, found: shortFleets(shafts, (id) => scheduleFromSlots(engine.shaftSchedule(id))) };
}

/** The tower header the key names, as the review reads it: the founding
 *  seed (the scene seed) and the mode. */
const headerOf = (engine: EnginePort) => {
  const { sceneSeed, mode } = newViewReader(engine).header;
  return { seed: sceneSeed, mode };
};

describe.skipIf(noEngine)("shortFleets on the repository fixtures (#1548)", () => {
  it("flags the underscheduled shafts of split-tower and nothing else", () => {
    expect(reviewOf("split-tower").found.map((f) => [f.shaft.id, f.shaft.cars, f.flatAt])).toEqual([[1139, 5, 3]]);
  });

  it("flags exactly the three flat shafts of split-tower-4, and leaves its full-fleet shafts alone", () => {
    const { found, shafts } = reviewOf("split-tower-4");
    expect(found.map((f) => [f.shaft.id, f.shaft.cars, f.flatAt])).toEqual([
      [1139, 8, 3],
      [1735, 8, 3],
      [9281, 8, 2],
    ]);
    expect(shafts.length).toBeGreaterThan(found.length); // 4325, 5675 and the express shafts run 8 of 8
  });

  it("says nothing about the fixtures that carry no authored schedule", () => {
    for (const name of ["sixseven_2", "sixseven-december", "towerone_6"]) expect(reviewOf(name).found, name).toEqual([]);
  });

  it("never edits the fixture bytes", () => {
    const before = readFileSync(`${FIXTURES}/split-tower-4.vctower`);
    reviewOf("split-tower-4");
    expect(readFileSync(`${FIXTURES}/split-tower-4.vctower`).equals(before)).toBe(true);
  });
});

describe.skipIf(noEngine)("acknowledgementKey on the repository fixtures", () => {
  const keyOf = (engine: EnginePort, id: number, seed?: number) => {
    const header = headerOf(engine);
    const facts = shaftsOf(engine).find((t) => t.id === id)!;
    return acknowledgementKey({ seed: seed ?? header.seed, mode: header.mode }, facts);
  };

  it("names the tower and the shaft, and survives a save and reload", () => {
    const a = engineFromSave(saveOf("split-tower-4"));
    const b = engineFromSave(a.serialize());
    expect(keyOf(b, 1139)).toBe(keyOf(a, 1139));
  });

  it("treats the two split-tower saves as one tower, and a tower with another founding seed as another", () => {
    // split-tower-4 is a later save of the same Split Tower: shaft 1139 keeps its key as cars are bought.
    const early = engineFromSave(saveOf("split-tower"));
    const later = engineFromSave(saveOf("split-tower-4"));
    expect(keyOf(early, 1139)).toBe(keyOf(later, 1139));
    expect(keyOf(early, 1139)).not.toBe(keyOf(early, 1139, 99));
    expect(keyOf(later, 1139)).not.toBe(keyOf(later, 1735));
  });
});
