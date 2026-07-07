import { describe, it, expect } from "vitest";
import { parseUpdateInfo, MAX_NOTE_LEN, MAX_NOTES } from "../pwaUpdateInfo";

/**
 * The pure sanitizer that bounds an incoming version.json payload before it
 * reaches the update modal. These are the security-relevant caps — extracted
 * from pwa.ts's fetch so they can be exercised without a network or SW.
 */
describe("parseUpdateInfo — payload sanitization", () => {
  it("returns null for anything that isn't an object", () => {
    expect(parseUpdateInfo(null)).toBeNull();
    expect(parseUpdateInfo(undefined)).toBeNull();
    expect(parseUpdateInfo("nope")).toBeNull();
    expect(parseUpdateInfo(42)).toBeNull();
  });

  it("type-guards version and sha to strings (anything else → undefined)", () => {
    expect(parseUpdateInfo({ version: "1.2.3", sha: "abc1234" })).toMatchObject({
      version: "1.2.3",
      sha: "abc1234",
    });
    const bad = parseUpdateInfo({ version: 5, sha: { nope: true } });
    expect(bad).toMatchObject({ version: undefined, sha: undefined });
  });

  it("keeps only non-empty string notes, trimmed", () => {
    const r = parseUpdateInfo({ notes: ["  hi  ", 7, "", "   ", null, "there"] });
    expect(r?.notes).toEqual(["hi", "there"]);
  });

  it("clamps each note to MAX_NOTE_LEN characters", () => {
    const long = "x".repeat(MAX_NOTE_LEN + 50);
    const r = parseUpdateInfo({ notes: [long] });
    expect(r?.notes?.[0]).toHaveLength(MAX_NOTE_LEN);
  });

  it("caps the number of notes at MAX_NOTES", () => {
    const many = Array.from({ length: MAX_NOTES + 4 }, (_, i) => `note ${i}`);
    const r = parseUpdateInfo({ notes: many });
    expect(r?.notes).toHaveLength(MAX_NOTES);
    expect(r?.notes?.[0]).toBe("note 0"); // keeps the first N, in order
  });

  it("defaults notes to [] when the field is absent or not an array", () => {
    expect(parseUpdateInfo({})?.notes).toEqual([]);
    expect(parseUpdateInfo({ notes: "not-an-array" })?.notes).toEqual([]);
  });
});
