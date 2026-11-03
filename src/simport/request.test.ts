import { describe, expect, it } from "vitest";
import { INVALID_COMMAND, NOT_ENOUGH_MONEY } from "./request";

describe("the refusal texts the web compares against", () => {
  // The engine refuses with these exact words (`INVALID_REQUEST` and
  // `NOT_ENOUGH_MONEY` in `engine-rs/src/charges.rs`, which its own test pins
  // to the same literals). Change both sides together.
  it("match the engine's", () => {
    expect(INVALID_COMMAND).toBe("That request is not valid.");
    expect(NOT_ENOUGH_MONEY).toBe("Not enough money.");
  });
});
