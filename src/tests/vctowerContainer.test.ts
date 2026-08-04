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
const payloadOf = (obj: unknown) =>
  Buffer.from(deflateSync(new TextEncoder().encode(JSON.stringify(obj)))).toString("base64");
const pack = (obj: unknown, magic = "VCTOWER1", separator = "\n") => magic + separator + payloadOf(obj);

/** A tower whose payload really does base64 to a leading DIGIT, so the version
 *  digits and the payload run together with no separator. A long run of one
 *  character does it; short varied JSON never does, which is what made an
 *  earlier search for one conclude, wrongly, that our writer could not produce
 *  them at all. Asserted below rather than assumed, so a codec change cannot
 *  leave these tests quietly exercising the easy case. */
const DIGIT_LEADING_TOWER = { towerName: "DigitLead", filler: "a".repeat(4096) };

describe("vctower container decode", () => {
  it("reads a normal file, with the separating newline", () => {
    expect(decodeVctower(pack({ towerName: "Normal" }))).toEqual({ towerName: "Normal" });
  });

  it("reads a file written WITHOUT the separating newline", () => {
    expect(decodeVctower(pack({ towerName: "NoSep" }, "VCTOWER1", ""))).toEqual({ towerName: "NoSep" });
  });

  it("reads a separator-less file whose payload really does start with a digit", () => {
    // The trap: a greedy /^VCTOWER(\d+)/ reads "VCTOWER1" + "7c..." as version
    // 17 and rejects a perfectly good v1 tower as one from the future.
    const payload = payloadOf(DIGIT_LEADING_TOWER);
    expect(payload[0]).toMatch(/[0-9]/); // the fixture is genuinely ambiguous
    expect(decodeVctower("VCTOWER1" + payload)).toEqual(DIGIT_LEADING_TOWER);
  });

  it("reads that same file when it was re-wrapped right after the leading digit", () => {
    // The nastiest shape, because it looks exactly like a separated version:
    // whitespace inserted after the payload's leading digit turns the file into
    // "VCTOWER17\n<rest>", which is equally v17 and v1-with-a-digit-first
    // payload. Settling the version on that separator was tried here and threw
    // away this tower; decoding first is what tells the two apart.
    const payload = payloadOf(DIGIT_LEADING_TOWER);
    const rewrapped = "VCTOWER1" + payload[0] + "\n" + payload.slice(1);
    expect(/^VCTOWER1\d(?=\s)/.test(rewrapped)).toBe(true); // reads as a separated "17"
    expect(decodeVctower(rewrapped)).toEqual(DIGIT_LEADING_TOWER);
  });

  it("never blames a VERSION for a digit-leading payload that does not decode", () => {
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

  it("names a separated future version rather than calling it damaged", () => {
    // A genuine future version is still reported as one, even though the decode
    // is attempted first: its payload does not read as v1 JSON, so the version
    // claim is what is left to say. Settling the version BEFORE decoding was
    // tried instead, and the test above is why it did not survive: the same
    // bytes are also a v1 tower re-wrapped after a digit.
    // "17", "10" and "100" share the v1 prefix and are answered after the decode
    // fails; "2" and "27" never enter that branch at all. Both paths must name
    // the version rather than call the file damaged.
    for (const version of ["2", "17", "10", "100", "27"]) {
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
