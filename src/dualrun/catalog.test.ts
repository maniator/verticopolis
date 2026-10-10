import { describe, expect, it } from "vitest";
import { CATALOG_VERSION, catalogFor } from "../engine/catalog";
import { readCatalog } from "./catalog";

const reply = (text: string) => ({ catalog: () => text });

describe("readCatalog", () => {
  it("parses the catalog the binding returns", () => {
    const want = catalogFor("modern");
    expect(readCatalog(reply(JSON.stringify(want)), "modern")).toEqual(want);
  });

  it("refuses a binding without the export", () => {
    expect(() => readCatalog({}, "classic")).toThrow(/exports no catalog/);
  });

  it("refuses a reply that is not a catalog", () => {
    for (const text of ["null", "[]", "3", '"catalog"']) {
      expect(() => readCatalog(reply(text), "classic"), text).toThrow(/returned no catalog/);
    }
    expect(() => readCatalog(reply("{truncated"), "classic")).toThrow(/returned no classic catalog/);
    const refusing = { catalog: () => { throw new Error("mode must be classic or modern"); } };
    expect(() => readCatalog(refusing, "classic")).toThrow(/returned no classic catalog: mode must be/);
    const { facilities: _f, ...partial } = catalogFor("classic");
    void _f;
    expect(() => readCatalog(reply(JSON.stringify(partial)), "classic")).toThrow(/without its world, economy, pools or facilities/);
  });

  it("refuses another shape version or another mode", () => {
    const classic = JSON.stringify(catalogFor("classic"));
    expect(() => readCatalog(reply(classic), "classic", CATALOG_VERSION + 1)).toThrow(/expected version/);
    expect(() => readCatalog(reply(JSON.stringify({ ...catalogFor("classic"), version: 99 })), "classic")).toThrow(/version 99/);
    expect(() => readCatalog(reply(classic), "modern")).toThrow(/asked for the modern catalog/);
  });
});
