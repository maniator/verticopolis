import { describe, it, expect } from "vitest";
import { deflateSync, zlibSync } from "fflate";
import { markFounderFromLoadedFile } from "../engine/sim/founderStatus";
import { fromBase64, inflate, inflateCapped, STORE_MAGIC, toBase64, TOWER_FILE_MAGIC } from "./saveCompression";
import { toTowerFile } from "./towerFileCodec";

/**
 * The pure byte-fidelity codec (localStorage `VCZ1:` values to `.vctower` text).
 * Everything here takes a string and returns a string. The reverse direction
 * is pinned in `saveRehydrate.test.ts`.
 */

/** A tower as an OLD build wrote it: no appVersion, which is the whole point.
 *  Carries the two fields `SaveGame.import` insists on. */
const PRE_2_0_SAVE = { minutes: 4321, units: [{ t: "office" }], towerName: "Old Guard", money: 500 };

/** Packs a value exactly as `SaveGame.saveTo` writes it into localStorage. */
function storeValue(obj: unknown): string {
  return STORE_MAGIC + toBase64(deflateSync(new TextEncoder().encode(JSON.stringify(obj)), { level: 1 }));
}

/** Decode `.vctower` text the way `SaveGame.import` would. */
function decodeTowerFile(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  expect(trimmed.startsWith(TOWER_FILE_MAGIC + "\n")).toBe(true);
  const payload = trimmed.slice(TOWER_FILE_MAGIC.length).replace(/\s+/g, "");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(inflateCapped(fromBase64(payload)))) as Record<
    string,
    unknown
  >;
}

