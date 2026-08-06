import { describe, it, expect, vi } from "vitest";

// playSfx reads Tone.now() for its schedule base; everything else it touches
// is the voice set the test injects, so a one-function mock keeps this suite
// off the real AudioContext.
vi.mock("tone", () => ({ now: () => 0 }));

import { playSfx, type SfxVoices } from "./toneVoices";
import type { SfxName } from "./toneScenes";

/**
 * toneVoices is now just the action jingles. These tests pin the public
 * contract: every jingle name schedules at least one note, every pitch handed
 * to a synth is a finite frequency (a NaN would throw inside the native
 * AudioParam at runtime), and the human-voiced cues (the build bloop and the
 * ping bell) follow the recipes the GDD amendment fixed by ear.
 */

function fakeVoices() {
  return {
    jingle: { triggerAttackRelease: vi.fn() },
    bloop: {
      triggerAttackRelease: vi.fn(),
      frequency: {
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
    },
    bell: { triggerAttackRelease: vi.fn() },
    bellPartial: { triggerAttackRelease: vi.fn() },
  };
}
type FakeVoices = ReturnType<typeof fakeVoices>;
const asVoices = (v: FakeVoices) => v as unknown as SfxVoices;

const names: SfxName[] = ["build", "sell", "error", "promote", "money", "notify", "click"];

function noteCalls(v: FakeVoices) {
  return [
    ...v.jingle.triggerAttackRelease.mock.calls,
    ...v.bloop.triggerAttackRelease.mock.calls,
    ...v.bell.triggerAttackRelease.mock.calls,
    ...v.bellPartial.triggerAttackRelease.mock.calls,
  ];
}

describe("playSfx", () => {
  it("schedules finite-frequency notes for every jingle", () => {
    for (const name of names) {
      const v = fakeVoices();
      playSfx(asVoices(v), name);
      const calls = noteCalls(v);
      expect(calls.length, `jingle ${name} played nothing`).toBeGreaterThan(0);
      for (const call of calls) {
        expect(Number.isFinite(call[0] as number)).toBe(true);
      }
    }
  });

  it("plays multi-note runs for the celebratory jingles", () => {
    for (const name of ["money", "promote"] as SfxName[]) {
      const v = fakeVoices();
      playSfx(asVoices(v), name);
      expect(noteCalls(v).length).toBeGreaterThanOrEqual(4);
    }
  });

  it("build is the bloop alone: a 520 to 180 Hz swoop, nothing on the old synth", () => {
    const v = fakeVoices();
    playSfx(asVoices(v), "build");
    expect(v.jingle.triggerAttackRelease).not.toHaveBeenCalled();
    expect(v.bell.triggerAttackRelease).not.toHaveBeenCalled();
    expect(v.bloop.triggerAttackRelease).toHaveBeenCalledTimes(1);
    expect(v.bloop.frequency.setValueAtTime).toHaveBeenCalledWith(520, 0);
    const [target, at] = v.bloop.frequency.exponentialRampToValueAtTime.mock.calls[0] as [
      number,
      number,
    ];
    // An exponential ramp to 0 throws in the native AudioParam; the target
    // must also sit below the start for the swoop to fall.
    expect(target).toBeGreaterThan(0);
    expect(target).toBeLessThan(520);
    expect(at).toBeGreaterThan(0);
    // The ramp must be scheduled after the trigger, or the trigger's own
    // setValueAtTime silently overrides it and the swoop goes flat.
    const trigger = v.bloop.triggerAttackRelease.mock.invocationCallOrder[0];
    const cancel = v.bloop.frequency.cancelScheduledValues.mock.invocationCallOrder[0];
    expect(trigger).toBeLessThan(cancel);
  });

  it("notify is one bell strike with its quiet upper partial", () => {
    const v = fakeVoices();
    playSfx(asVoices(v), "notify");
    expect(v.jingle.triggerAttackRelease).not.toHaveBeenCalled();
    expect(v.bell.triggerAttackRelease).toHaveBeenCalledTimes(1);
    expect(v.bellPartial.triggerAttackRelease).toHaveBeenCalledTimes(1);
    const fund = v.bell.triggerAttackRelease.mock.calls[0] as [number, number, number, number];
    const part = v.bellPartial.triggerAttackRelease.mock.calls[0] as [
      number,
      number,
      number,
      number,
    ];
    expect(part[0]).toBeGreaterThan(fund[0]);
    expect(part[3]).toBeLessThan(fund[3]);
  });

  it("promote is the five-note fanfare struck on the bell voice", () => {
    const v = fakeVoices();
    playSfx(asVoices(v), "promote");
    expect(v.jingle.triggerAttackRelease).not.toHaveBeenCalled();
    expect(v.bell.triggerAttackRelease).toHaveBeenCalledTimes(5);
    expect(v.bellPartial.triggerAttackRelease).toHaveBeenCalledTimes(5);
    // Rising fanfare: fundamentals strictly ascend, strikes strictly later.
    const calls = v.bell.triggerAttackRelease.mock.calls as Array<
      [number, number, number, number]
    >;
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i][0]).toBeGreaterThan(calls[i - 1][0]);
      expect(calls[i][2]).toBeGreaterThan(calls[i - 1][2]);
    }
  });
});
