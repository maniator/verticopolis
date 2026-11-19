import { describe, expect, it, vi } from "vitest";
import { finishedSkyBridgeAt, skyBridgeAt, skyBridgeReads } from "./skyBridgeView";

/** The tower view's bridges over a spy standing in for the engine's
 *  `skyBridgeLooks()`: decoded once per revision and generation. */
describe("skyBridgeReads", () => {
  it("decodes the engine's quads and asks again only when the revision or generation moves", () => {
    let revision = 3;
    let generation = 1;
    const port = { skyBridgeLooks: vi.fn(() => Float64Array.from([15, 110, 120, 2, 30, 40, 44, 0])), generation: () => generation };
    const read = skyBridgeReads(port, () => revision);
    expect(read()).toEqual([
      { floor: 15, from: 110, to: 120, look: 2 },
      { floor: 30, from: 40, to: 44, look: 0 },
    ]);
    read();
    expect(port.skyBridgeLooks).toHaveBeenCalledOnce();
    revision = 4;
    read();
    expect(port.skyBridgeLooks).toHaveBeenCalledTimes(2);
    // A loaded tower can reuse a revision; its generation is new.
    generation = 2;
    read();
    expect(port.skyBridgeLooks).toHaveBeenCalledTimes(3);
  });
});

describe("finding a bridge at a cell", () => {
  const bridges = [{ floor: 15, from: 110, to: 120, look: 1 }];

  it("finds the bridge holding a tile and nothing past its ends", () => {
    expect(skyBridgeAt(bridges, 15, 110)).toBe(bridges[0]);
    expect(skyBridgeAt(bridges, 15, 119)).toBe(bridges[0]);
    expect(skyBridgeAt(bridges, 15, 120)).toBeUndefined();
    expect(skyBridgeAt(bridges, 30, 115)).toBeUndefined();
  });

  it("counts a bridge finished only with a sky lobby past each end", () => {
    const lobbies = new Set(["15:109", "15:120"]);
    const tower = { skyBridges: () => bridges, structureKindAt: (f: number, x: number) => (lobbies.has(`${f}:${x}`) ? ("lobby" as const) : undefined) };
    expect(finishedSkyBridgeAt(tower, 15, 113)).toBe(bridges[0]);
    lobbies.delete("15:120");
    expect(finishedSkyBridgeAt(tower, 15, 113)).toBeUndefined();
    expect(finishedSkyBridgeAt({ structureKindAt: () => undefined }, 15, 113)).toBeUndefined();
  });
});
