import { describe, expect, it } from "vitest";
import { bridgeCellKey, bridgeLookCells } from "./towerBridgeTiles";
import { drawsBridgeLook } from "../sprites/structure/skyBridge";

/** Which lobby cells the structure pass draws as a bridge look. */
describe("bridgeLookCells", () => {
  const looks = ["Lobby", "Glass Skywalk", "Steel Truss", "Deco Arcade", "Garden Walk"];

  it("marks every tile of a bridge in a drawn look with the look and its place on the bridge", () => {
    const cells = bridgeLookCells([{ floor: 15, from: 110, to: 113, look: 2 }], looks);
    expect([...cells.entries()]).toEqual([
      [bridgeCellKey(15, 110), { name: "Steel Truss", i: 0, n: 3 }],
      [bridgeCellKey(15, 111), { name: "Steel Truss", i: 1, n: 3 }],
      [bridgeCellKey(15, 112), { name: "Steel Truss", i: 2, n: 3 }],
    ]);
  });

  it("leaves a plain lobby bridge, an unknown look and a mode with no looks to the lobby tile", () => {
    expect(bridgeLookCells([{ floor: 15, from: 110, to: 113, look: 0 }], looks).size).toBe(0);
    expect(bridgeLookCells([{ floor: 15, from: 110, to: 113, look: 9 }], looks).size).toBe(0);
    expect(bridgeLookCells([{ floor: 15, from: 110, to: 113, look: 1 }], undefined).size).toBe(0);
  });

  it("draws each named look, and draws no plain lobby", () => {
    expect(looks.filter(drawsBridgeLook)).toEqual(looks.slice(1));
  });
});
