import { deflateSync } from "fflate";
import { fromBase64, inflateCapped, STORE_MAGIC, toBase64, TOWER_FILE_MAGIC } from "./saveCompression";

/**
 * The `.vctower` container codec: localStorage `VCZ1:` values to `.vctower`
 * file text and back, byte-preserving by construction. Split out of
 * `saveMigration.ts` at the 500-line guard; that module owns WHEN a value
 * moves, this one owns the pure conversions whose correctness is a
 * byte-fidelity question (see the migration module's header for why nothing
 * here may deserialize: a decode-and-re-encode would burn Founder status).
 */

/** Outcome of converting one stored value into `.vctower` text. */
export type ConversionResult =
  | { readonly ok: true; readonly text: string; readonly kind: "reheadered" | "compressed" }
  | { readonly ok: false; readonly reason: "empty" | "unreadable" };

/**
 * True when the string holds half of a surrogate pair. `TextEncoder` replaces
 * one with U+FFFD, so the branch that encodes text must refuse rather than
 * quietly hand back a different string than it was given.
 *
 * Written as "delete every WELL-FORMED pair, then look for a survivor" instead
 * of the obvious lookbehind. Lookbehind is a parse-time SyntaxError on Safari
 * below 16.4, and the build targets `esnext` with no downleveling, so the
 * regex would not fail on old Safari, it would fail to PARSE, taking the whole
 * chunk with it. This formulation is ES5 and says the same thing.
 */
function hasLoneSurrogate(s: string): boolean {
  return /[\uD800-\uDFFF]/.test(s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""));
}

/**
 * The shape `SaveGame.import` demands before it will accept a tower. Applied
 * here so a value that is merely valid JSON (`null`, `42`, `[]`, `"hi"`) cannot
 * be dressed up as a `.vctower` and written into durable storage, which is the
 * exact outcome the validation exists to prevent.
 */
function looksLikeTower(parsed: unknown): boolean {
  const data = parsed as { minutes?: unknown; units?: unknown } | null;
  return typeof data === "object" && data !== null && typeof data.minutes === "number" && Array.isArray(data.units);
}

/**
 * Convert a raw localStorage value into `.vctower` file text.
 *
 * Pure, and pure on purpose: it is the one piece of this file whose correctness
 * is a byte-fidelity question, so it takes a string and returns a string with
 * no store, no clock, and no globals to stand in the way of testing it.
 *
 * `preserve` switches from "only carry a loadable tower" to "keep these bytes
 * whatever they are". See `MIGRATION_SOURCES` in `saveMigration.ts`.
 */
export function toTowerFile(raw: string, preserve = false): ConversionResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };

  // Checked ONCE, at the top, for every branch and both modes.
  //
  // It used to sit down in the raw-JSON branch, on the reasoning that only that
  // branch encodes text. That was true of this module and false of the system:
  // a re-headered payload is handed to the shell across a process bridge, which
  // encodes it there instead, so the substitution just happened somewhere this
  // file could not see. A well-formed VCZ1 value is base64 and therefore pure
  // ASCII, so hoisting the check costs nothing and closes the hole.
  if (hasLoneSurrogate(trimmed)) return { ok: false, reason: "unreadable" };

  if (trimmed.startsWith(STORE_MAGIC)) {
    const body = trimmed.slice(STORE_MAGIC.length);
    // In preserve mode the payload is passed through EXACTLY. Stripping
    // internal whitespace is a normalization, and a value that reached the
    // preserve destination is by definition one this build could not read, so
    // it is the last place to assume the contents follow the usual rules.
    // `SaveGame.import` strips whitespace itself when reading, so nothing is
    // lost by leaving it in.
    const payload = preserve ? body : body.replace(/\s+/g, "");
    // A header with no payload is not a rescue, it is an empty file that would
    // fail at import. UNREADABLE rather than empty: the value is not nothing,
    // it is a real save truncated down to its prefix, and reporting that as
    // "there was nothing to migrate" would tell the player their tower never
    // existed. Only a genuinely blank VALUE is empty, and that is caught above.
    if (payload.trim() === "") return { ok: false, reason: "unreadable" };
    const reheadered: ConversionResult = {
      ok: true,
      kind: "reheadered",
      text: TOWER_FILE_MAGIC + "\n" + payload + "\n",
    };
    if (preserve) return reheadered;
    // Validate by decoding, then THROW THE DECODED BYTES AWAY and re-header the
    // original. The check keeps a corrupt value from becoming a `.vctower` that
    // only fails at load, while the discard is what keeps the payload
    // identical. Both properties are wanted, and they are not in tension as
    // long as the validation output is never the thing written.
    //
    // Validated to the SAME bar the load path applies (fatal UTF-8, then JSON,
    // then the tower shape). Checking only that it inflates would pass values
    // `SaveGame.import` goes on to reject, which is the failure this prevents.
    try {
      const json = new TextDecoder("utf-8", { fatal: true }).decode(inflateCapped(fromBase64(payload)));
      if (!looksLikeTower(JSON.parse(json))) return { ok: false, reason: "unreadable" };
    } catch {
      return { ok: false, reason: "unreadable" };
    }
    return reheadered;
  }

  // Pre-compression save: raw JSON. `.vctower` readers require a deflate
  // payload, so this one really is re-encoded, but only the ENCODING changes.
  // The bytes fed to deflateSync are the trimmed string's own bytes, so no
  // field is added, removed, or restamped, and an absent appVersion stays
  // absent.
  if (!preserve) {
    try {
      if (!looksLikeTower(JSON.parse(trimmed))) return { ok: false, reason: "unreadable" };
    } catch {
      return { ok: false, reason: "unreadable" };
    }
  }
  const packed = deflateSync(new TextEncoder().encode(trimmed), { level: 1 });
  return { ok: true, kind: "compressed", text: TOWER_FILE_MAGIC + "\n" + toBase64(packed) + "\n" };
}

