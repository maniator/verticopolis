import { describe, expect, it, vi } from "vitest";
import { runSceneShots } from "./screenshotChain";

const shots = ["1-star", "2-star", "3-star", "4-star"].map((name) => ({ name }));

/** A `take` spy that throws for the shot named `bad`. */
function taker(bad: string) {
  return vi.fn(async (shot: { name: string }) => {
    if (shot.name === bad) throw new Error("settle timed out");
  });
}

describe("running a scene's shots (#931)", () => {
  it("skips every later shot of a chained scene after one fails, naming the first failure", async () => {
    const take = taker("2-star");
    const fail = vi.fn();
    await runSceneShots(shots, true, take, fail);
    expect(take.mock.calls.map(([s]) => s.name)).toEqual(["1-star", "2-star"]);
    expect(fail.mock.calls.map(([s, m]) => [s.name, m])).toEqual([
      ["2-star", "settle timed out"],
      ["3-star", `skipped: this scene's shots build on one another and "2-star" failed first`],
      ["4-star", `skipped: this scene's shots build on one another and "2-star" failed first`],
    ]);
  });

  it("keeps taking the rest of an unchained scene, whose shots stand alone", async () => {
    const take = taker("2-star");
    const fail = vi.fn();
    await runSceneShots(shots, false, take, fail);
    expect(take.mock.calls.map(([s]) => s.name)).toEqual(["1-star", "2-star", "3-star", "4-star"]);
    expect(fail.mock.calls.map(([s, m]) => [s.name, m])).toEqual([["2-star", "settle timed out"]]);
  });

  it("takes every shot and records nothing when none fails", async () => {
    const take = taker("none");
    const fail = vi.fn();
    await runSceneShots(shots, true, take, fail);
    expect(take).toHaveBeenCalledTimes(4);
    expect(fail).not.toHaveBeenCalled();
  });
});
