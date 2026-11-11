import { describe, expect, it } from "vitest";
import { hudSource } from "./hudSource";

/** The HUD's source reads the app's engine, reader and codes on every access,
 *  so a swapped engine is never held stale, and there is one source per app. */
describe("hudSource", () => {
  it("reads through to the app each time, one source per app", () => {
    const app = {
      enginePort: "port A",
      reader: "reader A",
      portCodes: "codes A",
    } as never as Parameters<typeof hudSource>[0];
    const s = hudSource(app);
    expect([s.port, s.reader, s.codes]).toEqual([
      "port A",
      "reader A",
      "codes A",
    ]);
    Object.assign(app, {
      enginePort: "port B",
      reader: "reader B",
      portCodes: "codes B",
    });
    expect([s.port, s.reader, s.codes], "a swap is read, not held").toEqual([
      "port B",
      "reader B",
      "codes B",
    ]);
    expect(hudSource(app)).toBe(s);
    expect(hudSource({ ...app })).not.toBe(s);
  });
});
