import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import type { SerializedGame } from "../engine/types";
import { decodeVctower } from "./vctowerContainer";
import { parseSaveText } from "./saveCompression";
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

describe("parseSaveText", () => {
  it("hands on the text itself when nothing needed repair", () => {
    const text = JSON.stringify({ name: "Spire" });
    expect(parseSaveText(text).text).toBe(text);
  });

  it("hands on the repaired save when a lone surrogate needed it", () => {
    const read = parseSaveText('{"name":"a\\ud800b"}');
    expect(read.data).toEqual({ name: "a�b" });
    expect(JSON.parse(read.text)).toEqual({ name: "a�b" });
  });
});
