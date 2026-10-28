import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { towerStateSig } from "../engine/UndoHistory";
import type { SerializedGame } from "../engine/types";
import { MID, newSeededGame } from "../tests/fixtures/towerFixtures";
import type { EnginePort, PortRecord } from "./enginePort";
import {
  type MakeEngine,
  type Subject,
  calendar,
  delta,
  done,
  drain,
  filmPolicy,
  kind,
  lobbyCenter,
  mode,
  must,
  mustFind,
  run,
  saved,
  slot,
  subject,
} from "./engineSubject.fixture";
import { scheduleSlots } from "./scheduleSlots";

/**
 * The lifecycle half of the `EnginePort` contract, and the commands that need
 * a tower the port cannot found, run on either engine (PR 5e part 4 moved
 * these from the retired `SimPort` contracts and `TsSim`'s own tests).
 *
 * The undo signature is held to a reference that changes exactly when the
 * undo history's `towerStateSig` of the same tower would: the TypeScript
 * signature of the engine's own save, read back. So on the Rust engine the
 * reference is independent of the signature under test.
 */
export function describeEngineLifecycle(name: string, make: MakeEngine): void {
  describe(`${name}: the engine port's lifecycle`, () => {
    it("restores an earlier save of its own as an undo step: the same signature, the live bridging setting, a new generation", () => {
      const s = subject(make);
      const mid = lobbyCenter(s);
      const generation = s.port.generation();
      must(s, (p) => p.buildAt(kind("office"), 2, mid - 4), "office on 2");
      const text = s.port.serialize();
      const [signature, ref] = [s.port.undoSignature(), reference(s.port)];
      must(s, (p) => p.buildAt(kind("office"), 3, mid - 4), "office on 3");
      must(s, (p) => p.chooseAutoBridge(false), "bridging off");
      expect(s.port.undoSignature()).not.toBe(signature);
      expect(s.port.generation(), "commands keep the generation").toBe(generation);
      s.port.tick(1);
      expect(s.port.generation(), "a tick keeps the generation").toBe(generation);

      expect(done(s.port.restore(text))).toBe(true);
      s.reader.update();
      expect(s.port.generation()).not.toBe(generation);
      expect([s.port.undoSignature(), reference(s.port)]).toEqual([signature, ref]);
      expect(s.reader.tower.units.filter((u) => u.kind === "office")).toHaveLength(1);
      expect(saved(s).autoBridge, "the live bridging setting").toBe(false);
      must(s, (p) => p.buildAt(kind("office"), 3, mid - 4), "office on 3 again");
      expect(mustFind(s.reader.tower.units, (u) => u.kind === "office" && u.floor === 3).floor).toBe(3);
    });

    it("loads a stored save with the founder rule, and a restore never applies it", () => {
      const s = subject(make);
      const save = JSON.parse(s.port.serialize()) as SerializedGame;
      delete save.appVersion;
      const generation = s.port.generation();
      const loaded = s.port.loadSave(JSON.stringify(save));
      expect(done(loaded)).toBe(true);
      expect(slot("loadSave", loaded, "generation")).toBe(s.port.generation());
      expect(s.port.generation()).not.toBe(generation);
      expect(saved(s).founder, "a save with no appVersion stamp predates 2.0").toBe(true);
      expect(done(s.port.loadSave(JSON.stringify({ ...save, appVersion: "2.46.0" })))).toBe(true);
      expect(saved(s).founder).toBeUndefined();
      expect(done(s.port.restore(JSON.stringify(save)))).toBe(true);
      expect(saved(s).founder).toBeUndefined();
    });

    it("refuses a save it cannot read, and keeps the tower and its generation", () => {
      const s = subject(make);
      const [save, generation] = [s.port.serialize(), s.port.generation()];
      for (const load of [(p: EnginePort) => p.loadSave("not a save"), (p: EnginePort) => p.restore("not a save"), (p: EnginePort) => p.loadSave("null")]) {
        expect(done(load(s.port))).toBe(false);
        expect(typeof s.port.lastReason()).toBe("string");
        expect([s.port.serialize(), s.port.generation()]).toEqual([save, generation]);
      }
    });

    it("founds a new tower on an empty lot under the chosen rules", () => {
      const s = subject(make);
      expect(done(s.port.foundTower(11, mode("classic"), calendar("realWorld"), false))).toBe(true);
      s.reader.update();
      expect(saved(s)).toMatchObject({ mode: "classic" });
      expect(s.reader.tower.units).toEqual([]);
      expect(done(s.port.foundTower(12, mode("modern"), calendar("canon"), true))).toBe(true);
      expect(saved(s)).toMatchObject({ mode: "modern", modernCalendar: "canon", autoBridge: false });
    });

    it("moves the undo signature on exactly the steps that change what a player can undo", () => {
      const s = subject(make);
      const mid = lobbyCenter(s);
      const ids = { office: -1, shaft: -1, food: -1 };
      const unit = (k: string) => mustFind(s.reader.tower.units, (u) => u.kind === k && u.floor >= 2).id;
      const steps: Step[] = [
        { name: "an office", run: (p) => p.buildAt(kind("office"), 2, mid - 4), moves: true, after: () => (ids.office = unit("office")) },
        ...[2, 3].flatMap((floor) =>
          Array.from({ length: 11 }, (_, i): Step => ({ name: `a floor tile on ${floor} at ${mid + 5 + i}`, run: (p) => p.buildAt(kind("floor"), floor, mid + 5 + i), moves: true })),
        ),
        { name: "a floor brush", run: (p) => p.paintTiles(kind("floor"), 2, Float64Array.of(mid + 16, mid + 17)), moves: true },
        { name: "a shaft", run: (p) => p.buildShaft(kind("elevatorStandard"), mid + 8, 1, 2), moves: true, after: () => (ids.shaft = s.reader.tower.transports[0].id) },
        { name: "a car", run: (p) => p.changeCars(ids.shaft, true), moves: true },
        { name: "a car off", run: (p) => p.changeCars(ids.shaft, false), moves: true },
        { name: "a drag opened", run: (p) => p.startExtend(ids.shaft), moves: false },
        { name: "the shaft extended", run: (p) => p.extendShaft(ids.shaft, true, 3), moves: true },
        { name: "the drag closed", run: (p) => p.stopExtend(), moves: false },
        { name: "a skipped stop", run: (p) => p.markStop(ids.shaft, 2, false), moves: true },
        { name: "the stops cleared", run: (p) => p.dropStops(ids.shaft), moves: true },
        { name: "express stops", run: (p) => p.expressStops(ids.shaft), moves: true },
        { name: "a schedule", run: (p) => p.scheduleShaft(ids.shaft, scheduleSlots({ waitingCarResponse: 7 })), moves: true },
        { name: "a label", run: (p) => p.labelUnit(ids.office, "Contract Office"), moves: true },
        { name: "a rent step", run: (p) => p.stepRent(ids.office, 1), moves: true },
        { name: "a price", run: (p) => p.setRent(ids.office, 0), moves: true },
        { name: "a rent batch", run: (p) => p.rentBatch(kind("office"), NaN, false), moves: true },
        { name: "No Rate, which Modern rules refuse", run: (p) => p.noRate(ids.office), moves: false, refused: true },
        { name: "a fast food", run: (p) => p.buildAt(kind("fastFood"), 3, mid - 4), moves: true, after: () => (ids.food = unit("fastFood")) },
        { name: "a variety reroll", run: (p) => p.rerollUnit(ids.food), moves: true },
        { name: "a film policy on a room that has none", run: (p) => p.setFilm(ids.food, filmPolicy("feature")), moves: false, refused: true },
        { name: "the exterminator, with nothing to treat", run: (p) => p.bookExterminator(), moves: false, refused: true },
        { name: "an answer with no emergency", run: (p) => p.answerChoice(true), moves: false, refused: true },
        { name: "bridging flipped", run: (p) => p.flipAutoBridge(), moves: false },
        { name: "bridging set", run: (p) => p.chooseAutoBridge(true), moves: false },
        { name: "a tower name", run: (p) => p.nameTower("Lifecycle"), moves: false },
        { name: "a camera", run: (p) => p.setCamera(100, 2, NaN), moves: false },
        { name: "a bulletin", run: (p) => p.logLine("A bulletin.", 0), moves: false },
        { name: "a tick", run: "tick", moves: "either" },
        { name: "the office sold", run: (p) => p.demolish(ids.office, false), moves: true },
      ];
      for (const step of steps) {
        const before = [s.port.undoSignature(), reference(s.port)];
        if (step.run === "tick") s.port.tick(1);
        else {
          const call = step.run;
          expect(done(run(s, call, step.name)), `${step.name}: applied`).toBe(!step.refused);
          step.after?.();
        }
        const moved = s.port.undoSignature() !== before[0];
        expect(moved, `${step.name}: the signature moved as the reference did`).toBe(reference(s.port) !== before[1]);
        if (step.moves !== "either") expect(moved, step.name).toBe(step.moves);
      }
    });

    it("moves the undo signature on a cinema's film policy and on No Rate, which a grown Classic tower takes", () => {
      const sim = newSeededGame(7, "classic");
      Object.assign(sim, { star: 3, money: 1e9 });
      const s = subject(make, sim);
      const mid = lobbyCenter(s);
      const step = (label: string, call: (p: EnginePort) => PortRecord, moves: boolean, free = false) => {
        const before = [s.port.undoSignature(), reference(s.port)];
        const rec = must(s, call, label);
        // Money is in the signature, so a step that costs nothing shows the
        // move came from the field itself.
        if (free) expect(delta(rec), `${label}: costs nothing`).toBe(0);
        const moved = s.port.undoSignature() !== before[0];
        expect(moved, `${label}: the signature moved as the reference did`).toBe(reference(s.port) !== before[1]);
        expect(moved, label).toBe(moves);
      };
      step("a cinema", (p) => p.buildAt(kind("cinema"), 2, mid - 15), true);
      const cinema = mustFind(s.reader.tower.units, (u) => u.kind === "cinema").id;
      step("a film policy", (p) => p.setFilm(cinema, filmPolicy("feature")), true, true);
      step("the same film policy", (p) => p.setFilm(cinema, filmPolicy("feature")), false, true);
      step("an office", (p) => p.buildAt(kind("office"), 4, mid - 4), true);
      const office = mustFind(s.reader.tower.units, (u) => u.kind === "office").id;
      step("No Rate", (p) => p.noRate(office), true, true);
      step("No Rate again", (p) => p.noRate(office), false, true);
    });
  });

  describe(`${name}: the commands that need a grown tower`, () => {
    it("keeps a Classic tower bridging, refusing a change", () => {
      const s = subject(make, newSeededGame(7, "classic"));
      silent(s, () => {
        const flip = run(s, (p) => p.flipAutoBridge(), "flip");
        expect([done(flip), slot("flipAutoBridge", flip, "value")]).toEqual([false, 1]);
        const off = run(s, (p) => p.chooseAutoBridge(false), "off");
        expect([done(off), slot("chooseAutoBridge", off, "value")]).toEqual([false, 1]);
      });
      expect(slot("chooseAutoBridge", must(s, (p) => p.chooseAutoBridge(true), "on"), "value")).toBe(1);
      expect(s.port.autoBridge()).toBe(true);
    });

    it("sets a cinema's film policy, and refuses it on an office", () => {
      const sim = newSeededGame(7, "modern");
      Object.assign(sim, { star: 3, money: 10_000_000 });
      const s = subject(make, sim);
      must(s, (p) => p.buildAt(kind("cinema"), 2, MID - 20), "cinema");
      must(s, (p) => p.buildAt(kind("office"), 2, MID + 11), "office");
      const cinema = mustFind(s.reader.tower.units, (u) => u.kind === "cinema").id;
      const office = mustFind(s.reader.tower.units, (u) => u.kind === "office").id;
      const set = must(s, (p) => p.setFilm(cinema, filmPolicy("blockbuster")), "a blockbuster");
      expect([delta(set), slot("setFilm", set, "policyCode")]).toEqual([0, filmPolicy("blockbuster")]);
      expect(mustFind(Simulation.deserialize(JSON.parse(s.port.serialize()) as SerializedGame).tower.units, (u) => u.id === cinema).filmPolicy).toBe("blockbuster");
      expect(done(run(s, (p) => p.setFilm(office, filmPolicy("auto")), "a film for an office"))).toBe(false);
    });

    it("answers a stop the engine keeps (an endpoint, an express non-lobby floor) and changes nothing", () => {
      const sim = newSeededGame(7, "modern");
      Object.assign(sim, { star: 3, money: 10_000_000 });
      const s = subject(make, sim);
      const tiles = Float64Array.of(MID + 14, MID + 15, MID + 16, MID + 17);
      for (const floor of [2, 3]) expect(slot("paintTiles", must(s, (p) => p.paintTiles(kind("floor"), floor, tiles), `floor ${floor}`), "placed")).toBe(4);
      must(s, (p) => p.buildShaft(kind("elevatorExpress"), MID + 14, 1, 3), "an express");
      const shaft = mustFind(s.reader.tower.transports, (t) => t.kind === "elevatorExpress").id;
      const save = s.port.serialize();
      silent(s, () => {
        // Skipping an endpoint is a no-op the engine answers as done.
        expect(delta(must(s, (p) => p.markStop(shaft, 1, false), "skip an endpoint"))).toBe(0);
        expect(s.port.serialize()).toBe(save);
        // An express stops only at lobbies: serving floor 2 is refused.
        expect(done(run(s, (p) => p.markStop(shaft, 2, true), "serve floor 2"))).toBe(false);
        expect(s.port.serialize()).toBe(save);
      });
    });

    it("answers a waiting emergency with what it paid, and a decline pays nothing", () => {
      for (const accept of [true, false]) {
        const sim = newSeededGame(7, "modern");
        sim.events.pending = { kind: "fireRescue", cost: 40_000, message: "fire" };
        const s = subject(make, sim);
        expect(s.port.pendingChoice()).toBeDefined();
        expect(delta(must(s, (p) => p.answerChoice(accept), `answer ${accept}`))).toBe(accept ? -40_000 : 0);
        expect(s.port.pendingChoice()).toBeUndefined();
        silent(s, () => expect(done(run(s, (p) => p.answerChoice(accept), "a second answer"))).toBe(false));
      }
    });

    it("books the exterminator for an infested room, with its price and the charge", () => {
      const sim = newSeededGame(7, "modern");
      for (let x = MID - 6; x < MID + 6; x++) sim.tower.place("floor", 2, x);
      expect(sim.tower.place("hotelSingle", 2, MID - 4).ok).toBe(true);
      mustFind(sim.tower.units, (u) => u.kind === "hotelSingle").state = "infested";
      Object.assign(sim, { money: 1e8 });
      const s = subject(make, sim);
      const booked = must(s, (p) => p.bookExterminator(), "the exterminator");
      expect(slot("bookExterminator", booked, "rooms")).toBe(1);
      const cost = slot("bookExterminator", booked, "cost");
      expect(cost).toBeGreaterThan(0);
      expect(delta(booked)).toBe(-cost);
    });

    it("takes a Classic office off the market", () => {
      const s = subject(make, newSeededGame(7, "classic"));
      must(s, (p) => p.buildAt(kind("office"), 2, MID - 4), "office");
      const office = mustFind(s.reader.tower.units, (u) => u.kind === "office").id;
      expect(delta(must(s, (p) => p.noRate(office), "No Rate"))).toBe(0);
      expect(mustFind(Simulation.deserialize(JSON.parse(s.port.serialize()) as SerializedGame).tower.units, (u) => u.id === office).noRate).toBe(true);
    });
  });
}

interface Step {
  name: string;
  run: "tick" | ((port: EnginePort) => PortRecord);
  /** Whether the step changes what a player can undo, or either (a tick may
   *  move the money). */
  moves: boolean | "either";
  /** The command is refused on this tower. */
  refused?: true;
  after?: () => void;
}

/** The undo history's signature of the engine's own save, read back. */
function reference(port: EnginePort): string {
  const sim = Simulation.deserialize(JSON.parse(port.serialize()) as SerializedGame);
  return towerStateSig(sim.tower, sim.money);
}

/** Run `body` and check it raised no gameplay event and wrote no log line. */
function silent(s: Subject, body: () => void): void {
  drain(s.port);
  s.reader.update();
  const { logSeq } = s.reader.header;
  body();
  s.reader.update();
  expect(drain(s.port), "a refusal raised a gameplay event").toEqual([]);
  expect(s.reader.header.logSeq, "a refusal wrote a log line").toBe(logSeq);
}
