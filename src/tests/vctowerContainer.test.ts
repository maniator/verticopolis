import { describe, expect, it } from "vitest";
import { deflateSync } from "fflate";
import { decodeVctower } from "../storage/vctowerContainer";

/**
 * The `.vctower` container decode used by `tools/simtower/vctower-to-tdt.ts`.
 *
 * The harness tool refused a real exported file whose magic carried no trailing
 * newline, which is whitespace the app itself tolerates. Fixing that reopened a
 * subtler trap: with no separator the version digits run straight into base64,
 * so "VCTOWER1" + "7Zt..." is equally "VCTOWER17" + "Zt...". These pin both the
 * fix and the trap, since nothing else in the suite covers this tool.
 */
const pack = (obj: unknown, magic = "VCTOWER1", separator = "\n") =>
  magic + separator + Buffer.from(deflateSync(new TextEncoder().encode(JSON.stringify(obj)))).toString("base64");

describe("vctower container decode", () => {
  it("reads a normal file, with the separating newline", () => {
    expect(decodeVctower(pack({ towerName: "Normal" }))).toEqual({ towerName: "Normal" });
  });

  it("reads a file written WITHOUT the separating newline", () => {
    expect(decodeVctower(pack({ towerName: "NoSep" }, "VCTOWER1", ""))).toEqual({ towerName: "NoSep" });
  });

  it("never blames a VERSION for a separator-less file whose payload starts with a digit", () => {
    // The trap that decoding-to-disambiguate exists to avoid: a greedy
    // /^VCTOWER(\d+)/ reads "VCTOWER1" + "7Zt..." as version 17 and rejects a
    // valid v1 file as one from the future.
    //
    // A VALID digit-leading fixture cannot be built with our own writer: the
    // first base64 char is the payload's first byte >> 2, so a digit needs a
    // leading byte >= 0xD0, and fflate's raw-deflate header never reaches that
    // for a JSON payload (searched 20k variants). So pin the decision instead:
    // a digit-leading payload that does NOT decode must be reported as damaged,
    // never as a version, which is exactly what the greedy read got wrong.
    expect(() => decodeVctower("VCTOWER17Zt-not-real-deflate", "digit.vctower")).toThrow(
      /digit\.vctower: unreadable \.vctower/,
    );
    expect(() => decodeVctower("VCTOWER17Zt-not-real-deflate", "digit.vctower")).not.toThrow(/VCTOWER17/);
  });

  it("tolerates re-wrapped whitespace inside the payload", () => {
    const text = pack({ towerName: "Wrapped" });
    const wrapped = text.slice(0, 20) + "\n  \n" + text.slice(20);
    expect(decodeVctower(wrapped)).toEqual({ towerName: "Wrapped" });
  });

  it("refuses a decompression bomb instead of allocating it", () => {
    // A few-KB container can be crafted to inflate to gigabytes. The cap has to
    // be enforced while inflating, not after: a plain inflateSync allocates the
    // whole output before anyone can object. 40 MB of zeros compresses to a few
    // KB and sits over the 32 MB cap.
    const bomb = "VCTOWER1\n" + Buffer.from(deflateSync(new Uint8Array(40 * 1024 * 1024))).toString("base64");
    expect(bomb.length).toBeLessThan(200_000); // the file itself really is small
    expect(() => decodeVctower(bomb, "bomb.vctower")).toThrow(/bomb\.vctower: this \.vctower expands to more data/);
    // And it is NOT reported as damaged or as a version problem: those send the
    // reader looking for the wrong thing.
    expect(() => decodeVctower(bomb, "bomb.vctower")).not.toThrow(/damaged|version/);
  });

  it("refuses a file that is not a tower file at all", () => {
    expect(() => decodeVctower("hello", "x.vctower")).toThrow(/x\.vctower: not a \.vctower file/);
  });

  it("names the version it cannot read, when a separator makes it unambiguous", () => {
    expect(() => decodeVctower(pack({ a: 1 }, "VCTOWER2"), "future.vctower")).toThrow(
      /future\.vctower: unsupported \.vctower version \(VCTOWER2/,
    );
  });

  it("reports a damaged v1 payload against the file it came from", () => {
    expect(() => decodeVctower("VCTOWER1\n@@@not-base64@@@", "broken.vctower")).toThrow(
      /broken\.vctower: damaged \.vctower payload/,
    );
  });

  it("settles a SEPARATED version before trying to read it as v1", () => {
    // A version like 17 shares the "VCTOWER1" prefix, so a prefix test alone
    // enters the v1 path for "VCTOWER17\n<payload>". If the leftover digit plus
    // the payload happened to form a valid stream, a file explicitly labelled a
    // version we do not read would be accepted and handed on as a tower. The
    // separator makes the version exact, so it is now settled first.
    //
    // The full exploit needs a digit-leading payload to move into the version
    // token, which our own writer cannot produce (see the digit test above), so
    // what is pinned here is the contract: every separated non-v1 version is
    // refused as a VERSION, never attempted and never reported as damaged.
    for (const version of ["2", "17", "10", "100"]) {
      const file = pack({ towerName: "T" }, `VCTOWER${version}`);
      expect(() => decodeVctower(file, "future.vctower")).toThrow(
        new RegExp(`unsupported \\.vctower version \\(VCTOWER${version};`),
      );
      expect(() => decodeVctower(file, "future.vctower")).not.toThrow(/damaged|unreadable/);
    }
  });

  it("names a non-v1 version when a single digit makes it unambiguous", () => {
    // "VCTOWER2zzzz" has no separator, but one digit can only be the version:
    // nothing else could belong to it.
    expect(() => decodeVctower("VCTOWER2zzzz", "odd.vctower")).toThrow(/unsupported \.vctower version \(VCTOWER2;/);
  });

  it("refuses to guess between two readings of a separator-less multi-digit version", () => {
    // "VCTOWER27z" is version 27 with payload "z", or version 2 with payload
    // "7z", and this decoder cannot try a non-v1 payload to find out.
    expect(() => decodeVctower("VCTOWER27zzzz", "amb.vctower")).toThrow(/the exact version cannot be read/);
    expect(() => decodeVctower("VCTOWER27zzzz", "amb.vctower")).not.toThrow(/VCTOWER27;/);
  });
});
