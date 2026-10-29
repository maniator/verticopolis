import { describe, expect, it, vi } from "vitest";
import { GAMEPLAY_COMMANDS, PLAY_SECONDS, createEngagementDetector, watchGameplayCommands, type PlaySample } from "./analyticsEngagement";
import type { EnginePortCommands } from "./simport/enginePort";

const playing = (clock: number): PlaySample => ({ visible: true, blocked: false, clock });

function detector() {
  const onEngaged = vi.fn();
  return { d: createEngagementDetector(onEngaged), onEngaged };
}

/** Play `n` seconds with the clock moving one minute a second, from `from`. */
function play(d: ReturnType<typeof createEngagementDetector>, n: number, from = 0, sample: (c: number) => PlaySample = playing): number {
  for (let i = 0; i <= n; i++) d.sample(sample(from + i));
  return from + n;
}

describe("the engagement rule (#1090)", () => {
  it("engages on the first accepted gameplay command, never on a refused one", () => {
    const { d, onEngaged } = detector();
    d.commandAnswered(false);
    expect(d.engaged).toBeNull();
    d.commandAnswered(true);
    d.commandAnswered(true);
    expect(d.engaged).toBe("command");
    expect(onEngaged).toHaveBeenCalledOnce();
    expect(onEngaged).toHaveBeenCalledWith("command");
  });

  it("engages after the 30th counted second of play, and only once", () => {
    const { d, onEngaged } = detector();
    const at = play(d, PLAY_SECONDS - 1);
    expect(d.engaged).toBeNull();
    d.sample(playing(at + 1));
    expect(d.engaged).toBe("play");
    play(d, 5, at + 2);
    d.commandAnswered(true);
    expect(onEngaged).toHaveBeenCalledOnce();
  });

  it("never counts a second with the clock still (paused), the tab hidden, or the splash or a dialog up", () => {
    const still = detector();
    for (let i = 0; i < PLAY_SECONDS * 3; i++) still.d.sample(playing(100));
    const hidden = detector();
    play(hidden.d, PLAY_SECONDS * 3, 0, (clock) => ({ visible: false, blocked: false, clock }));
    const blocked = detector();
    play(blocked.d, PLAY_SECONDS * 3, 0, (clock) => ({ visible: true, blocked: true, clock }));
    expect([still.d.engaged, hidden.d.engaged, blocked.d.engaged]).toEqual([null, null, null]);
  });

  it("adds up play across interruptions", () => {
    const { d } = detector();
    let at = play(d, PLAY_SECONDS / 2);
    for (let i = 0; i < 10; i++) d.sample(playing(at));
    at = play(d, PLAY_SECONDS / 2 - 2, at + 1);
    expect(d.engaged).toBeNull();
    d.sample(playing(at + 1));
    expect(d.engaged).toBe("play");
  });
});

describe("watchGameplayCommands", () => {
  const done = Float64Array.of(1, -5000);
  const refused = Float64Array.of(0, 0);

  function port() {
    const calls: string[] = [];
    const p: Record<string, (...a: unknown[]) => Float64Array> = {};
    for (const name of [...GAMEPLAY_COMMANDS, "nameTower", "setCamera", "logLine", "labelUnit"]) {
      p[name] = (...a) => {
        calls.push(name);
        return a[0] === "refuse" ? refused : done;
      };
    }
    return { p: p as unknown as EnginePortCommands, calls };
  }

  it("reports each gameplay command's answer and hands the record back untouched", () => {
    const { p, calls } = port();
    const answered = vi.fn();
    watchGameplayCommands(p, { commandAnswered: answered });
    expect((p.buildAt as unknown as (k: string) => Float64Array)("refuse")).toBe(refused);
    expect(p.demolish(3, false)).toBe(done);
    expect(answered.mock.calls).toEqual([[false], [true]]);
    expect(calls).toEqual(["buildAt", "demolish"]);
  });

  it("leaves naming, the camera, the log and labels alone", () => {
    const { p } = port();
    const answered = vi.fn();
    watchGameplayCommands(p, { commandAnswered: answered });
    p.nameTower("x");
    p.setCamera(0, 0, 1);
    p.logLine("x", 0);
    p.labelUnit(1, "x");
    expect(answered).not.toHaveBeenCalled();
  });

  it("skips a member the port does not have", () => {
    const answered = vi.fn();
    const partial = { buildAt: () => done } as unknown as EnginePortCommands;
    watchGameplayCommands(partial, { commandAnswered: answered });
    partial.buildAt(0, 0, 0);
    expect(answered).toHaveBeenCalledWith(true);
  });

  it("never costs the player a command when the detector throws", () => {
    const { p } = port();
    vi.spyOn(console, "error").mockImplementation(() => {});
    watchGameplayCommands(p, {
      commandAnswered: () => {
        throw new Error("boom");
      },
    });
    expect(p.bookExterminator()).toBe(done);
  });
});
