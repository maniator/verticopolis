// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../engine/serializedGame";
import { stateView } from "../../engine/conformanceView";
import { digest } from "../conformance/canonical";
import { digestStashed } from "./page";
import { buildSmallTower, loadFixtureSave } from "./scenarios";

/** The browser digest is the conformance lock's state digest, so a browser
 *  run's digests compare directly with the Node check's. */

const g = globalThis as unknown as { window?: { __perfStash?: Record<string, unknown> } };

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
