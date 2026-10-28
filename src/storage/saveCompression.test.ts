import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deflateSync } from "fflate";
import {
  encodeSaveJson,
  parseSaveJson,
  repairSurrogateEscapes,
  INFLATE_CHUNK_BYTES,
  MAX_SAVE_INFLATED_BYTES,
  SaveTooLargeError,
  inflateCapped,
} from "./saveCompression";
import { toTowerFile } from "./towerFileCodec";
import { Simulation } from "../engine/Simulation";
import { SaveGame } from "./SaveGame";
import { saveOf } from "../tests/fixtures/saveText";

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
    // inflater keeps its state across pushes, so it needs bytes that do NOT
    // compress away, generated deterministically to keep the fixture stable.
    // xorshift32 rather than a linear congruential generator: an LCG's low bits
    // carry enough structure that deflate still squeezed 300 KB down to 18 KB,
    // which would have quietly made this a single-push test.
    const data = new Uint8Array(300_000);
    let s = 0x9e3779b9;
    for (let i = 0; i < data.length; i++) {
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

/** One cap for every writer: a save the readers would refuse is never written. */
describe("encodeSaveJson", () => {
  it("encodes a save as UTF-8 up to the read cap", () => {
    expect(encodeSaveJson('{"towerName":"Caf\u00e9"}')).toEqual(new TextEncoder().encode('{"towerName":"Caf\u00e9"}'));
    expect(encodeSaveJson("x".repeat(MAX_SAVE_INFLATED_BYTES)).length).toBe(MAX_SAVE_INFLATED_BYTES);
  });

  it("refuses a save one byte past the cap, counting UTF-8 bytes", () => {
    expect(() => encodeSaveJson("x".repeat(MAX_SAVE_INFLATED_BYTES + 1))).toThrow(SaveTooLargeError);
    // 2 bytes per character in UTF-8, so half as many characters pass the cap.
    expect(() => encodeSaveJson("\u00e9".repeat(MAX_SAVE_INFLATED_BYTES / 2 + 1))).toThrow(SaveTooLargeError);
  });

  it("keeps toTowerFile from writing a .vctower no reader opens, except in preserve mode", () => {
    const pad = "x".repeat(MAX_SAVE_INFLATED_BYTES);
    const raw = `{"minutes":0,"units":[],"pad":"${pad}"}`;
    expect(toTowerFile(raw)).toEqual({ ok: false, reason: "unreadable" });
    expect(toTowerFile(raw, true).ok).toBe(true);
  });
});

/** Save text reads the way the Rust engine reads it (`load::parse_save_json`). */
describe("parseSaveJson", () => {
  // JSON.stringify writes half of a surrogate pair as an escape like this.
  const text = String.raw`{"towerName":"Sky \ud83c","excavated":["\ud800","\udc00"],"k\udfe2":1,"units":[{"label":"\ud83c\udfe2"}],"n":1.5}`;

  it("repairs every string and key, keeps pairs and everything else", () => {
    const v = parseSaveJson(text) as Record<string, unknown>;
    expect(v.towerName).toBe("Sky \uFFFD");
    expect(v.excavated).toEqual(["\uFFFD", "\uFFFD"]);
    expect(v["k\uFFFD"]).toBe(1);
    expect(Object.keys(v).some((k) => k.startsWith("k") && k !== "k\uFFFD")).toBe(false);
    expect(v.units).toEqual([{ label: "\ud83c\udfe2" }]);
    expect(v.n).toBe(1.5);
    expect(parseSaveJson('{"a":"plain"}')).toEqual(JSON.parse('{"a":"plain"}'));
  });

  it("collapses two halves that repair to one excavated entry, as the Rust loader dedupes", () => {
    const save = { ...JSON.parse(JSON.stringify(new Simulation(1).serialize())), excavated: ["\ud800", "\udc00"] };
    const sim = Simulation.deserialize(parseSaveJson(JSON.stringify(save)) as typeof save);
    expect([...sim.excavated]).toEqual(["\uFFFD"]);
  });

  it("keeps a __proto__ key an own key when the object around it is rebuilt", () => {
    const v = parseSaveJson(String.raw`{"__proto__":{"units":[]},"k\ud800":1}`) as Record<string, unknown>;
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect(Object.keys(v)).toEqual(["__proto__", "k\uFFFD"]);
    expect("units" in v).toBe(false);
  });

  // Repair runs on the text, as in the Rust engine, so keys that repair to
  // one name are one key and the last one written wins, at every depth.
  it("reads keys that repair to one name as one key, the last one winning", () => {
    const F = "\uFFFD";
    const read = (body: string): unknown => parseSaveJson(`{${body},"o":{${body},"i":{${body}}}}`);
    const one = (v: unknown): unknown => ({ ["k" + F]: v, o: { ["k" + F]: v, i: { ["k" + F]: v } } });
    expect(read(String.raw`"k\ud800":1,"k\udc00":2`)).toEqual(one(2));
    expect(read(String.raw`"k\udc00":2,"k\ud800":1`)).toEqual(one(1));
    expect(read(String.raw`"k\ud800":1,"k\uFFFD":2,"k\ud800":3`)).toEqual(one(3));
  });

  it("keeps escaped pairs and escaped backslashes, and leaves bad escapes to JSON.parse", () => {
    expect(repairSurrogateEscapes(String.raw`["\ud83c\udfe2","\\ud800","\"\ud800"]`)).toBe(
      String.raw`["\ud83c\udfe2","\\ud800","\"\ufffd"]`,
    );
    expect(() => parseSaveJson(String.raw`["\ud80"]`)).toThrow(SyntaxError);
  });

  it("repairs a raw lone surrogate, as a legacy uncompressed slot can hold", () => {
    expect(parseSaveJson('{"towerName":"Sky ' + String.fromCharCode(0xd83c) + '"}')).toEqual({ towerName: "Sky \uFFFD" });
  });
});

/** Every web writer goes through encodeSaveJson, so none writes past the cap. */
describe("the save writers refuse a save past the cap", () => {
  const oversized = (): Simulation => {
    const sim = new Simulation(1);
    const real = sim.serialize.bind(sim);
    sim.serialize = () => ({ ...real(), towerName: "x".repeat(MAX_SAVE_INFLATED_BYTES) });
    return sim;
  };

  it("packSync and export throw SaveTooLargeError", async () => {
    expect(() => SaveGame.packSync(saveOf(oversized()))).toThrow(SaveTooLargeError);
    await expect(SaveGame.export(saveOf(oversized()))).rejects.toThrow(SaveTooLargeError);
  });
});

/** The engine's compressor (engine-rs/src/fflate.rs) is a port of exactly
 *  this fflate, so the two write the same bits; a different fflate would
 *  break that, and only the WASM suite would notice. Move both together. */
it("installs fflate 0.8.3, the version the engine's compressor ports", () => {
  const lock = JSON.parse(readFileSync(resolve(__dirname, "../../package-lock.json"), "utf8")) as {
    packages: Record<string, { version?: string }>;
  };
  expect(lock.packages["node_modules/fflate"]?.version).toBe("0.8.3");
});
