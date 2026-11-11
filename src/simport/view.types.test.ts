import { describe, expectTypeOf, it } from "vitest";
import type { Command, CommandResults } from "./commands";
import type { Query, QueryResults } from "./queries";
import type { CrowdView, PersonView, SimView, StructureRunView, TowerView, TransportView, UnitView } from "./view";

describe("the port's types", () => {
  it("the views are read-only", () => {
    expectTypeOf<TowerView["units"]>().toEqualTypeOf<ReadonlyArray<UnitView>>();
    expectTypeOf<TowerView["transports"]>().toEqualTypeOf<ReadonlyArray<TransportView>>();
    expectTypeOf<SimView["rooms"]>().toEqualTypeOf<ReadonlyArray<UnitView>>();
    expectTypeOf<SimView["structure"]>().toEqualTypeOf<ReadonlyArray<StructureRunView>>();
    expectTypeOf<CrowdView["people"]>().toEqualTypeOf<ReadonlyArray<PersonView>>();
    expectTypeOf<TransportView["carPositions"]>().toEqualTypeOf<ReadonlyArray<number>>();
  });

  it("every command and query has a result type", () => {
    expectTypeOf<keyof CommandResults>().toEqualTypeOf<Command["op"]>();
    expectTypeOf<keyof QueryResults>().toEqualTypeOf<Query["op"]>();
  });

  it("is read by the type checker", () => {
    // If these checks stopped being type-checked, this directive would
    // become unused and fail `npm run typecheck`.
    // @ts-expect-error a number is not a string
    expectTypeOf<number>().toEqualTypeOf<string>();
  });
});
