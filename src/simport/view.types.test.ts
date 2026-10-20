import { describe, expectTypeOf, it } from "vitest";
import type { Crowd } from "../engine/Crowd";
import type { Person } from "../engine/crowd/person";
import type { Simulation } from "../engine/Simulation";
import type { Tower } from "../engine/Tower";
import type { Transport, Unit } from "../engine/types";
import type { ShadowCommand } from "../dualrun/commands";
import type { Command, CommandResults } from "./commands";
import type { Query, QueryResults } from "./queries";
import type { CrowdView, HeaderView, PersonView, TowerView, TransportView, UnitView } from "./view";

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
    expectTypeOf<Tower>().toMatchTypeOf<TowerView>();
    expectTypeOf<Unit>().toMatchTypeOf<UnitView>();
    expectTypeOf<Transport>().toMatchTypeOf<TransportView>();
    expectTypeOf<Crowd>().toMatchTypeOf<CrowdView>();
    expectTypeOf<Person>().toMatchTypeOf<PersonView>();
    expectTypeOf<Simulation["pendingChoice"]>().toMatchTypeOf<HeaderView["pendingChoice"]>();
  });

  it("the views are read-only", () => {
    expectTypeOf<TowerView["units"]>().toEqualTypeOf<ReadonlyArray<UnitView>>();
    expectTypeOf<TowerView["transports"]>().toEqualTypeOf<ReadonlyArray<TransportView>>();
    expectTypeOf<CrowdView["people"]>().toEqualTypeOf<ReadonlyArray<PersonView>>();
    expectTypeOf<TransportView["carPositions"]>().toEqualTypeOf<ReadonlyArray<number>>();
  });

  it("every player op the relay carries has a command, and no command lacks one", () => {
    expectTypeOf<Command["op"]>().toEqualTypeOf<Exclude<ShadowCommand["op"], NotPlayerCommand>>();
  });

  it("every command and query has a result type", () => {
    expectTypeOf<keyof CommandResults>().toEqualTypeOf<Command["op"]>();
    expectTypeOf<keyof QueryResults>().toEqualTypeOf<Query["op"]>();
  });

  it("a command's result keeps what its callers read today", () => {
    expectTypeOf<ReturnType<Simulation["extendTransport"]>>().toMatchTypeOf<CommandResults["extendTransport"]>();
    expectTypeOf<ReturnType<Simulation["addCar"]>>().toMatchTypeOf<CommandResults["addCar"]>();
    expectTypeOf<ReturnType<Simulation["removeFacility"]>>().toMatchTypeOf<CommandResults["removeFacility"]>();
    expectTypeOf<ReturnType<Simulation["callExterminator"]>>().toMatchTypeOf<CommandResults["callExterminator"]>();
    expectTypeOf<ReturnType<Simulation["build"]>>().toMatchTypeOf<CommandResults["build"]>();
    expectTypeOf<ReturnType<Simulation["canBuild"]>>().toMatchTypeOf<QueryResults["canBuild"]>();
  });
});
