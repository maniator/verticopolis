import { describe, expect, it } from "vitest";
import { parseEngineIdentity, readEngineIdentity } from "./engineIdentity";
import { IDENTITY_FIXTURE } from "./engineIdentity.fixture";

describe("readEngineIdentity", () => {
  it("returns the engine's text", () => {
    expect(readEngineIdentity({ engineIdentity: () => "{}" })).toBe("{}");
  });

  it("returns undefined for a package without the call", () => {
    expect(readEngineIdentity({})).toBeUndefined();
  });

  it("returns undefined when the call throws", () => {
    expect(
      readEngineIdentity({
        engineIdentity: () => {
          throw new Error("trap");
        },
      }),
    ).toBeUndefined();
  });
});

describe("parseEngineIdentity", () => {
  it("reads a full record", () => {
    expect(parseEngineIdentity(JSON.stringify(IDENTITY_FIXTURE))).toEqual(
      IDENTITY_FIXTURE,
    );
  });

  it("ignores fields a newer schema adds", () => {
    const text = JSON.stringify({ ...IDENTITY_FIXTURE, extra: { a: 1 } });
    expect(parseEngineIdentity(text)).toEqual(IDENTITY_FIXTURE);
  });

  it("rejects missing text, bad JSON and non-objects", () => {
    expect(parseEngineIdentity(undefined)).toBeNull();
    expect(parseEngineIdentity("")).toBeNull();
    expect(parseEngineIdentity("{nope")).toBeNull();
    expect(parseEngineIdentity("[]")).toBeNull();
    expect(parseEngineIdentity("null")).toBeNull();
  });

  it.each([
    ["schema", { schema: "1" }],
    ["crate", { crate: null }],
    ["crate name", { crate: { name: "", version: "1.0.0" } }],
    ["crate version", { crate: { name: "x", version: 3 } }],
    ["save version", { saveVersion: -1 }],
    ["oldest save version", { oldestSaveVersion: 1.5 }],
    ["frame layout", { frameLayoutVersion: undefined }],
    ["catalog version", { catalogVersion: "3" }],
    ["catalog digests", { catalogDigests: { classic: "a" } }],
    ["lock digest", { lockDigest: 5 }],
  ])("rejects a record with a bad %s", (_name, patch) => {
    const bad = JSON.stringify({ ...IDENTITY_FIXTURE, ...patch });
    expect(parseEngineIdentity(bad)).toBeNull();
  });
});
