import { describe, expect, it } from "vitest";
import { VIEW_LAYOUT } from "../engine/port/layout";
import { newSeededGame } from "../tests/fixtures/towerFixtures";
import { Cards } from "./cards";
import { type MakeEngine, type Subject, kind, lobbyCenter, must, subject } from "./engineSubject.fixture";
import { PortCodes } from "./portCodes";
import { statsReport } from "./statsSheet";

/**
 * The panel queries of `EnginePort`, run on either engine (PR 5e part 4
 * moved them here from the retired `SimPort` panel contract): each answer
 * read through the decoder the panels use, consistent with the reader and
 * with the other answers. The golden test holds the two engines' records
 * equal slot for slot; this holds what the records mean.
 */
export function describeEngineQueries(name: string, make: MakeEngine): void {
  describe(`${name}: the engine port's panel queries`, () => {
    it("carries the founding mode and calendar on the header", () => {
      const s = subject(make, newSeededGame(7, "modern", "realWorld"));
      expect([s.reader.header.mode, s.reader.header.modernCalendar]).toEqual(["modern", "realWorld"]);
    });

    it("answers every panel query consistent with the reader and with each other", () => {
      const s = builtTower(make);
      const { reader, port } = s;
      const codes = new PortCodes(port);
      const report = statsReport(port.statsSheet(), codes);
      expect(report.stats.money).toBe(reader.header.money);
      expect(report.stats.star).toBe(reader.header.star);
      expect(report.stats.transports).toBe(reader.tower.transports.length);
      expect(report.milestones.list.length).toBe(report.milestones.total);
      expect(report.milestones.list.filter((m) => m.done).length).toBe(report.milestones.achieved);
      expect(new Set(report.milestones.list.map((m) => m.id)).size).toBe(report.milestones.total);
      // A one-star tower's next rung has a population bar and no facility gates.
      expect(report.nextStar).toMatchObject({ star: 2, isTower: false, gates: [] });
      expect(report.exterminationDueDay).toBeNull();

      const cards = new Cards(port, reader);
      for (const u of reader.rooms) {
        const card = cards.unit(u.id);
        expect(card, `unit ${u.id}`).toBeDefined();
        expect([card!.id, card!.kind, card!.floor, card!.x, card!.width, card!.state, card!.label]).toEqual([u.id, u.kind, u.floor, u.x, u.width, u.state, u.label]);
        expect(card!.blockbuster === null).toBe(u.kind !== "cinema");
      }
      for (const t of reader.tower.transports) {
        const card = cards.shaft(t.id);
        expect(card, `shaft ${t.id}`).toBeDefined();
        expect([card!.id, card!.kind, card!.x, card!.bottom, card!.top, card!.cars]).toEqual([t.id, t.kind, t.x, t.bottom, t.top, t.cars]);
        if (!t.kind.startsWith("elevator")) expect(card!.stops).toEqual([]);
        else {
          // An elevator lists every floor it spans, top first, with its ends marked.
          expect(card!.stops.map((r) => r.floor)).toEqual(Array.from({ length: t.top - t.bottom + 1 }, (_, i) => t.top - i));
          expect(card!.stops.filter((r) => r.endpoint).map((r) => r.floor)).toEqual([t.top, t.bottom]);
        }
      }
      expect(reader.tower.transports.map((t) => t.kind).sort()).toEqual(["elevatorStandard", "stairs"]);
      for (const id of [0, -1, 999_999]) expect([cards.unit(id), cards.shaft(id)]).toEqual([undefined, undefined]);

      const cell = VIEW_LAYOUT.records.heatCell.length;
      for (let mode = 0; mode < VIEW_LAYOUT.heatModes.length; mode++) {
        const cells = port.heatCells(mode);
        expect(cells.length % cell).toBe(0);
        for (let at = 0; at < cells.length; at += cell) {
          expect(cells[at + 1]).toBeLessThanOrEqual(cells[at + 2]);
          expect(Number.isFinite(cells[at + 3])).toBe(true);
        }
      }
      // The office paints the occupancy overlay, so an engine answering no
      // cells at all would fail here.
      const occupancy = port.heatCells(VIEW_LAYOUT.heatModes.indexOf("occupancy"));
      expect(Array.from({ length: occupancy.length / cell }, (_, i) => occupancy[i * cell]).includes(2)).toBe(true);
      const [ratio, floor] = port.hotspot();
      expect(Number.isFinite(ratio)).toBe(true);
      expect(Number.isNaN(floor) || Number.isInteger(floor)).toBe(true);
      // The onboarding steps a built, connected office tower has done.
      const flags = port.onboarding();
      for (const step of ["lobby", "floor", "office", "connect"]) {
        expect(Math.floor(flags / 2 ** VIEW_LAYOUT.onboarding.indexOf(step)) % 2, step).toBe(1);
      }
    });
  });
}

/** A founded tower with a second floor, an office on it, an elevator and a
 *  stair link from the lobby, ticked through a few game minutes, all built
 *  through the port. */
function builtTower(make: MakeEngine): Subject {
  const s = subject(make);
  const mid = lobbyCenter(s);
  must(s, (p) => p.buildAt(kind("office"), 2, mid - 4), "office");
  for (let x = mid + 5; x < mid + 16; x++) must(s, (p) => p.buildAt(kind("floor"), 2, x), `floor at ${x}`);
  must(s, (p) => p.buildShaft(kind("elevatorStandard"), mid + 8, 1, 2), "elevator");
  must(s, (p) => p.buildShaft(kind("stairs"), mid + 13, 1, 2), "stairs");
  for (let i = 0; i < 30; i++) s.port.tick(1);
  s.reader.update();
  return s;
}
