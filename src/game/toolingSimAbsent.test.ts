import { describe, expect, it } from "vitest";
import type * as tooling from "./toolingSim";
import * as absent from "./toolingSimAbsent";

// The stand-in replaces the tooling module by alias in a production build, so
// it must offer every export the module has, with the same types; this fails to
// typecheck when the module gains or changes one.
const sameShape: typeof tooling = absent;
void sameShape;

describe("toolingSimAbsent", () => {
  const app = {} as Parameters<typeof tooling.toolingSim>[0];

  it("reads the harness tower as absent and has no edits to hand over", () => {
    expect(absent.toolingSim(app)).toBeUndefined();
    expect(() => absent.syncToolingSim(app)).not.toThrow();
  });

  it("refuses a hand-built tower and an edit follow-up by name", () => {
    expect(() => absent.adoptToolingSim(app, {} as Parameters<typeof tooling.adoptToolingSim>[1], false)).toThrow(/adoptSim is for tooling builds only/);
    expect(() => absent.followToolingEdit({} as Parameters<typeof tooling.followToolingEdit>[0])).toThrow(/followEdit is for tooling builds only/);
  });
});
