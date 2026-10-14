import { describe, expect, it } from "vitest";
import { drainEngineBatch } from "./engineEvents";

/** An engine stand-in that holds `pending` events and drains as `text`. */
function engine(text: string, pending: number) {
  const e = {
    drains: 0,
    gameplayEventsPending: () => pending,
    drainGameplayEvents: () => {
      e.drains++;
      return text;
    },
  };
  return e;
}

describe("the typed engine drain", () => {
  it("parses a batch and loses nothing", () => {
    const batch = [{ name: "star_reached", payload: { star: 2 } }];
    expect(drainEngineBatch(engine(JSON.stringify(batch), 1))).toEqual({ events: batch, lost: 0 });
  });

  it("counts an unreadable batch as lost, since the drain already emptied the engine", () => {
    const e = engine("[{\"name\":", 3);
    expect(drainEngineBatch(e)).toEqual({ events: [], lost: 3 });
    expect(e.drains).toBe(1);
  });

  it("counts a batch that is not a list as lost", () => {
    expect(drainEngineBatch(engine("{\"name\":\"fire_started\"}", 1))).toEqual({ events: [], lost: 1 });
  });

  it("lets an engine that throws throw", () => {
    const trapped = {
      gameplayEventsPending: () => 2,
      drainGameplayEvents: (): string => {
        throw new Error("unreachable executed");
      },
    };
    expect(() => drainEngineBatch(trapped)).toThrow(/unreachable/);
  });
});
