// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { digestStashed, stashSave } from "./page";
import { buildScenarios, loadFixtureSave } from "./scenarios";

/** The browser digest is the conformance lock's state digest, so a browser
 *  run's digests compare directly with the engine's own `stateDigest`. */

const needsEngine = !hasWasmPackage();

const g = globalThis as unknown as { window?: { __perfStash?: Record<string, unknown>; __perfSaves?: Record<string, string>; __perfStoredSaves?: Record<string, string> } };

afterEach(() => {
  delete g.window;
});

async function browserDigest(save: unknown): Promise<string> {
  g.window = { __perfStash: { k: save } };
  return digestStashed("k");
}

/** The engine's save and state digest for `save`, after `steps` two-minute ticks. */
function engineOn(save: string, steps = 0): { save: unknown; digest: string } {
  const engine = wasm().Engine.fromSave(save);
  try {
    for (let i = 0; i < steps; i++) engine.tick(2);
    return { save: JSON.parse(engine.serialize()), digest: engine.stateDigest() };
  } finally {
    engine.free();
  }
}

describe("digestStashed", () => {
  it.skipIf(needsEngine)("equals the engine's state digest for a built tower after some ticks", async () => {
    const after = engineOn(buildScenarios(["small"])[0].save, 120);
    // A JSON round trip, as the save crosses the page boundary.
    expect(await browserDigest(JSON.parse(JSON.stringify(after.save)))).toBe(after.digest);
  });

  it.skipIf(needsEngine)("equals it for a player fixture with a pending choice and log prose", async () => {
    const data = loadFixtureSave("conformance/fixtures/sixseven_2.vctower") as unknown as { events: { pending: unknown }; log?: unknown[] };
    data.events.pending = { kind: "bombThreat", message: "Pay $1,000?", cost: 1000 };
    data.log = [...(data.log ?? []), { minute: 1, text: "prose that stays out", kind: "info" }];
    const loaded = engineOn(JSON.stringify(data));
    const kept = loaded.save as typeof data;
    // The engine kept both kinds of prose, so the digest has some to strip.
    expect(kept.events.pending).toEqual(expect.objectContaining({ kind: "bombThreat", message: "Pay $1,000?" }));
    expect(kept.log).toContainEqual(expect.objectContaining({ text: "prose that stays out" }));
    expect(await browserDigest(loaded.save)).toBe(loaded.digest);
  });

  it("consumes the stash entry and refuses a missing one", async () => {
    g.window = { __perfStash: { k: { a: 1 } } };
    await digestStashed("k");
    expect(g.window.__perfStash).toEqual({});
    await expect(digestStashed("k")).rejects.toThrow(/nothing stashed under k/);
  });
});

describe("stashSave", () => {
  it.skipIf(needsEngine)("gives the hosted runs a copy their stored-source load starts from the raw run's state", async () => {
    const save = buildScenarios(["small"])[0].save;
    const raw = engineOn(save);
    g.window = {};
    stashSave({ name: "small", save });
    expect(g.window.__perfSaves?.small).toBe(save);
    const loadStored = (text: string): unknown => {
      const e = wasm().Engine.newGame(3, "modern");
      try {
        expect(e.loadSave(text)[0]).toBe(1);
        return JSON.parse(e.serialize());
      } finally {
        e.free();
      }
    };
    // The stamped copy loads as this build's tower; the bare save would load
    // as a founder's (the stored source's rule for a save with no stamp).
    expect(await browserDigest(loadStored(g.window.__perfStoredSaves!.small))).toBe(raw.digest);
    expect(await browserDigest(loadStored(save))).not.toBe(raw.digest);
  });
});
