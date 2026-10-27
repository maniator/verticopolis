import { describe, expectTypeOf, it } from "vitest";
import type { Crowd } from "../engine/Crowd";
import type { Person } from "../engine/crowd/person";
import type { Simulation } from "../engine/Simulation";
import type { Tower } from "../engine/Tower";
import type { roomUnits, StructureRun, structureRuns } from "../engine/tower/rooms";
import type { Transport, Unit } from "../engine/types";
import type { ShadowCommand } from "../dualrun/commands";
import type { Command, CommandResults } from "./commands";
import type { Query, QueryResults } from "./queries";
import type { CrowdView, HeaderView, PersonView, SimView, StructureRunView, TowerView, TransportView, UnitView } from "./view";

/** The relay's ops that are not player commands: the shadow's own plumbing,
 *  edits no production code makes, and test and tooling hooks. A new
 *  `ShadowCommand` op fails the drift check below until it is listed here
 *  or given a `Command` member. */
type NotPlayerCommand =
  | "load"
  | "tick"
  | "checkpoint"
  | "sellAt"
  | "removeUnit"
  | "removeTransport"
  | "resizeTransport"
  | "setCars"
  | "towerResizeTransport"
  | "towerSetCars"
  | "setMoney"
  | "startFire"
  | "bombThreat"
  | "evaluateStar";

describe("the port's types", () => {
  it("the live TypeScript objects are views, so the adapter copies nothing", () => {
    expectTypeOf<Tower>().toExtend<TowerView>();
    expectTypeOf<Unit>().toExtend<UnitView>();
    expectTypeOf<Transport>().toExtend<TransportView>();
    expectTypeOf<Crowd>().toExtend<CrowdView>();
    expectTypeOf<Person>().toExtend<PersonView>();
    expectTypeOf<Simulation["pendingChoice"]>().toExtend<HeaderView["pendingChoice"]>();
    expectTypeOf<StructureRun>().toEqualTypeOf<StructureRunView>();
    expectTypeOf<ReturnType<typeof roomUnits>>().toExtend<SimView["rooms"]>();
    expectTypeOf<ReturnType<typeof structureRuns>>().toExtend<SimView["structure"]>();
  });

  it("the views are read-only", () => {
    expectTypeOf<TowerView["units"]>().toEqualTypeOf<ReadonlyArray<UnitView>>();
    expectTypeOf<TowerView["transports"]>().toEqualTypeOf<ReadonlyArray<TransportView>>();
    expectTypeOf<SimView["rooms"]>().toEqualTypeOf<ReadonlyArray<UnitView>>();
    expectTypeOf<SimView["structure"]>().toEqualTypeOf<ReadonlyArray<StructureRunView>>();
    expectTypeOf<CrowdView["people"]>().toEqualTypeOf<ReadonlyArray<PersonView>>();
    expectTypeOf<TransportView["carPositions"]>().toEqualTypeOf<ReadonlyArray<number>>();
  });

  it("every player op the relay carries has a command, and no command lacks one", () => {
    expectTypeOf<Command["op"]>().toEqualTypeOf<Exclude<ShadowCommand["op"], NotPlayerCommand>>();
    // A renamed or removed relay op leaves no stale name in the list above.
    expectTypeOf<NotPlayerCommand>().toExtend<ShadowCommand["op"]>();
  });

  it("every command and query has a result type", () => {
    expectTypeOf<keyof CommandResults>().toEqualTypeOf<Command["op"]>();
    expectTypeOf<keyof QueryResults>().toEqualTypeOf<Query["op"]>();
  });

  it("a command's result carries every field its callers read today", () => {
    expectTypeOf<CommandResults["extendTransport"]>().toExtend<ReturnType<Simulation["extendTransport"]>>();
    expectTypeOf<CommandResults["addCar"]>().toExtend<ReturnType<Simulation["addCar"]>>();
    expectTypeOf<CommandResults["removeCar"]>().toExtend<ReturnType<Simulation["removeCar"]>>();
    expectTypeOf<CommandResults["removeFacility"]>().toExtend<ReturnType<Simulation["removeFacility"]>>();
    expectTypeOf<CommandResults["callExterminator"]>().toExtend<ReturnType<Simulation["callExterminator"]>>();
    expectTypeOf<CommandResults["build"]>().toExtend<ReturnType<Simulation["build"]>>();
    expectTypeOf<CommandResults["buildTransport"]>().toExtend<ReturnType<Simulation["buildTransport"]>>();
    expectTypeOf<QueryResults["canBuild"]>().toExtend<ReturnType<Simulation["canBuild"]>>();
  });

  it("is read by the type checker", () => {
    // If these checks stopped being type-checked, this directive would
    // become unused and fail `npm run typecheck`.
    // @ts-expect-error a number is not a string
    expectTypeOf<number>().toEqualTypeOf<string>();
  });
});
