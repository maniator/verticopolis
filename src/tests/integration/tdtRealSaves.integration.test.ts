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
import { deserializeSave, readVctower, writeVctower } from "../../engine/port/files";

const DIR = resolve(__dirname, "../../../conformance/fixtures/tdt-reddit");
const load = (name: string) => {
  const bytes = readFileSync(resolve(DIR, name));
  return parseTDT(bytes, name);
};

/** Shafts and walkway flights each save carries. Every file reads straight
 *  through its elevator table, express shafts included (#1491, #1497). */
const SAVES = [
  { name: "TOWER1.TDT", shafts: 15, flights: 1 },
  { name: "TOWER2.TDT", shafts: 24, flights: 30 },
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

describeWithCodec("real 1997 saves keep their shop, restaurant and fast-food styles through a .vctower", () => {
  const STYLED = new Set(["shop", "restaurant", "fastFood"]);
  const styles = (units: { kind: string; floor: number; x: number; subtype?: string }[]) =>
    units
      .filter((u) => STYLED.has(u.kind))
      .map((u) => `${u.kind}@${u.floor},${u.x}=${u.subtype}`)
      .sort();

  for (const { name } of SAVES) {
    it(`${name}: import .TDT, save .vctower, reload`, () => {
      const imported = load(name).save;
      const before = styles(imported.units);
      const sim = deserializeSave(imported);
      const reloaded = readVctower(writeVctower(sim, "3.0.0", 0)).serialize();
      expect(styles(reloaded.units)).toEqual(before);
      // Every styled room has a style, so the comparison above is not empty names.
      expect(before.every((line) => !line.endsWith("=undefined"))).toBe(true);
    });
  }
});
