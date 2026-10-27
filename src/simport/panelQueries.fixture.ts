import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SimPort } from "./port";
import type { Query, QueryResult } from "./queries";

/**
 * The panel queries' contract (facade slice 4, #1211), run over any adapter:
 * `TsSim` now, `RustSim` from slice 7. `makePort` returns a port on a freshly
 * founded Modern tower on the real-world calendar, standing on its starter
 * lobby (as `describePortContract` takes it). The suite builds through the
 * port alone and asserts what every adapter must answer: plain JSON in the
 * documented shapes, consistent with the view and with each other, null for
 * an id that names nothing, and `cached` holding the last answer. How many
 * answers an adapter keeps is its own (`TsSim`'s bounds are pinned in
 * `panelQueries.test.ts`). What the numbers must equal is the getters'
 * differential's to say: 6b's held wrapper commit brings it, comparing the
 * Rust answers with `tsPanels.ts` on the conformance corpus.
 *
 * Each case ticks once before its first command and once after its last, for
 * the `unitWasm` parity project's host (see `describePortContract`).
 */
export function describePanelQueries(name: string, makePort: () => SimPort, opts: { restarts?: () => number | undefined } = {}): void {
  describe(`${name}: the panel queries`, () => {
    let restartsBefore: number | undefined;
    beforeEach(() => {
      restartsBefore = opts.restarts?.();
    });
    afterEach(() => {
      expect(opts.restarts?.(), "the engines disagreed on a command, and the parity setup restarted the engine").toBe(restartsBefore);
    });

    it("carries the founding mode and calendar on the header", () => {
      const port = start(makePort);
      expect([port.view.header.mode, port.view.header.modernCalendar]).toEqual(["modern", "realWorld"]);
      port.tick(1);
    });

    it("answers every panel query as plain JSON, consistent with the view and with each other", async () => {
      const port = await builtTower(makePort);
      const { view } = port;

      const stats = await ask(port, { op: "towerStats" });
      const report = await ask(port, { op: "statsReport" });
      expect(report.stats).toEqual(stats);
      expect(stats.money).toBe(view.header.money);
      expect(stats.star).toBe(view.header.star);
      expect(stats.transports).toBe(view.tower.transports.length);
      expect(report.housekeeping).toEqual(await ask(port, { op: "housekeepingCoverage" }));
      expect(report.milestones.list.length).toBe(report.milestones.total);
      expect(report.milestones.list.filter((m) => m.done).length).toBe(report.milestones.achieved);
      expect(new Set(report.milestones.list.map((m) => m.id)).size).toBe(report.milestones.total);
      // A one-star tower's next rung has a population bar and no facility
      // gates; the gate ids themselves are pinned on each adapter's own tests.
      expect(report.nextStar).toMatchObject({ star: 2, isTower: false, gates: [] });
      expect(report.exterminationDueDay).toBeNull();

      // The rooms: `units` may list the floor and lobby tiles too, until the
      // room list of #1253, and no panel opens a card on those.
      for (const u of view.tower.units.filter((q) => q.kind !== "floor" && q.kind !== "lobby")) {
        const card = await ask(port, { op: "unitDetail", id: u.id });
        expect(card, `unit ${u.id}`).not.toBeNull();
        expect([card!.id, card!.kind, card!.floor, card!.x, card!.width, card!.state, card!.label]).toEqual([u.id, u.kind, u.floor, u.x, u.width, u.state, u.label]);
        expect(card!.blockbuster === null).toBe(u.kind !== "cinema");
      }
      for (const t of view.tower.transports) {
        const card = await ask(port, { op: "transportDetail", id: t.id });
        expect(card, `shaft ${t.id}`).not.toBeNull();
        expect([card!.id, card!.kind, card!.x, card!.bottom, card!.top, card!.cars]).toEqual([t.id, t.kind, t.x, t.bottom, t.top, t.cars]);
        if (!t.kind.startsWith("elevator")) {
          expect(card!.stops).toEqual([]);
        } else {
          // An elevator lists every floor it spans, top first, with its ends marked.
          expect(card!.stops.map((s) => s.floor)).toEqual(Array.from({ length: t.top - t.bottom + 1 }, (_, i) => t.top - i));
          expect(card!.stops.filter((s) => s.endpoint).map((s) => s.floor)).toEqual([t.top, t.bottom]);
        }
      }
      expect(view.tower.transports.map((t) => t.kind).sort()).toEqual(["elevatorStandard", "stairs"]);
      for (const id of [0, -1, 999_999]) {
        expect(await ask(port, { op: "unitDetail", id })).toBeNull();
        expect(await ask(port, { op: "transportDetail", id })).toBeNull();
      }

      for (const mode of ["congestion", "occupancy", "satisfaction", "cleanliness"] as const) {
        for (const cell of await ask(port, { op: "floorHeatmap", mode })) {
          expect(cell.minX).toBeLessThanOrEqual(cell.maxX);
          expect(Number.isFinite(cell.severity)).toBe(true);
        }
      }
      // The office paints the occupancy overlay, so an adapter answering no
      // cells at all would fail here.
      expect((await ask(port, { op: "floorHeatmap", mode: "occupancy" })).some((c) => c.floor === 2)).toBe(true);
      const hotspot = await ask(port, { op: "peakCongestionHotspot" });
      expect(Number.isFinite(hotspot.ratio)).toBe(true);
      expect(hotspot.floor === null || Number.isInteger(hotspot.floor)).toBe(true);

      const facts = await ask(port, { op: "onboardingFacts" });
      expect(facts).toMatchObject({ lobby: true, floor: true, office: true, connect: true });
      port.tick(1);
    });

    it("keeps the last answer for cached", async () => {
      const port = await builtTower(makePort);
      const office = port.view.tower.units.find((u) => u.kind === "office")!;
      const card = { op: "unitDetail", id: office.id } as const;
      expect(port.cached(card)).toBeUndefined();
      const answer = await port.query(card);
      expect(port.cached(card)).toEqual(answer);
      const report = await port.query({ op: "statsReport" });
      expect(port.cached({ op: "statsReport" })).toEqual(report);
      port.tick(1);
    });
  });
}

