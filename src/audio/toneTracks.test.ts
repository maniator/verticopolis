import { describe, it, expect } from "vitest";
import { splashProgram, gameProgram, programFor, ARP_CAP_MIDI, type Program } from "./toneTracks";

/**
 * toneTracks is the pure note data for the two composed tracks. These tests pin
 * the contract the engine relies on: finite MIDI, sane 0..1 velocities, a
 * positive loop length, events inside the loop, and the two track-shape rules
 * that matter musically (only the splash carries the hook; the in-game
 * arpeggio never climbs past the ear-safe cap).
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
    expect(["arp", "bass", "hook"]).toContain(e.voice);
    // Every note starts within the loop (so nothing is scheduled past the seam).
    expect(e.t).toBeGreaterThanOrEqual(0);
    expect(e.t).toBeLessThan(p.loopEnd);
  }
}

describe("toneTracks", () => {
  it("the splash theme is well-formed and carries the hook", () => {
    const p = splashProgram();
    assertWellFormed(p);
    expect(p.events.some((e) => e.voice === "hook")).toBe(true);
    // A short looping theme, not a two-minute bed.
    expect(p.loopEnd).toBeLessThan(20);
  });

  it("the in-game bed is well-formed, has no hook, and never climbs past the cap", () => {
    const p = gameProgram();
    assertWellFormed(p);
    expect(p.events.some((e) => e.voice === "hook")).toBe(false);
    // A long, evolving loop (~2 minutes).
    expect(p.loopEnd).toBeGreaterThan(90);
    // The arpeggio is the ear-safety-capped voice; nothing exceeds the cap.
    for (const e of p.events) {
      if (e.voice === "arp") expect(e.midi).toBeLessThanOrEqual(ARP_CAP_MIDI);
    }
  });

  it("programFor routes to the two tracks", () => {
    expect(programFor("splash").events.some((e) => e.voice === "hook")).toBe(true);
    expect(programFor("game").events.some((e) => e.voice === "hook")).toBe(false);
  });
});
