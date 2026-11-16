import { describe, expect, it, vi } from "vitest";
import { hostHelpBar, type HelpBarHostDeps } from "./helpBarHost";
import { ANSWER_FOR_MS, STATUS_EVERY_MS, type BarChannel, type GameStatus } from "./helpBarProtocol";

/** A stand-in channel that records what the host posts and lets a test speak. */
function fakeChannel() {
  const posted: unknown[] = [];
  const channel: BarChannel = { postMessage: vi.fn((m: unknown) => posted.push(m)), close: vi.fn(), onmessage: null };
  const hear = (data: unknown) => channel.onmessage?.({ data } as MessageEvent);
  return { channel, posted, hear };
}

const HUD = { date: "Wed, 1st WD", time: "9:00 AM", money: "$1,000", population: "120", stars: "★★☆☆☆" };

/** A host on a fake channel and clock, with the game's ports as spies. */
function host(over: Partial<HelpBarHostDeps> = {}) {
  const { channel, posted, hear } = fakeChannel();
  let t = 0;
  let tick: (() => void) | null = null;
  let speed = 0;
  let held = true;
  const deps = {
    open: () => channel,
    active: vi.fn(() => true),
    getSpeed: vi.fn(() => speed),
    setSpeed: vi.fn((s: number) => (speed = s)),
    heldForHelp: vi.fn(() => held),
    endHelpPause: vi.fn(() => {
      if (held) speed = 2;
      held = false;
    }),
    pauseForHelp: vi.fn(() => {
      held = true;
      speed = 0;
    }),
    visible: vi.fn(() => false),
    hud: vi.fn(() => HUD),
    now: () => t,
    setInterval: vi.fn((fn: () => void, ms: number) => {
      expect(ms).toBe(STATUS_EVERY_MS);
      tick = fn;
      return 7;
    }),
    clearInterval: vi.fn(),
    ...over,
  } satisfies HelpBarHostDeps;
  hostHelpBar(deps);
  return {
    deps,
    posted,
    hear,
    advance: (ms: number) => {
      t += ms;
      tick?.();
    },
    setSpeed: (s: number) => (speed = s),
    setHeld: (h: boolean) => (held = h),
  };
}

describe("the game's side of the Help bar", () => {
  it("stays quiet until a bar says hello, then answers at once and every second", () => {
    const h = host();
    expect(h.posted).toEqual([]);
    expect(h.deps.setInterval).not.toHaveBeenCalled();
    h.hear({ bar: "hello" });
    expect(h.posted).toEqual([{ game: "status", speed: 0, heldForHelp: true, visible: false, hud: HUD } satisfies GameStatus]);
    h.advance(STATUS_EVERY_MS);
    expect(h.posted).toHaveLength(2);
    // A second hello neither restarts the ticker nor doubles it.
    h.hear({ bar: "hello" });
    expect(h.deps.setInterval).toHaveBeenCalledTimes(1);
  });

  it("stops answering once the hellos stop", () => {
    const h = host();
    h.hear({ bar: "hello" });
    h.advance(ANSWER_FOR_MS + 1);
    expect(h.deps.clearInterval).toHaveBeenCalledWith(7);
    const count = h.posted.length;
    h.advance(STATUS_EVERY_MS);
    expect(h.posted).toHaveLength(count);
  });

  it("ends the Help pause on run, back to the speed Help took", () => {
    const h = host();
    h.hear({ bar: "run" });
    expect(h.deps.endHelpPause).toHaveBeenCalledTimes(1);
    expect(h.deps.setSpeed).not.toHaveBeenCalled();
    expect(h.posted[h.posted.length - 1]).toMatchObject({ speed: 2, heldForHelp: false });
  });

  it("starts a tower the player had paused at slow speed on run", () => {
    const h = host();
    h.setHeld(false);
    h.hear({ bar: "run" });
    expect(h.deps.setSpeed).toHaveBeenCalledWith(1);
  });

  it("holds a Help pause on pause", () => {
    const h = host();
    h.setHeld(false);
    h.setSpeed(3);
    h.hear({ bar: "pause" });
    expect(h.deps.pauseForHelp).toHaveBeenCalledTimes(1);
    expect(h.posted[h.posted.length - 1]).toMatchObject({ speed: 0, heldForHelp: true });
  });

  it("ignores anything that is not a bar's request", () => {
    const h = host();
    for (const data of [null, "hello", { bar: "quit" }, { game: "status" }]) h.hear(data);
    expect(h.posted).toEqual([]);
    expect(h.deps.endHelpPause).not.toHaveBeenCalled();
  });

  it("stays quiet with no tower open, and stops when the tower closes", () => {
    let active = false;
    const h = host({ active: () => active });
    h.hear({ bar: "run" });
    expect(h.posted).toEqual([]);
    expect(h.deps.endHelpPause).not.toHaveBeenCalled();
    active = true;
    h.hear({ bar: "hello" });
    active = false;
    h.advance(STATUS_EVERY_MS);
    expect(h.deps.clearInterval).toHaveBeenCalled();
    expect(h.posted).toHaveLength(1);
  });

  it("does nothing where the browser has no channel", () => {
    expect(() => hostHelpBar({ ...host().deps, open: () => null })).not.toThrow();
  });
});
