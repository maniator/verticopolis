import { vi } from "vitest";
import type { CrashTower } from "./crashReport";

/** What a crash tower stand-in shows: the header and tower fields the crash
 *  report reads, and the counts of its units and shafts. */
export interface CrashTowerFacts {
  towerName: string;
  money: number;
  star: number;
  population: number;
  minutes: number;
  units: number;
  transports: number;
}

/**
 * A hand-built tower for the crash report and crash screen: the reader's
 * header and tower, as the report reads them, and a port whose `serialize`
 * spy answers a save carrying the same name and money.
 */
export function crashTower(over: Partial<CrashTowerFacts> = {}): CrashTower & { port: { serialize: ReturnType<typeof vi.fn> } } {
  const f: CrashTowerFacts = { towerName: "Tower One", money: 2_000_000, star: 1, population: 0, minutes: 420, units: 0, transports: 0, ...over };
  const save = { version: 7, minutes: f.minutes, money: f.money, star: f.star, towerName: f.towerName, units: [], transports: [] };
  return {
    view: {
      header: { money: f.money, star: f.star, population: f.population, minutes: f.minutes },
      tower: { towerName: f.towerName, units: Array.from({ length: f.units }), transports: Array.from({ length: f.transports }) },
    } as unknown as CrashTower["view"],
    port: { serialize: vi.fn(() => JSON.stringify(save)) },
  };
}
