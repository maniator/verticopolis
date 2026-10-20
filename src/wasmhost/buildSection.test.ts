import { describe, expect, it } from "vitest";
import {
  BUILD_SECTION,
  customSectionsOf,
  encodeBuildMetadata,
  parseBuildMetadata,
  stampBuildSection,
} from "./buildSection";

const HASH = "ab".repeat(32);
/** The smallest valid module: the header alone. */
const EMPTY = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
/** A module with one custom section and one type section. */
const text = (s: string) => new TextEncoder().encode(s);
const customSection = (name: string, payload: Uint8Array) => {
  const n = text(name);
  const body = [n.length, ...n, ...payload];
  return [0x00, body.length, ...body];
};
const concat = (...parts: (Uint8Array | number[])[]) =>
  Uint8Array.from(parts.flatMap((p) => [...p]));
const payloadText = (u: Uint8Array) => new TextDecoder().decode(u);

describe("parseBuildMetadata, a payload that is not UTF-8", () => {
  it("is malformed, not read with replacement characters", () => {
    const bad = Uint8Array.from([0x7b, 0xff, 0xfe, 0x7d]);
    expect(parseBuildMetadata([bad])).toEqual({ state: "malformed", why: "not JSON" });
  });

  it("does not accept a hash that only parses after replacement", () => {
    const json = text(`{"schema":1,"sourceHash":"${HASH}"}`);
    const withBad = Uint8Array.from([...json.subarray(0, 5), 0xc3, ...json.subarray(5)]);
    expect(parseBuildMetadata([withBad]).state).toBe("malformed");
  });
});

describe("stampBuildSection", () => {
  it("appends the section and leaves every other byte alone", () => {
    const other = concat(
      EMPTY,
      customSection("name", text("x")),
      [0x01, 0x01, 0x00],
    ); // a name section, then an empty type section
    const stamped = stampBuildSection(other, HASH);
    expect(stamped.subarray(0, other.length)).toEqual(other);
    expect(stamped.length).toBeGreaterThan(other.length);
    expect(
      parseBuildMetadata(customSectionsOf(stamped, BUILD_SECTION)),
    ).toEqual({ state: "ok", sourceHash: HASH });
    // The other custom section still reads.
    expect(customSectionsOf(stamped, "name").map(payloadText)).toEqual(["x"]);
  });

  it("uses a multi-byte length when the payload is long", () => {
    const stamped = stampBuildSection(EMPTY, HASH);
    const [section] = customSectionsOf(stamped, BUILD_SECTION);
    expect(section.length).toBe(encodeBuildMetadata(HASH).length);
    const big = concat(
      EMPTY,
      customSection("big", new Uint8Array(0)).slice(0, 0),
      [0x00, 0x80, 0x01, 0x03, ...text("big"), ...new Uint8Array(124)],
    );
    expect(customSectionsOf(big, "big")[0].length).toBe(124);
  });

  it("is deterministic: the same hash gives the same bytes", () => {
    expect(stampBuildSection(EMPTY, HASH)).toEqual(
      stampBuildSection(EMPTY, HASH),
    );
  });

  it("refuses to stamp twice, a bad hash and a file that is not a module", () => {
    expect(() =>
      stampBuildSection(stampBuildSection(EMPTY, HASH), HASH),
    ).toThrow(/already has/);
    expect(() => stampBuildSection(EMPTY, "xyz")).toThrow(/64 lowercase hex/);
    expect(() => stampBuildSection(EMPTY, HASH.toUpperCase())).toThrow(
      /64 lowercase hex/,
    );
    expect(() => stampBuildSection(new Uint8Array([1, 2, 3]), HASH)).toThrow(
      /not a WebAssembly/,
    );
  });
});

describe("customSectionsOf", () => {
  it("finds nothing in a module with no custom sections", () => {
    expect(customSectionsOf(EMPTY, BUILD_SECTION)).toEqual([]);
    expect(
      customSectionsOf(concat(EMPTY, [0x01, 0x01, 0x00]), BUILD_SECTION),
    ).toEqual([]);
  });

  it("matches the name exactly, not by prefix", () => {
    const m = concat(
      EMPTY,
      customSection(`${BUILD_SECTION}.x`, text("{}")),
      customSection("verticopolis", text("{}")),
    );
    expect(customSectionsOf(m, BUILD_SECTION)).toEqual([]);
  });

  it("reads every section with the name, in order", () => {
    const m = concat(
      EMPTY,
      customSection(BUILD_SECTION, text("a")),
      customSection(BUILD_SECTION, text("b")),
    );
    expect(customSectionsOf(m, BUILD_SECTION).map(payloadText)).toEqual([
      "a",
      "b",
    ]);
  });

  it("refuses a truncated or lying module", () => {
    expect(() =>
      customSectionsOf(concat(EMPTY, [0x00, 0x7f, 0x01]), BUILD_SECTION),
    ).toThrow(/past the end/);
    expect(() =>
      customSectionsOf(concat(EMPTY, [0x00]), BUILD_SECTION),
    ).toThrow(/section length/);
    expect(() =>
      customSectionsOf(concat(EMPTY, [0x00, 0x02, 0x7f, 0x00]), BUILD_SECTION),
    ).toThrow(/custom section name/);
  });
});

describe("parseBuildMetadata", () => {
  const ok = (v: unknown) => [text(JSON.stringify(v))];

  it("reads a good section", () => {
    expect(parseBuildMetadata(ok({ schema: 1, sourceHash: HASH }))).toEqual({
      state: "ok",
      sourceHash: HASH,
    });
  });

  it("ignores keys a later schema-1 writer adds", () => {
    expect(
      parseBuildMetadata(ok({ schema: 1, sourceHash: HASH, extra: [1] })).state,
    ).toBe("ok");
  });

  it("reports no section as missing", () => {
    expect(parseBuildMetadata([])).toEqual({ state: "missing" });
  });

  it.each([
    ["two sections", [text("{}"), text("{}")], /2 verticopolis.build sections/],
    ["text that is not JSON", [text("{nope")], /not JSON/],
    ["bytes that are not UTF-8", [Uint8Array.from([0xff, 0xfe])], /not JSON/],
    ["an array", ok([]), /not an object/],
    ["null", ok(null), /not an object/],
    ["another schema", ok({ schema: 2, sourceHash: HASH }), /not schema 1/],
    ["no schema", ok({ sourceHash: HASH }), /not schema 1/],
    ["no hash", ok({ schema: 1 }), /bad source hash/],
    ["a short hash", ok({ schema: 1, sourceHash: "abc" }), /bad source hash/],
    [
      "an upper-case hash",
      ok({ schema: 1, sourceHash: HASH.toUpperCase() }),
      /bad source hash/,
    ],
    ["a numeric hash", ok({ schema: 1, sourceHash: 5 }), /bad source hash/],
  ])("reports %s as malformed", (_name, payloads, why) => {
    const r = parseBuildMetadata(payloads as Uint8Array[]);
    expect(r.state).toBe("malformed");
    expect((r as { why: string }).why).toMatch(why);
  });

  it("reads an ArrayBuffer payload, as WebAssembly.Module.customSections returns", () => {
    const u = encodeBuildMetadata(HASH);
    const buf = u.buffer.slice(
      u.byteOffset,
      u.byteOffset + u.byteLength,
    ) as ArrayBuffer;
    expect(parseBuildMetadata([buf])).toEqual({
      state: "ok",
      sourceHash: HASH,
    });
  });
});
