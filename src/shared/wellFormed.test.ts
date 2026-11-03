import { describe, expect, it } from "vitest";
import { wellFormed } from "./wellFormed";

const HIGH = "\ud83c";
const LOW = "\udfe2";
const PAIR = HIGH + LOW;
const native = (String.prototype as { toWellFormed?: (this: string) => string }).toWellFormed;

describe("wellFormed", () => {
  it("replaces each lone half of a surrogate pair with U+FFFD and keeps pairs", () => {
    expect(wellFormed("Sky " + HIGH)).toBe("Sky \uFFFD");
    expect(wellFormed(LOW + " Sky")).toBe("\uFFFD Sky");
    expect(wellFormed(PAIR)).toBe(PAIR);
    expect(wellFormed(HIGH + PAIR)).toBe("\uFFFD" + PAIR);
    expect(wellFormed(LOW + HIGH)).toBe("\uFFFD\uFFFD");
    expect(wellFormed("plain, caf\u00e9, \uFFFF")).toBe("plain, caf\u00e9, \uFFFF");
    expect(wellFormed("")).toBe("");
  });

  it.runIf(native !== undefined)("agrees with String.prototype.toWellFormed where the runtime has it", () => {
    const units = [HIGH, LOW, "a", "\u0000", "\uFFFD", PAIR];
    for (let n = 0; n < 2000; n++) {
      let s = "";
      for (let k = (n * 7) % 9; k > 0; k--) s += units[(n * 31 + k * 17) % units.length];
      expect(wellFormed(s), JSON.stringify(s)).toBe(native!.call(s));
    }
  });
});
