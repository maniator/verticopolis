import { SaveTooLargeError, inflateCapped } from "./saveCompression";

/**
 * Synchronous decode of the `.vctower` container (magic, then base64 of DEFLATE
 * JSON; see `saveCompression.ts`) for callers running under Node.
 *
 * Every path here treats its input as UNTRUSTED, so the payload goes through
 * `inflateCapped` rather than a bare `inflateSync`: a few-KB file can be crafted
 * to inflate to gigabytes, and the plain call allocates the whole output before
 * anyone can object. That is the same posture the browser import path takes.
 *
 * The APP reads tower files through `SaveGame.import`, which is async because it
 * inflates with the platform `DecompressionStream` and goes on to build a
 * `Simulation`. This is the same container parsed with fflate, for tools that
 * have neither a browser nor a need for a Simulation, notably the `.TDT` harness
 * converter in `tools/simtower/`. It lives beside the format it decodes rather
 * than inside that tool so the unit suite covers it, and so the
 * magic-and-payload split has one home instead of a tool-local copy.
 */

/**
 * Parse a `.vctower` file's text into its save object.
 *
 * The version digits cannot be read off by pattern alone. The app writes a
 * newline after the magic, but that is whitespace and a file written without it
 * still loads in the game. With no separator "VCTOWER1" + "7Zt..." is equally
 * "VCTOWER17" + "Zt...", and base64 starts with a digit often enough that a
 * greedy `VCTOWER(\d+)` rejects roughly one separator-less v1 file in six as a
 * version from the future (`SaveGame.import` has that quirk; saveMigrationRun
 * .test.ts pins it). So DECODE to disambiguate: try v1, and only if those bytes
 * are not a v1 payload fall back to the version the digits claim.
 *
 * `label` prefixes every error, so a caller reading files can name the file.
 */
export function decodeVctower(text: string, label = "vctower"): unknown {
  const trimmed = text.trim();
  if (!/^VCTOWER\d/.test(trimmed)) throw new Error(`${label}: not a .vctower file (no VCTOWER magic)`);
  // DECODE FIRST, then reason about the version. A separator looks like it
  // settles the version, and settling it first was tried here, but it rejects
  // real files: `VCTOWER17\n<rest>` is equally a v17 file AND a v1 file whose
  // payload begins with `7` and was re-wrapped after that digit, which is
  // ordinary whitespace tolerance. Both readings are genuinely available for the
  // same bytes, and our own writer does produce digit-leading payloads (a tower
  // with a long run of repeated characters compresses to one), so refusing on
  // the version claim throws away a tower that opens perfectly.
  //
  // Trying v1 first resolves it the only way that cannot lose data: if those
  // bytes ARE a v1 payload, the file is one, whatever the digits looked like. A
  // genuine future version is still named below, because its payload will not
  // decode as v1 JSON, and a file that both claims v17 and decodes as a valid v1
  // tower is one we should open rather than argue with.
  if (/^VCTOWER1/.test(trimmed)) {
    try {
      const b64 = trimmed.slice("VCTOWER1".length).replace(/\s+/g, "");
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(inflateCapped(Buffer.from(b64, "base64"))),
      );
    } catch (e) {
      // A decompression bomb is not a version question and not a damaged file:
      // it decoded fine and is simply too big to hold, so say that instead of
      // falling into the version reasoning below.
      if (e instanceof SaveTooLargeError) {
        throw new Error(`${label}: this .vctower expands to more data than we will hold; it looks crafted, not saved.`);
      }
      // Only a version OTHER than 1 can hide here, and only in a file with no
      // separator; with one, the digits are unambiguous and this is simply a
      // damaged v1 file.
      const claimed = /^VCTOWER(\d+)(?=\s|$)/.exec(trimmed)?.[1];
      if (claimed !== undefined && claimed !== "1") {
        throw new Error(`${label}: unsupported .vctower version (VCTOWER${claimed}; this decoder reads VCTOWER1)`);
      }
      // Buffer.from(..., "base64") drops anything outside the alphabet instead
      // of failing, so a truncated or mangled container surfaces as a raw fflate
      // or JSON error. Wrap it so every failure carries its file. With no
      // separator the version is unknowable once the v1 read fails, so say both
      // things it could be rather than assert the wrong one.
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(
        claimed === undefined
          ? `${label}: unreadable .vctower (damaged, or a version after VCTOWER1 written without a separating newline): ${detail}`
          : `${label}: damaged .vctower payload (${detail})`,
      );
    }
  }
  // Reached by a file whose magic is not "VCTOWER1" at all, so its version is
  // whatever its digits say. (A v1-looking file that failed to decode is
  // answered inside the branch above, where the failure is the evidence.)
  //
  // Name the version only when it can be read exactly: a separator, or a single
  // digit, leaves nothing else it could be. Two or more digits running into the
  // payload could split either way ("VCTOWER27z" is version 27, or version 2
  // with payload "7z"), and this decoder cannot try a non-v1 payload to find
  // out, so it says what it knows instead of asserting a version that may not
  // exist.
  const digits = /^VCTOWER(\d+)/.exec(trimmed)![1];
  if (/^VCTOWER\d+(?=\s|$)/.test(trimmed) || digits.length === 1) {
    throw new Error(`${label}: unsupported .vctower version (VCTOWER${digits}; this decoder reads VCTOWER1)`);
  }
  throw new Error(
    `${label}: unsupported .vctower version (not VCTOWER1; the version digits run into the payload with no separating newline, so the exact version cannot be read)`,
  );
}
