import { describe, expect, it } from "vitest";
import { resolveOnlyFilter } from "./screenshotOnlyFilter.ts";

/**
 * Pins the ONLY= filter contract for the screenshot generator (AUD-033): a
 * non-empty filter that matches nothing must be distinguishable from "render
 * everything", so scripts/screenshots.ts can exit nonzero instead of
 * reporting an empty run as success.
 */
const IDS = ["showcase", "milestones", "tablet"] as const;

describe("screenshot ONLY filter resolution", () => {
  it("selects every scene when the filter is unset or blank", () => {
    for (const raw of [undefined, "", "  ", ","]) {
      const r = resolveOnlyFilter(IDS, raw);
      expect(r.selected).toEqual([...IDS]);
      expect(r.unmatched).toEqual([]);
    }
  });

  it("selects the matched subset and keeps scene order", () => {
    const r = resolveOnlyFilter(IDS, "tablet, showcase");
    expect(r.selected).toEqual(["showcase", "tablet"]);
    expect(r.unmatched).toEqual([]);
  });

  it("reports a fully-unmatched filter as zero selected with the entries named", () => {
    const r = resolveOnlyFilter(IDS, "mielstones");
    expect(r.selected).toEqual([]);
    expect(r.unmatched).toEqual(["mielstones"]);
  });

  it("reports partially-unmatched entries while still selecting the matches", () => {
    const r = resolveOnlyFilter(IDS, "milestones,gone-scene");
    expect(r.selected).toEqual(["milestones"]);
    expect(r.unmatched).toEqual(["gone-scene"]);
  });
});
