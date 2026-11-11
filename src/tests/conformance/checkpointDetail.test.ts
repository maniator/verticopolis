import { describe, expect, it } from "vitest";
import { DetailError, requireDetail } from "./checkpointDetail";

/** The record itself (money, log, save digests, fx slots) is held to the
 *  native Rust run by `fuzzWasmLeg.integration.test.ts`. */
describe("checkpoint detail", () => {
  it("turns a missing or failing detail into a DetailError", () => {
    expect(() => requireDetail({})).toThrow(DetailError);
    expect(() => requireDetail({ detail: () => { throw new Error("boom"); } })).toThrow(/boom/);
    expect(() => requireDetail({ detail: () => { throw new Error("boom"); } })).toThrow(DetailError);
  });
});
