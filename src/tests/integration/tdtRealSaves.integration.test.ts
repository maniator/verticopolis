/**
 * Nine real SimTower saves from 1997, contributed by Reddit user u/invokes with
 * their consent (r/SimTower thread, 2026-10-29). They are the first real saves
 * of that vintage the importer has met; see
 * `conformance/fixtures/tdt-reddit/README.md` and issue #1491. The Rust importer
 * reads the same files in `engine-rs/tests/tdt_real_saves.rs` and must agree.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { describeWithCodec, parseTDT } from "../conformance/tdtWasm";

const DIR = resolve(__dirname, "../../../conformance/fixtures/tdt-reddit");
const load = (name: string) => {
  const bytes = readFileSync(resolve(DIR, name));
  return parseTDT(bytes, name);
};

/** Shafts and walkway flights each save carries. Every file reads straight
 *  through its elevator table, express shafts included (#1491, #1497). */
const SAVES = [
  { name: "TOWER1.TDT", shafts: 15, flights: 1 },
  { name: "TOWER2.TDT", shafts: 24, flights: 31 },
  { name: "TOWER3.TDT", shafts: 11, flights: 29 },
  { name: "TOWER4.TDT", shafts: 18, flights: 29 },
  { name: "TOWER5.TDT", shafts: 7, flights: 7 },
  { name: "TOWER6.TDT", shafts: 23, flights: 64 },
  { name: "TOWER7.TDT", shafts: 24, flights: 64 },
  { name: "TOWER8.TDT", shafts: 0, flights: 0 },
  { name: "MYTOWER.TDT", shafts: 24, flights: 37 },
] as const;

describeWithCodec("real 1997 saves (u/invokes)", () => {
  for (const { name, shafts, flights } of SAVES) {
    it(`${name} brings over its own elevators and stairways`, () => {
      const { save, report } = load(name);
      const walkways = save.transports.filter((t) => t.kind === "stairs" || t.kind === "escalator").length;
      expect(save.transports.length - walkways).toBe(shafts);
      expect(walkways).toBe(flights);
      const said = [...report.broughtOver, ...report.couldNotBring].join(" ");
      expect(said).not.toMatch(/rebuilt from your floors/);
      expect(said).not.toMatch(/stairways couldn't be read/);
      expect(report.couldNotBring.some((l) => l.includes("found by searching the file"))).toBe(false);
    });
  }
});
