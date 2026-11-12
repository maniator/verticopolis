import { describe, it, expect, vi } from "vitest";
import { HelpPause, PAUSED_FOR_HELP, backAt, type HelpPausePorts } from "./helpPause";

/** Spied ports around a speed the test controls. */
function ports(start: number) {
  let speed = start;
  const p = {
    getSpeed: vi.fn(() => speed),
    setSpeed: vi.fn((s: number) => {
      speed = s;
    }),
    announce: vi.fn<(t: string) => void>(),
    markToolbar: vi.fn<(held: boolean) => void>(),
  } satisfies HelpPausePorts;
  return { p, playerSets: (s: number) => (speed = s), speed: () => speed };
}

/** A window and document that fire the listeners the watch adds, on demand. */
function tab() {
  const listeners = new Map<string, Set<() => void>>();
  const on = (type: string, fn: () => void) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
  };
  const off = (type: string, fn: () => void) => listeners.get(type)?.delete(fn);
  const state = { visibility: "visible" as DocumentVisibilityState, focused: true };
  const fire = (type: string) => [...(listeners.get(type) ?? [])].forEach((fn) => fn());
  const target = {
    win: { addEventListener: vi.fn(on), removeEventListener: vi.fn(off) },
    doc: {
      addEventListener: vi.fn(on),
      removeEventListener: vi.fn(off),
      hasFocus: () => state.focused,
      get visibilityState() {
        return state.visibility;
      },
    },
  };
  return {
    target: target as never,
    leave: () => {
      state.focused = false;
      fire("blur");
      state.visibility = "hidden";
      fire("visibilitychange");
    },
    comeBack: () => {
      state.visibility = "visible";
      fire("visibilitychange");
      state.focused = true;
      fire("focus");
    },
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
}

describe("HelpPause in-game", () => {
  it("pauses, marks the toolbar and says so on begin", () => {
    const { p } = ports(2);
    new HelpPause(p).begin();
    expect(p.setSpeed).toHaveBeenCalledWith(0);
    expect(p.markToolbar).toHaveBeenCalledWith(true);
    expect(p.announce).toHaveBeenCalledWith(PAUSED_FOR_HELP);
  });

  it("restores the prior speed once, however many closes arrive", () => {
    const { p, speed } = ports(3);
    const pause = new HelpPause(p);
    pause.begin();
    pause.end();
    pause.end();
    expect(speed()).toBe(3);
    expect(p.setSpeed).toHaveBeenCalledTimes(2);
    expect(p.markToolbar).toHaveBeenLastCalledWith(false);
    expect(p.announce).toHaveBeenLastCalledWith("Back at fast speed");
  });

  it("keeps the first speed when a second Help action begins inside the pause", () => {
    const { p, speed } = ports(1);
    const pause = new HelpPause(p);
    pause.begin();
    pause.begin();
    pause.end();
    expect(speed()).toBe(1);
  });

  it("leaves an already paused tower paused, and says nothing", () => {
    const { p } = ports(0);
    const pause = new HelpPause(p);
    pause.begin();
    pause.end();
    expect(p.setSpeed).not.toHaveBeenCalled();
    expect(p.announce).not.toHaveBeenCalled();
    expect(p.markToolbar).not.toHaveBeenCalled();
  });

  it("keeps a speed the player chose while Help was open", () => {
    const { p, playerSets, speed } = ports(2);
    const pause = new HelpPause(p);
    pause.begin();
    playerSets(1);
    pause.end();
    expect(speed()).toBe(1);
    expect(p.markToolbar).toHaveBeenLastCalledWith(false);
    expect(p.announce).toHaveBeenCalledTimes(1);
  });

  it("keeps the pause across a swap to the next Help dialog, and ends it on any other displacement", () => {
    const { p, speed } = ports(2);
    const pause = new HelpPause(p);
    pause.begin();
    pause.swap(() => pause.displaced());
    expect(pause.held).toBe(true);
    expect(speed()).toBe(0);
    pause.displaced();
    expect(pause.held).toBe(false);
    expect(speed()).toBe(2);
  });

  it("names each speed the way the toolbar does", () => {
    expect(backAt(1)).toBe("Back at slow speed");
    expect(backAt(2)).toBe("Back at medium speed");
  });
});

describe("HelpPause for Help in a new tab", () => {
  it("does not count the opening click as a return: the tab never left", () => {
    const { p, speed } = ports(2);
    const pause = new HelpPause(p);
    const t = tab();
    pause.begin();
    pause.untilReturn(t.target);
    t.comeBack(); // focus and visibility events while still here
    expect(speed()).toBe(0);
  });

  it("resumes once, when the game tab is visible and focused after being left", () => {
    const { p, speed } = ports(2);
    const pause = new HelpPause(p);
    const t = tab();
    pause.begin();
    pause.untilReturn(t.target);
    t.leave();
    expect(speed()).toBe(0);
    t.comeBack();
    expect(speed()).toBe(2);
    expect(p.announce).toHaveBeenLastCalledWith("Back at medium speed");
    expect(t.count()).toBe(0);
  });

  it("drops the watch when Help is opened again in the game, keeping the first speed", () => {
    const { p, speed } = ports(3);
    const pause = new HelpPause(p);
    const t = tab();
    pause.begin();
    pause.untilReturn(t.target);
    pause.begin();
    expect(t.count()).toBe(0);
    pause.end();
    expect(speed()).toBe(3);
  });

  it("ignores the dialog's own close when Help went to a new tab, and ends on it otherwise", () => {
    const { p, speed } = ports(2);
    const pause = new HelpPause(p);
    const t = tab();
    pause.begin();
    pause.untilReturn(t.target);
    pause.closed();
    expect(speed()).toBe(0);
    t.leave();
    t.comeBack();
    expect(speed()).toBe(2);
    pause.begin();
    pause.closed();
    expect(speed()).toBe(2);
    expect(pause.held).toBe(false);
  });

  it("arms nothing when no pause is held", () => {
    const { p } = ports(0);
    const pause = new HelpPause(p);
    const t = tab();
    pause.untilReturn(t.target);
    expect(t.count()).toBe(0);
  });
});
