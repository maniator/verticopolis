import { describe, expect, it } from "vitest";
import { catalogVerdict } from "./foreignCatalog";
import { fakeModule } from "./fakeEngine.fixture";

describe("catalogVerdict", () => {
  const own = fakeModule().catalog as (mode: "classic" | "modern") => string;

  it("calls the catalogs of a package that fits this build native", () => {
    expect(catalogVerdict(own)).toBe("native");
  });

  it("calls a missing catalog function foreign", () => {
    expect(catalogVerdict(undefined)).toBe("foreign");
  });

  it("calls a catalog this build rejects foreign: another version, or no shape", () => {
    expect(catalogVerdict(() => "{}")).toBe("foreign");
    expect(catalogVerdict((mode) => JSON.stringify({ ...JSON.parse(own(mode)), version: 999 }))).toBe("foreign");
  });

  it("says there is no verdict when the engine fails to hand the catalog over", () => {
    expect(catalogVerdict(() => "not json")).toBe("failing");
    expect(
      catalogVerdict(() => {
        throw new Error("unreachable");
      }),
    ).toBe("failing");
  });

  it("asks both modes, and the second one can be the foreign one", () => {
    expect(catalogVerdict((mode) => (mode === "classic" ? own(mode) : "{}"))).toBe("foreign");
    expect(catalogVerdict((mode) => (mode === "classic" ? own(mode) : "not json"))).toBe("failing");
  });
});
