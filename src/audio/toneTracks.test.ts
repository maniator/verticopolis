import { describe, it, expect } from "vitest";
import { splashProgram, gameProgram, programFor, type Program } from "./toneTracks";

/**
 * toneTracks is the pure note data for the two composed tracks, transcribed
 * from the owner's recordings. These tests pin the contract the engine relies
 * on: finite MIDI, sane 0..1 velocities, a positive loop length, events inside
 * the loop, and the track-shape rules that matter musically (the splash is a
 * short hook-led theme with the heartbeat pulse; the bed is a long two-chapter
 * loop whose melody is the hum itself and whose tap grid never breaks).
 */

function assertWellFormed(p: Program): void {
  expect(p.events.length).toBeGreaterThan(0);
  expect(p.loopEnd).toBeGreaterThan(0);
  for (const e of p.events) {
    expect(Number.isFinite(e.midi)).toBe(true);
    expect(Number.isFinite(e.t)).toBe(true);
    expect(e.dur).toBeGreaterThan(0);
    expect(e.vel).toBeGreaterThan(0);
    expect(e.vel).toBeLessThanOrEqual(1);
    expect(["arp", "bass", "hook", "thump", "tap"]).toContain(e.voice);
    // Every note starts within the loop (so nothing is scheduled past the seam).
    expect(e.t).toBeGreaterThanOrEqual(0);
    expect(e.t).toBeLessThan(p.loopEnd);
  }
}

describe("toneTracks", () => {
  it("the splash theme is well-formed: hook melody plus the heartbeat pulse", () => {
    const p = splashProgram();
    assertWellFormed(p);
    expect(p.events.some((e) => e.voice === "hook")).toBe(true);
    expect(p.events.some((e) => e.voice === "thump")).toBe(true);
    expect(p.events.some((e) => e.voice === "tap")).toBe(false);
    // A short looping theme (10 bars at 96 BPM), not a two-minute bed.
    expect(p.loopEnd).toBeLessThan(30);
    // The heartbeat is a steady eighth-note grid: strong beats outnumber none,
    // and consecutive thumps sit half a beat apart.
    const thumps = p.events.filter((e) => e.voice === "thump").sort((a, b) => a.t - b.t);
    const eighth = 60 / 96 / 2;
    for (let i = 1; i < thumps.length; i++) {
      expect(thumps[i].t - thumps[i - 1].t).toBeCloseTo(eighth, 5);
    }
  });

  it("the in-game bed is a long two-chapter loop led by the hum, with no arpeggio runs", () => {
    const p = gameProgram();
    assertWellFormed(p);
    // The bed's melody IS the hook voice now (the owner's hum verbatim).
    expect(p.events.some((e) => e.voice === "hook")).toBe(true);
    // A long, evolving loop (~101 s).
    expect(p.loopEnd).toBeGreaterThan(90);
    // The arp synth only carries the held-fifth pad: one event per bar-support
    // call, never a run of short notes. Every arp event spans multiple beats.
    const beat = 60 / 76;
    for (const e of p.events) {
      if (e.voice === "arp") expect(e.dur).toBeGreaterThan(2 * beat);
    }
    // The tap groove runs on one continuous 16-beat grid: every tap lands on
    // a grid position of the cycle, and taps never fully stop for more than
    // one cycle (the seams breathe, they do not cut).
    const taps = p.events.filter((e) => e.voice === "tap").sort((a, b) => a.t - b.t);
    expect(taps.length).toBeGreaterThan(0);
    for (const e of taps) {
      const pos = e.t / (beat / 2);
      expect(Math.abs(pos - Math.round(pos))).toBeLessThan(1e-6);
    }
    // The groove's widest authored gap is 2.5 beats; anything larger means a
    // cycle was dropped and the "never breaks" claim is false.
    for (let i = 1; i < taps.length; i++) {
      expect(taps[i].t - taps[i - 1].t).toBeLessThanOrEqual(3 * beat);
    }
    // The wrap breathes on both sides: the last taps before the seam and the
    // first taps after t=0 are both attenuated below their chapter base.
    expect(taps[0].vel).toBeLessThan(0.4 * (taps[0].t / (8 * beat)) + 0.15);
    expect(taps[taps.length - 1].vel).toBeLessThan(0.3);
  });

  it("every pitched note in both programs ends at or before the loop seam", () => {
    for (const kind of ["splash", "game"] as const) {
      const p = programFor(kind);
      for (const e of p.events) {
        if (e.voice === "hook" || e.voice === "bass" || e.voice === "arp") {
          expect(e.t + e.dur, `${kind} ${e.voice} @${e.t}`).toBeLessThanOrEqual(p.loopEnd + 1e-6);
        }
      }
    }
  });

  it("the bed melody sits under the audition mix and inside the ear-safe range", () => {
    const p = gameProgram();
    for (const e of p.events) {
      if (e.voice === "hook") {
        // Party refinement: bed melody trimmed to 80% of the audition mix,
        // which caps it at 0.7 * 0.8.
        expect(e.vel).toBeLessThanOrEqual(0.7 * 0.8 + 1e-9);
        // The hum lives in its sung register; nothing whistles.
        expect(e.midi).toBeLessThanOrEqual(64);
      }
    }
  });

  it("programFor routes to the two tracks", () => {
    expect(programFor("splash").loopEnd).toBeLessThan(programFor("game").loopEnd);
    expect(programFor("splash").events.some((e) => e.voice === "thump")).toBe(true);
    expect(programFor("game").events.some((e) => e.voice === "tap")).toBe(true);
  });
});
