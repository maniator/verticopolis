import { describe, expect, it } from "vitest";
import { deflateSync } from "fflate";
import {
  INFLATE_CHUNK_BYTES,
  MAX_SAVE_INFLATED_BYTES,
  SaveTooLargeError,
  inflateCapped,
} from "./saveCompression";

/**
 * The cap on a decompressed save can only be enforced BETWEEN pushes to the
 * inflater, so the real bound on a decompression bomb is how much output a
 * single push can produce before the check runs. These pin that relationship,
 * which is easy to lose by "tuning" the chunk size for throughput.
 */
describe("inflateCapped", () => {
  /** Deflate's theoretical ceiling: 1032 bytes out per byte in. */
  const MAX_DEFLATE_RATIO = 1032;

  it("round-trips ordinary data", () => {
    const data = new TextEncoder().encode(JSON.stringify({ tower: "ok", rooms: Array.from({ length: 500 }, (_, i) => i) }));
    expect(inflateCapped(deflateSync(data))).toEqual(data);
  });

  it("round-trips data larger than one push, so the chunking carries state", () => {
    // The input has to span several INFLATE_CHUNK_BYTES slices to prove the
    // inflater keeps its state across pushes, which needs data that does NOT
    // compress away: a deterministic LCG, so the fixture is stable.
    const data = new Uint8Array(300_000);
    let s = 0x9e3779b9;
    for (let i = 0; i < data.length; i++) {
      // xorshift32: an LCG's low bits carry enough structure that deflate still
      // squeezes it 16:1, which would leave this a single-push test.
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      data[i] = s & 0xff;
    }
    const packed = deflateSync(data);
    expect(packed.length).toBeGreaterThan(INFLATE_CHUNK_BYTES * 3); // really multi-push
    expect(inflateCapped(packed)).toEqual(data);
  });

  it("handles empty input", () => {
    expect(inflateCapped(deflateSync(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });

  it("refuses a bomb with SaveTooLargeError", () => {
    const bomb = deflateSync(new Uint8Array(MAX_SAVE_INFLATED_BYTES + 8 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(200_000); // a small file, by design
    expect(() => inflateCapped(bomb)).toThrow(SaveTooLargeError);
  });

  it("keeps one push's worst-case output well under the cap", () => {
    // This is the actual bound: a push can overshoot the cap by whatever it
    // produces before `ondata` runs, so the chunk has to be small enough that
    // even a maximally compressible slice cannot approach the cap. A 64 KiB
    // chunk would allow ~66 MB, more than the 32 MB cap it is meant to enforce.
    expect(INFLATE_CHUNK_BYTES * MAX_DEFLATE_RATIO).toBeLessThan(MAX_SAVE_INFLATED_BYTES / 2);
  });
});
