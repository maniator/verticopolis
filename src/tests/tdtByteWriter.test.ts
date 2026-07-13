import { describe, it, expect } from "vitest";
import { ByteWriter } from "../storage/tdtByteWriter";

/**
 * Unit net for the `.TDT` export byte writer (the deferred Stage-0 net for the
 * large-file split, landed with the tdtExport decomposition). The writer is the
 * mirror of tdtFormat's ByteReader; the whole export's byte-identical
 * idempotence rides on it emitting exactly the bytes the old ad-hoc closures
 * did, including the header back-patch.
 */

describe("ByteWriter", () => {
  it("writes u8 masked to a byte", () => {
    const w = new ByteWriter();
    w.u8(0x41);
    w.u8(0x1ff); // masked to 0xFF
    expect([...w.toBytes()]).toEqual([0x41, 0xff]);
    expect(w.length).toBe(2);
  });

  it("writes u16 little-endian", () => {
    const w = new ByteWriter();
    w.u16(0x2400);
    expect([...w.toBytes()]).toEqual([0x00, 0x24]);
  });

  it("writes i32 little-endian, including negatives (two's complement)", () => {
    const w = new ByteWriter();
    w.i32(1);
    w.i32(-1);
    w.i32(-2147483648); // INT32_MIN
    expect([...w.toBytes()]).toEqual([
      0x01, 0x00, 0x00, 0x00, // 1
      0xff, 0xff, 0xff, 0xff, // -1
      0x00, 0x00, 0x00, 0x80, // INT32_MIN
    ]);
  });

  it("pads with zeros and 0xFF", () => {
    const w = new ByteWriter();
    w.pad(3);
    w.padFF(2);
    expect([...w.toBytes()]).toEqual([0, 0, 0, 0xff, 0xff]);
  });

  it("length reflects bytes written and drives pad-to-offset", () => {
    const w = new ByteWriter();
    w.u16(0x2400);
    w.pad(8 - w.length); // pad the rest of an 8-byte block
    expect(w.length).toBe(8);
    expect([...w.toBytes()]).toEqual([0x00, 0x24, 0, 0, 0, 0, 0, 0]);
  });

  it("setU16 back-patches a u16 already written, little-endian", () => {
    const w = new ByteWriter();
    w.pad(8); // reserve a zero-filled header block
    w.setU16(2, 0x0102); // patch bytes 2-3
    w.setU16(6, 10); // patch bytes 6-7
    expect([...w.toBytes()]).toEqual([0, 0, 0x02, 0x01, 0, 0, 0x0a, 0x00]);
  });

  it("setU16 masks its value to 16 bits", () => {
    const w = new ByteWriter();
    w.pad(2);
    w.setU16(0, 0x1_2345); // only the low 16 bits land
    expect([...w.toBytes()]).toEqual([0x45, 0x23]);
  });
});
