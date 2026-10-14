import { describe, expect, it } from "vitest";
import type * as dualRun from "./dualRun";
import * as absent from "./dualRunAbsent";

// The stand-in replaces dualRun.ts by alias in player and wasm-only builds;
// bootstrap.ts calls these two, so their signatures must keep matching.
// bootstrap.ts calls these with the defaults, so the stand-in's narrower
// parameter lists are compatible; every value export must be present.
const sameShape: Pick<typeof dualRun, "dualRunRequested" | "startDualRun"> = absent;
type ValueExports = { [K in keyof typeof dualRun]: (typeof dualRun)[K] extends (...a: never[]) => unknown ? K : never }[keyof typeof dualRun];
const allValues: Record<Exclude<ValueExports, keyof typeof absent>, never> = {};
void sameShape;
void allValues;

describe("dualRunAbsent", () => {
  it("is never requested and refuses to start", () => {
    expect(absent.dualRunRequested()).toBe(false);
    expect(() => absent.startDualRun({} as dualRun.DualRunApp)).toThrow(/not part of this build/);
  });
});
