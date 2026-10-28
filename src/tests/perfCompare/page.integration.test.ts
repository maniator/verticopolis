// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../engine/serializedGame";
import { stateView } from "../../engine/conformanceView";
import { digest } from "../conformance/canonical";
import { TsEngine } from "../../engine/port/tsEngine";
import { digestStashed, stashSave } from "./page";
import { buildSmallTower, loadFixtureSave } from "./scenarios";

/** The browser digest is the conformance lock's state digest, so a browser
 *  run's digests compare directly with the Node check's. */

const g = globalThis as unknown as { window?: { __perfStash?: Record<string, unknown>; __perfSaves?: Record<string, string>; __perfStoredSaves?: Record<string, string> } };

afterEach(() => {
  delete g.window;
});

async function browserDigest(save: unknown): Promise<string> {
  g.window = { __perfStash: { k: save } };
  return digestStashed("k");
}

describe("digestStashed", () => {
  it("equals the conformance state digest for a built tower after some ticks", async () => {
    const sim = buildSmallTower();
    for (let i = 0; i < 120; i++) sim.tick(2);
    // A JSON round trip, as the save crosses the page boundary.
    expect(await browserDigest(JSON.parse(JSON.stringify(sim.serialize())))).toBe(digest(stateView(sim)));
  });

  it("equals it for a player fixture with a pending choice and log prose", async () => {
    const sim = Simulation.deserialize(loadFixtureSave("conformance/fixtures/sixseven_2.vctower"));
    sim.events.pending = { kind: "bomb", message: "Pay $1,000?", cost: 1000 } as unknown as typeof sim.events.pending;
    sim.log.push({ minute: 1, text: "prose that stays out", kind: "info" } as (typeof sim.log)[number]);
    const save = JSON.parse(JSON.stringify(sim.serialize())) as SerializedGame;
    expect(await browserDigest(save)).toBe(digest(stateView(sim)));
  });

  it("consumes the stash entry and refuses a missing one", async () => {
    g.window = { __perfStash: { k: { a: 1 } } };
    await digestStashed("k");
    expect(g.window.__perfStash).toEqual({});
    await expect(digestStashed("k")).rejects.toThrow(/nothing stashed under k/);
  });
});

describe("stashSave", () => {
  it("gives the hosted runs a copy their stored-source load starts from the raw run's state", async () => {
    const save = JSON.stringify(buildSmallTower().serialize());
    const raw = Simulation.deserialize(JSON.parse(save) as SerializedGame);
    g.window = {};
    stashSave({ name: "small", save });
    expect(g.window.__perfSaves?.small).toBe(save);
    const loadStored = (text: string): unknown => {
      const e = new TsEngine(Simulation.newGame(3, "modern"));
      expect(e.loadSave(text)[0]).toBe(1);
      return JSON.parse(e.serialize());
    };
    // The stamped copy loads as this build's tower; the bare save would load
    // as a founder's (the stored source's rule for a save with no stamp).
    expect(await browserDigest(loadStored(g.window.__perfStoredSaves!.small))).toBe(digest(stateView(raw)));
    expect(await browserDigest(loadStored(save))).not.toBe(digest(stateView(raw)));
  });
});
