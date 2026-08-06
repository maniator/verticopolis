import { describe, it, expect, vi, beforeEach } from "vitest";

// playSfx reads Tone.now() for its schedule base; everything else it touches
// is the voice set the test injects, so a one-function mock keeps this suite
// off the real AudioContext. The clock is mutable so the error-holdoff tests
// can move time forward.
const clock = vi.hoisted(() => ({ now: 0 }));
vi.mock("tone", () => ({ now: () => clock.now }));

import { playSfx, resetSfxHoldoff, type SfxVoices } from "./toneVoices";
import type { SfxName } from "./toneScenes";

/**
 * toneVoices is the action jingles, all human-voiced from the owner's recorded
 * bloop and ping. These tests pin the public contract: every jingle schedules
 * at least one note with finite frequencies, the bloop cues ramp and never
 * land below the 160 Hz small-speaker floor, the promote phrase is the splash
 * theme's peak turn on the bell voice, and the error cue's holdoff drops
 * mid-gesture retriggers.
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
    bloopPartial: { triggerAttackRelease: vi.fn() },
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
    ...v.bloopPartial.triggerAttackRelease.mock.calls,
    ...v.bell.triggerAttackRelease.mock.calls,
    ...v.bellPartial.triggerAttackRelease.mock.calls,
  ];
}

beforeEach(() => {
  clock.now = 0;
  resetSfxHoldoff();
});

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

  it("every bloop cue ramps downward and never lands below the 160 Hz floor", () => {
    for (const name of ["build", "click", "sell", "error"] as SfxName[]) {
      const v = fakeVoices();
      playSfx(asVoices(v), name);
      const ramps = v.bloop.frequency.exponentialRampToValueAtTime.mock.calls;
      const starts = v.bloop.frequency.setValueAtTime.mock.calls;
      expect(ramps.length, `${name} scheduled no ramp`).toBeGreaterThan(0);
      for (let i = 0; i < ramps.length; i++) {
        const target = ramps[i][0] as number;
        const start = starts[i][0] as number;
        // An exponential ramp to 0 throws in the native AudioParam; the target
        // must sit below the start for the swoop to fall, and at or above the
        // small-speaker floor so the owner can hear it on a phone.
        expect(target).toBeGreaterThanOrEqual(160);
        expect(target).toBeLessThan(start);
      }
      // The ramp must be scheduled after the trigger, or the trigger's own
      // setValueAtTime silently overrides it and the swoop goes flat.
      const trigger = v.bloop.triggerAttackRelease.mock.invocationCallOrder[0];
      const cancel = v.bloop.frequency.cancelScheduledValues.mock.invocationCallOrder[0];
      expect(trigger).toBeLessThan(cancel);
    }
  });

  it("deep bloops carry their small-speaker partials; the click stays bare", () => {
    for (const name of ["build", "sell", "error"] as SfxName[]) {
      const v = fakeVoices();
      playSfx(asVoices(v), name);
      expect(
        v.bloopPartial.triggerAttackRelease.mock.calls.length,
        `${name} played no partials`,
      ).toBeGreaterThan(0);
    }
    // The click's floor (380 Hz) is high enough to need no reinforcement.
    const v = fakeVoices();
    playSfx(asVoices(v), "click");
    expect(v.bloopPartial.triggerAttackRelease).not.toHaveBeenCalled();
  });

  it("sell and error are two-bloop gestures; build and click are one", () => {
    const counts: Array<[SfxName, number]> = [
      ["build", 1],
      ["click", 1],
      ["sell", 2],
      ["error", 2],
    ];
    for (const [name, n] of counts) {
      const v = fakeVoices();
      playSfx(asVoices(v), name);
      expect(v.bloop.triggerAttackRelease.mock.calls.length, name).toBe(n);
    }
  });

  it("error holds off retriggers inside its gesture, then fires again", () => {
    const v = fakeVoices();
    playSfx(asVoices(v), "error");
    expect(v.bloop.triggerAttackRelease.mock.calls.length).toBe(2);
    // Drag-painting an invalid zone: repeats inside the holdoff are dropped.
    clock.now = 0.1;
    playSfx(asVoices(v), "error");
    expect(v.bloop.triggerAttackRelease.mock.calls.length).toBe(2);
    // Past the holdoff the cue speaks again.
    clock.now = 0.5;
    playSfx(asVoices(v), "error");
    expect(v.bloop.triggerAttackRelease.mock.calls.length).toBe(4);
    // The holdoff never gags OTHER bloop cues.
    clock.now = 0.55;
    playSfx(asVoices(v), "build");
    expect(v.bloop.triggerAttackRelease.mock.calls.length).toBe(5);
  });

  it("promote is the splash theme's peak turn on the bell voice", () => {
    const v = fakeVoices();
    playSfx(asVoices(v), "promote");
    expect(v.jingle.triggerAttackRelease).not.toHaveBeenCalled();
    expect(v.bloop.triggerAttackRelease).not.toHaveBeenCalled();
    expect(v.bell.triggerAttackRelease).toHaveBeenCalledTimes(4);
    expect(v.bellPartial.triggerAttackRelease).toHaveBeenCalledTimes(4);
    // The phrase: C5 D5 B4 A4 (the Terrace tune's peak), strikes strictly later.
    const calls = v.bell.triggerAttackRelease.mock.calls as Array<
      [number, number, number, number]
    >;
    const midiOf = (hz: number) => Math.round(69 + 12 * Math.log2(hz / 440));
    expect(calls.map((c) => midiOf(c[0]))).toEqual([72, 74, 71, 69]);
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i][2]).toBeGreaterThan(calls[i - 1][2]);
    }
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

  it("money keeps the legacy four-note jingle", () => {
    const v = fakeVoices();
    playSfx(asVoices(v), "money");
    expect(v.jingle.triggerAttackRelease).toHaveBeenCalledTimes(4);
    expect(v.bloop.triggerAttackRelease).not.toHaveBeenCalled();
    expect(v.bell.triggerAttackRelease).not.toHaveBeenCalled();
  });
});