describe("toTowerFile (the byte-fidelity codec)", () => {
  it("re-headers a compressed save without touching the payload", () => {
    const raw = storeValue(PRE_2_0_SAVE);
    const result = toTowerFile(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("reheadered");
    // THE property. The base64 after the new header is character-for-character
    // the base64 that was after the old one, so nothing was decoded and
    // re-encoded along the way.
    expect(result.text).toBe(TOWER_FILE_MAGIC + "\n" + raw.slice(STORE_MAGIC.length) + "\n");
  });

  it("keeps a pre-2.0 tower's appVersion ABSENT, which is what earns Founder", () => {
    // The hazard this whole module is shaped around. `stamp()` sets appVersion
    // unconditionally, so any conversion that deserialized and re-saved would
    // hand this tower a version string and silently cost the player the badge.
    const result = toTowerFile(storeValue(PRE_2_0_SAVE));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const decoded = decodeTowerFile(result.text);
    expect(decoded.appVersion).toBeUndefined();
    expect(decoded).toEqual(PRE_2_0_SAVE);

    // And the badge really does follow from that field being absent.
    const sim = { founder: false };
    markFounderFromLoadedFile(sim, decoded);
    expect(sim.founder).toBe(true);
  });

  it("NEGATIVE CONTROL: a stamped tower does not earn Founder", () => {
    // Without this, the assertion above would pass even if
    // markFounderFromLoadedFile granted the badge unconditionally, and the test
    // would be proving nothing about the codec at all.
    const stamped = { ...PRE_2_0_SAVE, appVersion: "2.4.0" };
    const result = toTowerFile(storeValue(stamped));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sim = { founder: false };
    markFounderFromLoadedFile(sim, decodeTowerFile(result.text));
    expect(sim.founder).toBe(false);
  });

  it("compresses a pre-compression raw-JSON save without re-serializing it", () => {
    // The one case that genuinely re-encodes. It must still not parse-and-write:
    // key ORDER survives here, which it would not if the object had been parsed
    // and re-stringified through a code path that rebuilt it.
    const json = '{"minutes":10,"towerName":"Legacy","units":[]}';
    const result = toTowerFile(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("compressed");
    const payload = result.text.trim().slice(TOWER_FILE_MAGIC.length).replace(/\s+/g, "");
    expect(new TextDecoder().decode(inflateCapped(fromBase64(payload)))).toBe(json);
    expect(decodeTowerFile(result.text).appVersion).toBeUndefined();
  });

  it("refuses a value that will not decode, rather than writing a broken tower file", () => {
    expect(toTowerFile(STORE_MAGIC + "not!valid!base64!")).toEqual({ ok: false, reason: "unreadable" });
    expect(toTowerFile(STORE_MAGIC + toBase64(new Uint8Array([1, 2, 3, 4])))).toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(toTowerFile("{ this is not json")).toEqual({ ok: false, reason: "unreadable" });
  });

  it("refuses valid JSON that is not a tower, in BOTH branches", () => {
    // `JSON.parse` succeeding is not the bar. Left alone, each of these becomes
    // a VCTOWER1 file in durable storage that only fails at import, which is
    // precisely what validating here is supposed to prevent.
    for (const junk of ["null", "42", "[]", '"hello"', "{}", '{"minutes":1}', '{"units":[]}']) {
      expect(toTowerFile(junk), `raw JSON ${junk}`).toEqual({ ok: false, reason: "unreadable" });
      expect(toTowerFile(storeValue(JSON.parse(junk))), `compressed ${junk}`).toEqual({
        ok: false,
        reason: "unreadable",
      });
    }
  });

  it("refuses a raw-JSON value carrying a lone surrogate rather than mangling it", () => {
    // This is the only branch that encodes text, and TextEncoder replaces a
    // lone surrogate with U+FFFD. Migrating it would produce a quietly
    // different tower name, which is worse than declining.
    const withLoneSurrogate = '{"minutes":1,"units":[],"towerName":"bad\uD800name"}';
    expect(JSON.parse(withLoneSurrogate)).toBeTruthy(); // it IS valid JSON
    expect(toTowerFile(withLoneSurrogate)).toEqual({ ok: false, reason: "unreadable" });
  });

  it("treats an empty or whitespace value as absent", () => {
    expect(toTowerFile("")).toEqual({ ok: false, reason: "empty" });
    expect(toTowerFile("   \n ")).toEqual({ ok: false, reason: "empty" });
  });

  it("in preserve mode, keeps bytes it cannot decode", () => {
    // The `unreadable` destination exists to hold what this build could not
    // read. Gating it on decodability would refuse exactly those bytes.
    const undecodable = STORE_MAGIC + toBase64(new Uint8Array([9, 9, 9, 9]));
    expect(toTowerFile(undecodable).ok).toBe(false);
    const preserved = toTowerFile(undecodable, true);
    expect(preserved.ok).toBe(true);
    if (!preserved.ok) return;
    // The bytes survive verbatim, which is the entire job.
    expect(preserved.text).toBe(TOWER_FILE_MAGIC + "\n" + undecodable.slice(STORE_MAGIC.length) + "\n");
    // Still refuses genuinely empty input, which carries nothing to preserve.
    expect(toTowerFile("", true)).toEqual({ ok: false, reason: "empty" });
  });
});

/**
 * The assumption the whole design rests on, asserted rather than believed.
 *
 * localStorage packs with fflate (synchronous, so a pre-reload flush cannot be
 * lost) and `.vctower` packs with CompressionStream. The re-header is only
 * sound because both emit RAW deflate. If that ever stops being true, this
 * module has to start decoding, which reopens the Founder hazard, so it should
 * surface as a failing test and not as quietly lost badges.
 */
describe("the two containers wrap the same bytes", () => {
  it("a fflate-packed payload decodes through the .vctower reader's own path", async () => {
    const json = JSON.stringify(PRE_2_0_SAVE);
    const packed = deflateSync(new TextEncoder().encode(json), { level: 1 });
    // `inflate` is DecompressionStream("deflate-raw"), the exact call
    // SaveGame.import makes. Feeding it fflate's output is the compatibility
    // claim, stated directly.
    expect(new TextDecoder().decode(await inflate(packed))).toBe(json);
  });

  it("NEGATIVE CONTROL: zlib-framed bytes are rejected by that path", async () => {
    // Proves the check above discriminates. fflate's zlibSync differs from
    // deflateSync only by the framing the raw reader must refuse, so if this
    // passed, the assertion above would hold for any compressor at all.
    await expect(inflate(zlibSync(new TextEncoder().encode(JSON.stringify(PRE_2_0_SAVE))))).rejects.toThrow();
  });
});
describe("preserve mode, every combination", () => {
  it("refuses a lone surrogate even in preserve mode, rather than mangling it", () => {
    // The guard originally sat inside the `!preserve` block, so the one mode
    // that promises byte fidelity was the one mode that could silently rewrite
    // a character as U+FFFD. A preserved value only reaches the encoding branch
    // when it is NOT VCZ1-prefixed, which for the unreadable backup is exactly
    // the arbitrary-bytes case the mode exists for.
    const raw = 'garbage\uD800bytes';
    expect(toTowerFile(raw, true)).toEqual({ ok: false, reason: "unreadable" });
    expect(toTowerFile(raw, false)).toEqual({ ok: false, reason: "unreadable" });
  });

  it("carries a non-VCZ1 preserved value through when it can be encoded faithfully", () => {
    // Not JSON, not a tower, no magic prefix. Preserve mode still takes it.
    const raw = "totally corrupt bytes, not json at all";
    expect(toTowerFile(raw, false)).toEqual({ ok: false, reason: "unreadable" });
    const preserved = toTowerFile(raw, true);
    expect(preserved.ok).toBe(true);
    if (!preserved.ok) return;
    const payload = preserved.text.trim().slice(TOWER_FILE_MAGIC.length).replace(/\s+/g, "");
    expect(new TextDecoder().decode(inflateCapped(fromBase64(payload)))).toBe(raw);
  });

  it("refuses a header with no payload as UNREADABLE, not as absent", () => {
    // A VCTOWER1 line and nothing after it is an empty file, not a rescue. The
    // distinction matters downstream: `empty` maps to "absent", so calling this
    // empty would report there was nothing to carry over when what they
    // actually have is a real save truncated to its prefix.
    for (const preserve of [true, false]) {
      expect(toTowerFile(STORE_MAGIC, preserve), `preserve=${preserve}`).toEqual({ ok: false, reason: "unreadable" });
      expect(toTowerFile(STORE_MAGIC + "   ", preserve), `preserve=${preserve}`).toEqual({
        ok: false,
        reason: "unreadable",
      });
    }
    // A genuinely blank VALUE is still empty, and still means absent.
    expect(toTowerFile("", true)).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses a lone surrogate on EVERY branch, including a preserved re-header", () => {
    // The guard used to sit in the raw-JSON branch only, which was true of this
    // module and false of the system: a re-headered payload is handed to the
    // shell across a process bridge, which encodes it there instead, so the
    // U+FFFD substitution simply happened somewhere this file could not see.
    for (const preserve of [true, false]) {
      expect(toTowerFile(STORE_MAGIC + "AAAA\uD800AAAA", preserve), `preserve=${preserve}`).toEqual({
        ok: false,
        reason: "unreadable",
      });
    }
    // A well-formed VCZ1 value is base64 and therefore pure ASCII, so hoisting
    // the check costs a real save nothing.
    expect(toTowerFile(storeValue(PRE_2_0_SAVE)).ok).toBe(true);
  });

  it("passes a preserved payload through without normalizing its whitespace", () => {
    // A value that reached the preserve destination is by definition one this
    // build could not read, so it is the last place to assume the contents
    // follow the usual rules. SaveGame.import strips whitespace when reading.
    const spaced = "AAAA\nBBBB";
    const preserved = toTowerFile(STORE_MAGIC + spaced, true);
    expect(preserved.ok).toBe(true);
    if (!preserved.ok) return;
    expect(preserved.text).toBe(TOWER_FILE_MAGIC + "\n" + spaced + "\n");
  });
});