/** Ask, and check the answer is plain JSON: what a parsed engine answer
 *  would be, with no undefined, Map or class instance in it (a strict equal
 *  tells an undefined field and a prototype apart). */
async function ask<Q extends Query>(port: SimPort, q: Q): Promise<QueryResult<Q>> {
  const answer = await port.query(q);
  expect(JSON.parse(JSON.stringify(answer)), JSON.stringify(q)).toStrictEqual(answer);
  return answer;
}

function start(makePort: () => SimPort): SimPort {
  const port = makePort();
  port.tick(1);
  return port;
}

/** A founded tower with a second floor, an office on it, an elevator and a
 *  stair link from the lobby, ticked through a few game minutes, all built
 *  through the port. */
async function builtTower(makePort: () => SimPort): Promise<SimPort> {
  const port = start(makePort);
  // The starter lobby, read through `structureKindAt` as the port contract's
  // own helper reads it, so the suite does not depend on `units` listing
  // structure tiles.
  const lobby: number[] = [];
  for (let x = 0; x < LOT_WIDTH; x++) if (port.view.tower.structureKindAt(1, x) === "lobby") lobby.push(x);
  expect(lobby.length, "the founded tower's starter lobby").toBeGreaterThan(0);
  const left = lobby[0];
  const right = lobby[lobby.length - 1] + 1;
  const mid = Math.floor((left + right) / 2);
  expect([left <= mid - 4, right >= mid + 16, right - left === lobby.length], `the starter lobby spans ${left} to ${right} in one run`).toEqual([true, true, true]);
  expect(await port.command({ op: "build", kind: "office", floor: 2, x: mid - 4 })).toMatchObject({ ok: true });
  for (let x = mid + 5; x < mid + 16; x++) expect(await port.command({ op: "build", kind: "floor", floor: 2, x }), `floor at ${x}`).toMatchObject({ ok: true });
  expect(await port.command({ op: "buildTransport", kind: "elevatorStandard", x: mid + 8, bottom: 1, top: 2 })).toMatchObject({ ok: true });
  expect(await port.command({ op: "buildTransport", kind: "stairs", x: mid + 13, bottom: 1, top: 2 })).toMatchObject({ ok: true });
  for (let i = 0; i < 30; i++) port.tick(1);
  return port;
}

/** The lot's width in tiles (`GRID.width`, the 1994 map's 375 segments). */
const LOT_WIDTH = 375;
