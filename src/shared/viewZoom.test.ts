import { describe, expect, it } from "vitest";
import { VIEW_ZOOM_MAX, VIEW_ZOOM_MIN } from "./viewZoom";

describe("view zoom range", () => {
  // `VIEW_ZOOM_MIN` and `VIEW_ZOOM_MAX` in `engine-rs/src/load/coerce.rs` hold
  // the same pair, and its test pins them to these numbers. Change all three
  // together.
  it("is the range the engine clamps a loaded view to", () => {
    expect(VIEW_ZOOM_MIN).toBe(0.06);
    expect(VIEW_ZOOM_MAX).toBe(3);
  });
});
