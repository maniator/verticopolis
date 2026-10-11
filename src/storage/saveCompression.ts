import { Inflate } from "fflate";
import { wellFormed } from "../engine/wellFormed";

/**
 * Compression + base64 codec for the persistence layer. Extracted from
 * `SaveGame.ts`: a pure codec with no localStorage or Simulation coupling.
 *
 * Two directions coexist. localStorage saves use fflate's SYNCHRONOUS
 * inflate/deflate (see `SaveGame.saveTo`), because the write can run right
 * before a reload where an async flush could be lost. The `.vctower` FILE path
 * uses the native async CompressionStream (user-initiated, never racing a
 * reload). Untrusted input is always inflated behind a size cap so a
 * decompression bomb can't hang the tab.
 */

/**
 * Prefix marking a compressed localStorage value: this magic, then the base64
 * of the DEFLATE-compressed JSON. A legacy uncompressed save is raw JSON
 * (starts with `{`), so the prefix check cleanly tells the two apart and old
 * saves keep loading; they re-write compressed on the next save.
 */
export const STORE_MAGIC = "VCZ1:";

/**
 * First line of the `.vctower` container, naming the format and its version.
 * The payload after it is the same deflate-then-base64 as {@link STORE_MAGIC}.
 *
 * Both live here, in the codec module, rather than beside their readers,
 * because the two containers wrap byte-identical payloads and the desktop
 * migration converts one into the other by rewriting only the header (see
 * `./saveMigration.ts`). Splitting them across modules is how that stops being
 * obviously true.
 */
export const TOWER_FILE_MAGIC = "VCTOWER1";

// Base64 over raw bytes, chunked so String.fromCharCode never sees an argument
// list long enough to blow the stack.
export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Cap on a decompressed localStorage save. A maxed-out tower is well under 2MB
// of JSON; 32MB is generous headroom. localStorage is quota-bounded and
// same-origin, but a corrupt or tampered VCZ1 value could still inflate
// enormously and hang the tab at boot, so, like the .vctower import path, we
// bound it. fflate's streaming Inflate lets us abort as soon as the output
// passes the cap (inflateSync would allocate the whole buffer first).
export const MAX_SAVE_INFLATED_BYTES = 32 * 1024 * 1024;

/** Thrown by {@link inflateCapped} when the output passes
 *  MAX_SAVE_INFLATED_BYTES. Exported so a caller can tell "this expands to more
 *  than we will hold" apart from "these bytes are damaged", which are different
 *  things to tell a player. */
export class SaveTooLargeError extends Error {}

/**
 * `JSON.parse` for a save's text, with every string (and every object key)
 * repaired by {@link wellFormed}: half of a surrogate pair reads as U+FFFD,
 * exactly as the Rust engine reads save text (`load::parse_save_json`), so a
 * save loads into the same tower on both engines. The loader keeps
 * `excavated` and `milestones` in sets, so two halves that repair to one
 * string collapse to one entry, as the Rust loader dedupes them.
 */
export function parseSaveJson(text: string): unknown {
  return JSON.parse(text, (_key, value: unknown) => {
    if (typeof value === "string") return wellFormed(value);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const obj = value as Record<string, unknown>;
    if (Object.keys(obj).every((k) => wellFormed(k) === k)) return obj;
    const fixed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) fixed[wellFormed(k)] = v;
    return fixed;
  });
}

/**
 * A save's JSON text as the UTF-8 bytes every writer compresses, refused with
 * {@link SaveTooLargeError} when it passes {@link MAX_SAVE_INFLATED_BYTES}:
 * every reader stops there, so a larger save would write and then fail to
 * open as a file that looks crafted. A real tower is about 2 MB. The Rust
 * engine's writer (`load::encode_vctower`) refuses at the same bound.
 */
export function encodeSaveJson(json: string): Uint8Array {
  const bytes = new TextEncoder().encode(json);
  if (bytes.length > MAX_SAVE_INFLATED_BYTES) {
    throw new SaveTooLargeError("This tower's save data is larger than 32 MB, the most a save can hold.");
  }
  return bytes;
}

/** Compressed bytes fed to the inflater per push. The cap can only be enforced
 *  BETWEEN pushes, so this is what actually bounds a decompression bomb: the
 *  overshoot past {@link MAX_SAVE_INFLATED_BYTES} is at most what one push can
 *  produce, and deflate's ceiling is ~1032x. At 8 KiB that is ~8.5 MB on top of
 *  the 32 MB cap; a 64 KiB slice would allow ~66 MB, more than the cap itself,
 *  which is not much of a bound. Smaller costs only push calls: even a 2 MB
 *  save is a few hundred, and fflate carries its state across them. */
export const INFLATE_CHUNK_BYTES = 8 * 1024;

export function inflateCapped(packed: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total > MAX_SAVE_INFLATED_BYTES) throw new SaveTooLargeError();
    chunks.push(chunk);
  });
  // Feed the input in slices rather than one push. `ondata` fires synchronously
  // per push, so the cap is checked as the output grows; a single push of the
  // whole input lets fflate inflate EVERYTHING first and only then hand it over,
  // which means a crafted bomb is fully allocated before the check that is
  // supposed to refuse it ever runs.
  for (let at = 0; at < packed.length; at += INFLATE_CHUNK_BYTES) {
    const end = Math.min(at + INFLATE_CHUNK_BYTES, packed.length);
    inflater.push(packed.subarray(at, end), end === packed.length);
  }
  if (packed.length === 0) inflater.push(packed, true);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// Per-direction support probes, built by actually constructing the streams:
// the "deflate-raw" format string is newer than CompressionStream itself
// (Chrome had the API before the format), so a `typeof` check alone would pass
// on browsers that then throw at use. Probed separately because each caller
// needs only one direction (export/saveToAsync encode, import decodes), and a
// browser missing one must not be blocked from the operation it can perform.
export function compressionEncodeSupported(): boolean {
  try {
    new CompressionStream("deflate-raw");
    return true;
  } catch {
    return false;
  }
}

export function compressionDecodeSupported(): boolean {
  try {
    new DecompressionStream("deflate-raw");
    return true;
  } catch {
    return false;
  }
}

/** Thrown by {@link inflate} when a decompressing stream exceeds
 *  {@link MAX_SAVE_INFLATED_BYTES}, the one cap every save reader and writer
 *  holds to (see {@link encodeSaveJson}). */
export class TowerTooLargeError extends Error {}

// deflate-raw via the native streams API (no zlib/gzip framing, the magic
// line already identifies the format, and raw deflate is the smallest).
export function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  // Compressing our own bounded JSON, no cap needed on the output.
  return pipe(bytes, new CompressionStream("deflate-raw"));
}

export function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  // Decompressing untrusted input, cap the output to bound bombs.
  return pipe(bytes, new DecompressionStream("deflate-raw"), MAX_SAVE_INFLATED_BYTES);
}

async function pipe(bytes: Uint8Array, transform: GenericTransformStream, maxBytes = Infinity): Promise<Uint8Array> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  }).pipeThrough(transform);
  // Read chunk by chunk so a bomb is aborted mid-inflation, before it can
  // materialize a giant buffer, rather than Response().arrayBuffer(), which
  // would buffer the whole (unbounded) output first.
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new TowerTooLargeError();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
