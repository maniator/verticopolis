import { describe, expect, it, vi } from "vitest";
import { PortEvents } from "./portEvents";
import { mockPort } from "../tests/portKit/mockPort";

/** The events source over a mock port: what it asks the engine, and what it
 *  makes of the answers. The engine side runs in `portReads.integration.test.ts`. */

function source(texts: (string | undefined)[], dropped = 0) {
  let gen = 3;
  const port = mockPort({
    drainEvents: () => Float64Array.of(dropped, texts.length),
    eventText: (i) => texts[i],
    setBackdrop: () => undefined,
    generation: () => gen,
  });
  return { port, events: new PortEvents(port), swap: () => gen++ };
}

describe("PortEvents", () => {
  it("drains the count the engine reports, reading each event's text once", () => {
    const { port, events } = source(['{"name":"tower_founded"}', undefined, '{"name":"star_reached","star":2}'], 4);
    expect(events.drainGameplayEvents()).toEqual([{ name: "tower_founded" }, { name: "star_reached", star: 2 }]);
    expect(port.drainEvents).toHaveBeenCalledOnce();
    expect(vi.mocked(port.eventText).mock.calls).toEqual([[0], [1], [2]]);
    expect(events.gameplayEventsDropped).toBe(4);
  });

  it("reads no text when the engine has no events", () => {
    const { port, events } = source([]);
    expect(events.drainGameplayEvents()).toEqual([]);
    expect(port.eventText).not.toHaveBeenCalled();
    expect(events.gameplayEventsDropped).toBe(0);
  });

  it("passes the backdrop mark on, and holds it for the generation it was set in", () => {
    const { port, events, swap } = source([]);
    expect(events.gameplayEvents.discardOnHandOff).toBe(false);
    events.setBackdrop(true);
    expect(events.gameplayEvents.discardOnHandOff).toBe(true);
    swap();
    expect(events.gameplayEvents.discardOnHandOff).toBe(false);
    events.setBackdrop(true);
    events.setBackdrop(false);
    expect(events.gameplayEvents.discardOnHandOff).toBe(false);
    expect(vi.mocked(port.setBackdrop).mock.calls).toEqual([[true], [true], [false]]);
  });
});
