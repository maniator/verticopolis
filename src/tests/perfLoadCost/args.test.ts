import { describe, expect, it } from "vitest";
import { parseArgs } from "./args";

const ok = ["--before", "a", "--after", "b"];

describe("parseArgs", () => {
  it("takes the two folders and defaults the rest", () => {
    expect(parseArgs(ok)).toMatchObject({ before: "a", after: "b", reps: 20, throttles: [1, 4], conditions: ["L2", "L1", "L3", "L4"], dt: 2 });
  });

  it("reads repetitions, throttles and conditions, in any case", () => {
    const o = parseArgs([...ok, "--reps", "8", "--throttle", "1", "--conditions", "l2,L3"]);
    expect(o).toMatchObject({ reps: 8, throttles: [1], conditions: ["L2", "L3"] });
  });

  it("refuses a missing folder, the same folder twice and too few repetitions", () => {
    expect(() => parseArgs(["--before", "a"])).toThrow(/both required/);
    expect(() => parseArgs(["--before", "a", "--after", "a"])).toThrow(/same folder/);
    expect(() => parseArgs([...ok, "--reps", "5"])).toThrow(/at least 6/);
  });

  it("refuses an unknown option, a missing value and a bad condition", () => {
    expect(() => parseArgs([...ok, "--nope"])).toThrow(/unknown option/);
    expect(() => parseArgs([...ok, "--reps"])).toThrow(/needs a value/);
    expect(() => parseArgs([...ok, "--conditions", "L9"])).toThrow(/not one of/);
    expect(() => parseArgs([...ok, "--throttle", "0"])).toThrow(/whole number/);
  });
});
