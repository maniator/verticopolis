import { describe, it, expect, vi, beforeEach } from "vitest";

// playSfx reads Tone.now() for its schedule base; everything else it touches
// is the voice set the test injects, so a one-function mock keeps this suite
// off the real AudioContext. The clock is mutable so the error-holdoff tests
// can move time forward.
const clock = vi.hoisted(() => ({ now: 0 }));
vi.mock("tone", () => ({ now: () => clock.now }));

import { playSfx, type SfxVoices } from "./toneVoices";
import type { SfxName } from "./toneScenes";

/**
 * toneVoices is the action jingles, all human-voiced from the owner's recorded
 * bloop and ping. These tests pin the public contract: every jingle schedules
 * at least one note with finite frequencies, the bloop cues ramp and never
 * land below the 160 Hz small-speaker floor, the promote phrase is the splash
 * theme's peak turn on the bell voice, and the error cue's holdoff drops
 * mid-gesture retriggers.
 */

function fakeGlideSynth() {
  return {
    triggerAttackRelease: vi.fn(),
    envelope: { decay: 0.2 },
    frequency: {
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
  };
}

function fakeVoices() {
  return {
    jingle: { triggerAttackRelease: vi.fn() },
    bloop: fakeGlideSynth(),
    bloop2: fakeGlideSynth(),
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
    ...v.bloop2.triggerAttackRelease.mock.calls,
    ...v.bloopPartial.triggerAttackRelease.mock.calls,
    ...v.bell.triggerAttackRelease.mock.calls,
    ...v.bellPartial.triggerAttackRelease.mock.calls,
  ];
}

/** Both mono glide voices' ramp schedules, in call order per voice. */
function glideRamps(v: FakeVoices) {
  return [v.bloop, v.bloop2].flatMap((g) =>
    g.frequency.exponentialRampToValueAtTime.mock.calls.map((ramp, i) => ({
      target: ramp[0] as number,
      start: g.frequency.setValueAtTime.mock.calls[i][0] as number,
    })),
  );
}

beforeEach(() => {
  clock.now = 0;
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
      const ramps = glideRamps(v);
      expect(ramps.length, `${name} scheduled no ramp`).toBeGreaterThan(0);
      for (const { target, start } of ramps) {
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

  it("a two-bloop gesture splits across the two glide voices, so the second swoop cannot cancel the first's ramp", () => {
    for (const name of ["sell", "error"] as SfxName[]) {
      const v = fakeVoices();
      playSfx(asVoices(v), name);
      expect(v.bloop.triggerAttackRelease, name).toHaveBeenCalledTimes(1);
      expect(v.bloop2.triggerAttackRelease, name).toHaveBeenCalledTimes(1);
    }
  });

  it("every bloop carries its small-speaker partials (two per swoop)", () => {
    const swoops: Array<[SfxName, number]> = [
      ["build", 1],
      ["click", 1],
      ["sell", 2],
      ["error", 2],
    ];
    for (const [name, n] of swoops) {
      const v = fakeVoices();
      playSfx(asVoices(v), name);
      expect(v.bloopPartial.triggerAttackRelease.mock.calls.length, name).toBe(n * 2);
    }
  });

  it("cue-specific envelope decays are applied before the trigger", () => {
    const v = fakeVoices();
    playSfx(asVoices(v), "click");
    expect(v.bloop.envelope.decay).toBeCloseTo(0.09);
    playSfx(asVoices(v), "error");
    expect(v.bloop.envelope.decay).toBeCloseTo(0.3);
    expect(v.bloop2.envelope.decay).toBeCloseTo(0.3);
  });

  it("error holds off retriggers across its whole gesture, then fires again", () => {
    const v = fakeVoices();
    playSfx(asVoices(v), "error");
    expect(v.bloop.triggerAttackRelease.mock.calls.length).toBe(1);
    // Drag-painting an invalid zone: repeats inside the holdoff are dropped,
    // including one landing mid-second-swoop (0.4-0.6 s in).
    clock.now = 0.5;
    playSfx(asVoices(v), "error");
    expect(v.bloop.triggerAttackRelease.mock.calls.length).toBe(1);
    // Past the holdoff the cue speaks again.
    clock.now = 0.7;
    playSfx(asVoices(v), "error");
    expect(v.bloop.triggerAttackRelease.mock.calls.length).toBe(2);
    // The holdoff never gags OTHER bloop cues.
    clock.now = 0.75;
    playSfx(asVoices(v), "build");
    expect(v.bloop.triggerAttackRelease.mock.calls.length).toBe(3);
  });

  it("a restarted audio clock resets the holdoff instead of gagging the cue", () => {
    const v = fakeVoices();
    clock.now = 500; // a long session on the old context
    playSfx(asVoices(v), "error");
    expect(v.bloop.triggerAttackRelease.mock.calls.length).toBe(1);
    // Engine disposed and rebuilt: the fresh context's clock restarts near 0.
    clock.now = 0.2;
    playSfx(asVoices(v), "error");
    expect(v.bloop.triggerAttackRelease.mock.calls.length).toBe(2);
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