/**
 * The reverse of {@link toTowerFile}: `.vctower` text back to the `VCZ1:` form
 * `readSlot` expects.
 *
 * THREE-WAY, and that is the whole point of putting it here rather than
 * reaching for `SaveGame.import`. Import handles a newer container correctly
 * ("made by a newer version, update the game to load it") and it also
 * deserializes, which would burn Founder status on the way (see the migration
 * module's header). This has to preserve the same distinction WITHOUT
 * decoding, so it reports the three outcomes the caller actually has to tell
 * apart:
 *
 *  - `ok`: a `VCTOWER1` payload, re-headered. Same bytes, no decode.
 *  - `too-new`: a `VCTOWER<n>` this build cannot read. NOT an error, and
 *    emphatically not "absent". The record is real, may be recoverable by a
 *    later build, and must be preserved rather than reported as an empty slot
 *    that autosave may overwrite.
 *  - `unreadable`: not a tower container at all.
 *
 * Collapsing `too-new` into either of the others is the failure this shape
 * exists to prevent: as `unreadable` a newer save gets stashed and then
 * overwritten by the 30 second autosave; as absent, the splash offers New Tower
 * and the first save commits over it.
 */
export type FromTowerFileResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: "too-new" | "unreadable" };

export function fromTowerFile(text: string, preserve = false): FromTowerFileResult {
  const trimmed = text.trim();
  // Matches the whole VCTOWER family, exactly as `SaveGame.import` does, so a
  // newer container is RECOGNIZED before it is refused.
  const magic = /^VCTOWER(\d+)/.exec(trimmed);
  if (!magic) return { ok: false, reason: "unreadable" };
  if (magic[0] !== TOWER_FILE_MAGIC) return { ok: false, reason: "too-new" };

  // PRESERVE mode mirrors the forward migration's: the unreadable stash holds
  // bytes, not a tower, so its payload comes back verbatim rather than
  // whitespace-normalized. Verbatim in must mean verbatim out. ONE leading
  // newline is stripped, because that newline is the CONTAINER's own separator
  // (`toTowerFile` writes `VCTOWER1\n<payload>\n`), not part of the payload: a
  // review probe showed that keeping it turned every round trip into
  // `VCZ1:\n<payload>`, so the stash never matched its own cache again and
  // hydration reconciled it forward on every boot forever.
  if (preserve) {
    const body = trimmed.slice(magic[0].length).replace(/^\r?\n/, "");
    if (body.trim() === "") return { ok: false, reason: "unreadable" };
    return { ok: true, value: STORE_MAGIC + body };
  }

  // Whitespace-stripped, because `readSlot` does NOT strip it: it hands the
  // payload straight to `fromBase64`. `SaveGame.import` strips because a file
  // can be re-wrapped in transit, and a store is entitled to normalize line
  // endings on the way through (see `sameTowerFile`), so the same tolerance has
  // to be applied HERE rather than relied on downstream.
  const payload = trimmed.slice(magic[0].length).replace(/\s+/g, "");
  if (payload === "") return { ok: false, reason: "unreadable" };
  // Validated to the SAME bar as the forward direction, and by DOING the work
  // rather than pattern-matching it: decode, inflate, fatal-UTF-8, parse,
  // tower shape, then THROW THE DECODED BYTES AWAY and re-header the original,
  // so Founder is untouched (see the migration module's header). Two review
  // findings forced each half. A base64 regex still accepted strings `atob`
  // throws on (bad length or padding), so a corrupted record with an intact
  // header OVERWROTE a readable localStorage tower with a value `readSlot`
  // then called corrupt. And a payload that decodes to a non-tower ("42", a
  // bare object) would sail through `readSlot` into `Simulation.deserialize`,
  // which COERCES rather than throws, silently presenting a fresh tower as the
  // player's autosave. Refused instead, the record hydrates verbatim as
  // present-but-unreadable, keeping both the bytes and the slot row.
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(inflateCapped(fromBase64(payload)));
    if (!looksLikeTower(JSON.parse(json))) return { ok: false, reason: "unreadable" };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  return { ok: true, value: STORE_MAGIC + payload };
}

/**
 * Whether a read-back is the file we wrote.
 *
 * Compares the way `SaveGame.import` READS rather than byte for byte, because
 * a store is entitled to normalize line endings or trailing whitespace on the
 * way through, and a strict comparison would call every one of those a failed
 * write, forever, on every boot. What has to match is the payload the reader
 * will actually see.
 *
 * Exported for the write path's first-write read-back, which faces the same
 * store and therefore owes it the same tolerance: a review found the strict
 * `!==` it shipped with would flip every session on a normalizing shell to
 * degraded-refuse, permanently, while this comparator right here documented
 * why that is wrong.
 */
export function sameTowerFile(a: string, b: string): boolean {
  // The two halves are normalized SEPARATELY, because `SaveGame.import` anchors
  // on /^VCTOWER(\d+)/ first and only strips whitespace after that anchor.
  // Stripping across the boundary erases it, and `\d+` is greedy, so a payload
  // whose first base64 character is a digit gets swallowed into the version
  // number: "VCTOWER1\n7Zt..." and "VCTOWER17Zt..." would compare equal while
  // the reader sees version 17 and refuses the file as too new.
  const normalize = (s: string) => {
    const trimmed = s.trim();
    const magic = /^VCTOWER(\d+)/.exec(trimmed);
    return magic
      ? `${magic[0]}|${trimmed.slice(magic[0].length).replace(/\s+/g, "")}`
      : trimmed.replace(/\s+/g, "");
  };
  return normalize(a) === normalize(b);
}
