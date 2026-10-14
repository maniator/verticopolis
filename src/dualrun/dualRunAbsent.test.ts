import { describe, expect, it } from "vitest";
import type * as dualRun from "./dualRun";
import * as absent from "./dualRunAbsent";

// The stand-in replaces dualRun.ts by alias in player and wasm-only builds;
// bootstrap.ts calls these two, so their signatures must keep matching.
const requested: typeof dualRun.dualRunRequested = absent.dualRunRequested;
const start: (app: dualRun.DualRunApp) => dualRun.DualRunHandle = absent.startDualRun;
void requested;
void start;

describe("dualRunAbsent", () => {
  it("is never requested and refuses to start", () => {
    expect(absent.dualRunRequested()).toBe(false);
    expect(() => absent.startDualRun({} as dualRun.DualRunApp)).toThrow(/not part of this build/);
  });
});
