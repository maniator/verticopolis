import { describe, expect, it } from "vitest";
import { MAP_OPEN_STORAGE_KEY, MAP_OPEN_VALUE } from "../../ui/overviewMapPrefs";
import { checkMapAb, checkMapAbFolder, MAP_AB_LIMITATION, MAP_AB_OPEN_SLOT, MAP_AB_VIEWPORT, mapAbBanner, mapOpenInSlot, storeMapSlot } from "./mapAb";
import { DEFAULT_VIEWPORT, limitations, makeConfig, parseArgs } from "./main";

/** `perf:worker --aa wasm --map-ab` (#343): the Map closed in slot "ts" and open in slot "wasm". */
describe("the Map A/B pass", () => {
  it("takes --map-ab only with --aa wasm", () => {
    expect(parseArgs(["--aa", "wasm", "--map-ab"]).mapAb).toBe(true);
    expect(parseArgs(["--aa", "wasm"]).mapAb).toBe(false);
    expect(() => parseArgs(["--map-ab"])).toThrow(/--aa wasm/);
    expect(() => parseArgs(["--aa", "ts", "--map-ab"])).toThrow(/--aa wasm/);
    expect(() => checkMapAb(true, null)).toThrow(/--aa wasm/);
    expect(() => checkMapAb(false, null)).not.toThrow();
  });

  it("renders at the desktop size unless --viewport says otherwise, so the open Map is the desktop window", () => {
    expect(parseArgs(["--aa", "wasm", "--map-ab"]).viewport).toEqual(MAP_AB_VIEWPORT);
    expect(parseArgs(["--aa", "wasm", "--map-ab", "--viewport", "390x844"]).viewport).toEqual({ width: 390, height: 844 });
    expect(parseArgs(["--viewport", "390x844", "--aa", "wasm", "--map-ab"]).viewport).toEqual({ width: 390, height: 844 });
    expect(parseArgs(["--aa", "wasm"]).viewport).toEqual(DEFAULT_VIEWPORT);
  });

  it("records the pass in the configuration and its limitations, and leaves other runs as they were", () => {
    const c = makeConfig(parseArgs(["--aa", "wasm", "--map-ab", "--reps", "4"]), ["large"]);
    expect(c.mapAb).toBe(true);
    expect(limitations(c)).toContain(MAP_AB_LIMITATION);
    const plain = makeConfig(parseArgs(["--aa", "wasm"]), ["large"]);
    expect("mapAb" in plain).toBe(false);
    expect(limitations(plain)).not.toContain(MAP_AB_LIMITATION);
  });

  it("opens the Map in slot wasm only, so every ratio reads open over closed", () => {
    expect(MAP_AB_OPEN_SLOT).toBe("wasm");
    expect(mapOpenInSlot("wasm")).toBe(true);
    expect(mapOpenInSlot("ts")).toBe(false);
    expect(mapAbBanner).toMatch(/map open over map closed/);
  });

  it("stores the slot's choice under both layout keys, and nothing outside the pass", async () => {
    const scripts: { keys: string[]; value: string }[] = [];
    const ctx = { addInitScript: async (_fn: unknown, arg: { keys: string[]; value: string }) => void scripts.push(arg) };
    await storeMapSlot(ctx as never, true, "wasm");
    await storeMapSlot(ctx as never, true, "ts");
    await storeMapSlot(ctx as never, undefined, "wasm");
    await storeMapSlot(ctx as never, false, "ts");
    const keys = Object.values(MAP_OPEN_STORAGE_KEY);
    expect(scripts).toEqual([
      { keys, value: MAP_OPEN_VALUE.open },
      { keys, value: MAP_OPEN_VALUE.closed },
    ]);
  });

  it("needs its folder to name the pass, and no other run's folder to", () => {
    expect(() => checkMapAbFolder("2026-11-03-aa-wasm-map-ab", true)).not.toThrow();
    expect(() => checkMapAbFolder("2026-11-03-aa-wasm", true)).toThrow(/map-ab/);
    expect(() => checkMapAbFolder("run-MAP-AB", false)).toThrow(/not one/);
    expect(() => checkMapAbFolder("2026-11-03-aa-wasm", false)).not.toThrow();
  });
});
