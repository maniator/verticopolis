import { afterEach, describe, expect, it, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { SaveGame } from "./SaveGame";
import { STORE_MAGIC } from "./saveCompression";
import { setEngineWriter } from "./vctowerWriter";

const NOW = 1_760_000_000_123;

afterEach(() => {
  setEngineWriter(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the .vctower writer", () => {
  it("writes through the engine when one is set, with the stamp the save carries", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const sim = new Simulation(1);
    const calls: Array<[string, string, number]> = [];
    setEngineWriter((json, appVersion, savedAt) => {
      calls.push([json, appVersion, savedAt]);
      return "VCTOWER1\nZW5naW5l\n";
    });
    expect(await SaveGame.export(sim)).toBe("VCTOWER1\nZW5naW5l\n");
    expect(SaveGame.packSync(sim)).toBe(STORE_MAGIC + "ZW5naW5l");
    expect(calls).toHaveLength(2);
    const [json, appVersion, savedAt] = calls[0] ?? ["", "", 0];
    expect(savedAt).toBe(NOW);
    expect(appVersion).toBe(__APP_VERSION__);
    expect(JSON.parse(json)).toMatchObject({ savedAt: NOW, appVersion: __APP_VERSION__ });
  });

  it("falls back to the TypeScript writer, and stays there, once the engine throws", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const sim = new Simulation(1);
    const own = await SaveGame.export(sim);
    const ownPacked = SaveGame.packSync(sim);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setEngineWriter(() => {
      throw new Error("trapped");
    });
    expect(await SaveGame.export(sim)).toBe(own);
    expect(SaveGame.packSync(sim)).toBe(ownPacked);
    // Logged once: the first failure turns the engine writer off.
    expect(error).toHaveBeenCalledTimes(1);
    expect(ownPacked).toBe(STORE_MAGIC + own.split("\n")[1]);
  });

  it.each(["", "VCTOWER1\nZW5naW5l", "VCTOWER2\nZW5naW5l\n", "VCTOWER1\r\nZW5naW5l\r\n", "VCTOWER1\nnot base64!\n"])(
    "falls back when the engine hands back no .vctower file: %j",
    async (bad) => {
      vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
      const sim = new Simulation(1);
      const ownPacked = SaveGame.packSync(sim);
      vi.spyOn(console, "error").mockImplementation(() => {});
      const writer = vi.fn(() => bad);
      setEngineWriter(writer);
      expect(SaveGame.packSync(sim)).toBe(ownPacked);
      expect(SaveGame.packSync(sim)).toBe(ownPacked);
      expect(writer).toHaveBeenCalledTimes(1);
    },
  );
});
