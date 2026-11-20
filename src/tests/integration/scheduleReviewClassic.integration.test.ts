import { describe, expect, it } from "vitest";
import type { SerializedGame } from "@verticopolis/engine/model/types";
import { scheduleSlots } from "@verticopolis/engine/port/scheduleSlots";
import { diffPaths, load, play } from "./scheduleReview.fixture";
import { noEngine } from "../portKit/rustEngine";

/** The schedule review on a Classic tower, and what Undo does to its one-time mention (#1556). The Modern flows are
 *  in `scheduleReview.integration.test.ts`. */
describe.skipIf(noEngine)("the schedule review on a Classic tower, and across Undo (#1556)", () => {
  /** sixseven_2, a Classic tower, saved with its first elevator's schedule set to one car in every hour, as an older
   *  build could leave it. */
  function classicWithFlatShaft(): { raw: SerializedGame; id: number; cars: number } {
    const g = play(load("sixseven_2"));
    expect(g.reader.header.mode).toBe("classic");
    const shaft = g.reader.tower.transports.find((t) => t.kind.startsWith("elevator") && t.cars > 1)!;
    const res = g.port.scheduleShaft(
      shaft.id,
      scheduleSlots({ activeCars: { weekday: Array(24).fill(1), weekend: Array(24).fill(1) } }),
    );
    expect(res[0], g.port.lastReason() ?? "").toBe(1);
    return { raw: JSON.parse(g.port.serialize()) as SerializedGame, id: shaft.id, cars: shaft.cars };
  }

  it("mentions, lists and recovers a flat short schedule on a Classic tower the same way", async () => {
    const { raw, id, cars } = classicWithFlatShaft();
    const g = play(raw);
    g.review.tick();
    expect(g.toasts).toEqual([
      "An elevator has more cars than its schedule puts on shift. Choose Tower > Statistics… to review it. Nothing changes unless you choose it.",
    ]);
    expect(g.review.undecided().map((f) => f.shaft.id)).toEqual([id]);
    const before = g.saved();
    g.review.recover(id);
    expect(g.scheduleOf(id)!.activeCars).toEqual({ weekday: Array(24).fill(cars), weekend: Array(24).fill(cars) });
    expect(g.review.undecided()).toEqual([]);
    await g.history.undo();
    expect(diffPaths(before, g.saved())).toEqual([]);
  });

  it("does not mention a schedule set after the look across an Undo", async () => {
    const { raw, id } = classicWithFlatShaft();
    const g = play(raw);
    g.review.tick();
    expect(g.toasts).toHaveLength(1);
    const [other, third] = g.reader.tower.transports.filter(
      (t) => t.kind.startsWith("elevator") && t.cars > 1 && t.id !== id,
    );
    const edit = (shaftId: number, weekday: number[]) => {
      g.history.capture("Schedule");
      expect(g.port.scheduleShaft(shaftId, scheduleSlots({ activeCars: { weekday, weekend: weekday } }))[0]).toBe(1);
      g.history.commit();
    };
    // The player sets another elevator to a short flat schedule on purpose, then makes and undoes an unrelated edit.
    edit(other!.id, Array(24).fill(1));
    edit(
      third!.id,
      Array.from({ length: 24 }, (_, h) => (h < 12 ? 1 : 2)),
    );
    const generation = g.port.generation();
    await g.history.undo();
    // An Undo is a step like an edit and keeps the generation (#1802).
    expect(g.port.generation()).toBe(generation);
    expect(g.review.undecided().map((f) => f.shaft.id)).toContain(other!.id);
    g.review.tick();
    // Undo says what it undid in a toast of its own; the review adds none.
    expect(g.toasts.filter((t) => /more cars than/.test(t))).toHaveLength(1);
  });

  it("drops a kept schedule from the Tower Statistics count but still lists it", () => {
    const { raw, id } = classicWithFlatShaft();
    const g = play(raw);
    g.review.keep(id);
    expect(g.review.undecided()).toEqual([]);
    g.review.open();
    expect(g.dialog().rows.map((r) => [r.id, r.kept])).toEqual([[id, true]]);
  });
});
