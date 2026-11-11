import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { floorsOfPort, newViewReader } from "../../game/portAccess";
import type { FacilityKind } from "../../shared/types";
import { decodeVctower } from "../../storage/vctowerContainer";
import { clockOf } from "../../simport/headerClock";
import type { EnginePort } from "../../simport/enginePort";
import { engineFromSave, look, noEngine } from "../portKit/rustEngine";

/**
 * The shared reader and the header's clock on the conformance saves, on the
 * Rust engine. The port's unit tests (`src/simport/`) run on mock ports; the
 * small towers they used to check on the engine run in
 * `portReads.integration.test.ts` and `portReader.integration.test.ts`.
 */

/** Each conformance save's clock, as the header reads it. */
const SAVES: [string, string, string][] = [
  ["sixseven-december.vctower", "WE1 21:57", "1st WE/4Q/88th Year"],
  ["sixseven_2.vctower", "WD2 21:57", "2nd WD/3Q/74th Year"],
  ["split-tower-4.vctower", "Tue 23:20", "2nd WD/4Q/4th Year"],
  ["split-tower.vctower", "Thu 04:38", "4th WD/3Q/1st Year"],
  ["towerone-star1.vctower", "WE1 08:05", "1st WE/2Q/108th Year"],
  ["towerone-star4.vctower", "WE1 08:05", "1st WE/2Q/108th Year"],
  ["towerone-vip-pending.vctower", "WE1 08:05", "1st WE/2Q/108th Year"],
  ["towerone_6.vctower", "WE1 08:05", "1st WE/2Q/108th Year"],
];

const STRUCTURE = new Set(["floor", "lobby"]);
const roomsOf = (e: EnginePort) => look(e).tower.units.filter((u) => !STRUCTURE.has(u.kind as string));

describe.skipIf(noEngine)("the port's reads on the conformance saves", () => {
  it("reads a loaded save's clock, on every conformance save", () => {
    const dir = resolve(__dirname, "../../../conformance/fixtures");
    const saves = readdirSync(dir).filter((f) => f.endsWith(".vctower"));
    expect(saves.sort()).toEqual(SAVES.map(([f]) => f).sort());
    for (const [f, format, retro] of SAVES) {
      const save = JSON.stringify(decodeVctower(readFileSync(resolve(dir, f), "utf8"), f));
      const c = clockOf(newViewReader(engineFromSave(save)).header);
      expect([c.format(), c.formatRetroDate()], f).toEqual([format, retro]);
    }
  });

  it("answers every story of a taller room as the tower's own index does", () => {
    // split-tower-4 holds cinemas and party halls (2 floors) and a metro (3).
    const e = engineFromSave(JSON.stringify(decodeVctower(readFileSync(resolve(__dirname, "../../../conformance/fixtures/split-tower-4.vctower"), "utf8"))));
    const r = newViewReader(e);
    const floorsOf = floorsOfPort(e);
    const own = look(e).tower;
    let tall = 0;
    for (const u of roomsOf(e) as unknown as { kind: string; floor: number; x: number; width: number }[]) {
      const floors = floorsOf(u.kind as FacilityKind);
      if (floors < 2) continue;
      tall++;
      for (let floor = u.floor - 1; floor <= u.floor + floors; floor++) {
        for (const x of [u.x - 1, u.x, u.x + u.width - 1, u.x + u.width]) {
          const want = own.roomAt(floor, x);
          const got = r.tower.unitAt(floor, x);
          expect(want ? got?.id : Number.isNaN(got?.id ?? NaN), `${u.kind} ${floor} ${x}`).toBe(want ? want.id : true);
        }
      }
    }
    expect(tall).toBeGreaterThan(5);
  });
});
