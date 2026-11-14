import { describe, expect, it } from "vitest";
import { DEBUG_FLAG, debugFlagOn } from "./debugFlags";

describe("debug flags from the URL (#645)", () => {
  it("is off with no debug parameter", () => {
    expect(debugFlagOn("", DEBUG_FLAG.fps)).toBe(false);
    expect(debugFlagOn("?src=twa", DEBUG_FLAG.fps)).toBe(false);
  });

  it("turns on a named flag, alone or in a comma list", () => {
    expect(debugFlagOn("?debug=fps", DEBUG_FLAG.fps)).toBe(true);
    expect(debugFlagOn("?debug=draws,%20FPS", DEBUG_FLAG.fps)).toBe(true);
  });

  it("turns on every flag for all", () => {
    expect(debugFlagOn("?debug=all", DEBUG_FLAG.fps)).toBe(true);
  });

  it("does not match a flag that only contains the name", () => {
    expect(debugFlagOn("?debug=fpsx", DEBUG_FLAG.fps)).toBe(false);
  });
});
