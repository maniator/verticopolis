import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import type { SerializedGame } from "../engine/types";
import { decodeVctower } from "./vctowerContainer";
import { engineSaveText, importObjection, looksLikeTowerSave, readSavedAt } from "./saveTextRead";
import { stampText } from "./saveStamp";

const FIXTURES = "conformance/fixtures";

/** What the writers did before the text stamp: parse, set, print. */
function parsedStamp(text: string, savedAt: number, appVersion: string): string {
  const data = JSON.parse(text) as SerializedGame;
  data.savedAt = savedAt;
  data.appVersion = appVersion;
  return JSON.stringify(data);
}

afterEach(() => vi.useRealTimers());

describe("stampText", () => {
  it("writes the same text as stamping the parsed save, for every conformance tower", () => {
    vi.useFakeTimers({ now: 1_760_000_000_000 });
    for (const name of readdirSync(FIXTURES).filter((f) => f.endsWith(".vctower"))) {
      const sim = Simulation.deserialize(decodeVctower(readFileSync(`${FIXTURES}/${name}`, "utf8")) as SerializedGame);
      const text = new TsEngine(sim).serialize();
      const { json, stamp } = stampText(text);
      expect(stamp.savedAt).toBe(1_760_000_000_000);
      expect(json, name).toBe(parsedStamp(text, stamp.savedAt, stamp.appVersion));
    }
  });

  it("restamps through a parse when the text already carries a stamp", () => {
    const text = JSON.stringify({ minutes: 1, savedAt: 5, appVersion: "old", units: [] });
    const { json, stamp } = stampText(text);
    expect(json).toBe(parsedStamp(text, stamp.savedAt, stamp.appVersion));
    expect(JSON.parse(json)).toMatchObject({ savedAt: stamp.savedAt, appVersion: stamp.appVersion });
  });

  it("stamps an empty object through a parse", () => {
    const { json, stamp } = stampText("{ }");
    expect(JSON.parse(json)).toEqual({ savedAt: stamp.savedAt, appVersion: stamp.appVersion });
  });
});

describe("the save text reads", () => {
  it("hands an engine the text itself when nothing needs repair", () => {
    const text = JSON.stringify({ name: "Spire" });
    expect(engineSaveText(text)).toBe(text);
  });

  it("hands an engine the repaired save when a lone surrogate needs it", () => {
    expect(JSON.parse(engineSaveText('{"name":"a\\ud800b"}'))).toEqual({ name: "a\ufffdb" });
  });

  it("reads the write time as a parse would, from the stamp the writers print", () => {
    vi.useFakeTimers({ now: 1_760_000_000_123 });
    const { json } = stampText(new TsEngine(Simulation.newGame(1)).serialize());
    expect(readSavedAt(json)).toBe((JSON.parse(json) as SerializedGame).savedAt);
    expect(readSavedAt('{"savedAt":1,"x":{"savedAt":2.5e3}}')).toBe(2500);
    expect(readSavedAt('{"name":"\\"savedAt\\":9"}')).toBeUndefined();
    expect(readSavedAt("{}")).toBeUndefined();
  });

  it("tells a damaged or foreign save apart, and holds nothing against a tower", () => {
    const tower = new TsEngine(Simulation.newGame(1)).serialize();
    expect([looksLikeTowerSave(tower), importObjection(tower)]).toEqual([true, undefined]);
    expect(importObjection('{"minutes": 5, "units": []}')).toBeUndefined();
    expect(looksLikeTowerSave('{"minutes": 5, "units": []}')).toBe(false);
    expect(importObjection('{"minutes":')).toBe("This tower file is damaged and can't be read.");
    expect(importObjection("{}")).toBe("Not a valid tower save file.");
    expect(importObjection("null")).toBe("Not a valid tower save file.");
  });
});
