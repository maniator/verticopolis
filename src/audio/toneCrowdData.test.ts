import { describe, it, expect } from "vitest";
import {
  CROWD_SCENES,
  resolveCrowdScene,
  hourActivity,
  computeCalmMask,
  segmentIsCalm,
  whoopRate,
  partyHookEvents,
  trainEvent,
  PARTY_BPM,
  PITCH_MIN_SEMI,
  PITCH_MAX_SEMI,
  LAUGH_REGIONS,
  type CrowdSceneKey,
} from "./toneCrowdData";
import { splashProgram } from "./toneTracks";

/**
 * The crowd layer's pure data and math. These tests pin the audition-derived
 * contracts: warm cutoffs only (nothing bright enough to hiss), voices shift
 * down only, the clock curves gate the right hours, the calm mask rejects
 * squeals and shouts, and the party really plays the game's own hook.
 */

describe("CROWD_SCENES specs", () => {
  it("keeps every cutoff warm and every gain low (the no-static rule)", () => {
    for (const [key, spec] of Object.entries(CROWD_SCENES)) {
      if (spec.murmur) {
        expect(spec.murmur.muffleHz, key).toBeLessThanOrEqual(1100);
        expect(spec.murmur.maxTalkers, key).toBeGreaterThanOrEqual(1);
        expect(spec.murmur.maxTalkers, key).toBeLessThanOrEqual(6);
        expect(spec.murmur.gain, key).toBeLessThanOrEqual(0.55);
      }
      for (const el of spec.elements) {
        // `freqMax` is a NOISE filter cutoff for `burst` and a TONE pitch for
        // `ping`/`thud`. The no-static rule is about noise: hold bursts to the
        // audition's steep-filter ceiling (1800 Hz), while pitched tones may
        // sit a little higher (a bird chirp, a bright clink) without hissing.
        if (el.kind === "burst") {
          expect(el.freqMax, key).toBeLessThanOrEqual(1800);
        } else {
          expect(el.freqMax, key).toBeLessThanOrEqual(1900);
        }
        expect(el.gainMax, key).toBeLessThanOrEqual(0.25);
        expect(el.rateMin, key).toBeGreaterThan(0);
        expect(el.dur, key).toBeGreaterThan(0);
      }
    }
  });

  it("voices only ever shift down", () => {
    expect(PITCH_MAX_SEMI).toBeLessThan(0);
    expect(PITCH_MIN_SEMI).toBeLessThan(PITCH_MAX_SEMI);
  });
});

describe("crowd floors are city spaces only", () => {
  it("floors exactly the street and the metro platform, never a tower room", () => {
    const floored = Object.entries(CROWD_SCENES)
      .filter(([, s]) => s.crowdFloor !== undefined)
      .map(([k]) => k)
      .sort();
    // The floor is the deliberate honest-rooms exception: the city's own
    // spaces have people and traffic regardless of what the tower tracks.
    // Any tower room gaining a floor would break "empty means silent" indoors,
    // so this pins the set closed.
    expect(floored).toEqual(["metro", "outside"]);
    for (const key of floored) {
      const floor = CROWD_SCENES[key as CrowdSceneKey].crowdFloor!;
      expect(floor, key).toBeGreaterThan(0);
      expect(floor, key).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("resolveCrowdScene", () => {
  it("splits the shared scenes on the dominant kind", () => {
    expect(resolveCrowdScene("food", "restaurant")).toBe("restaurant");
    expect(resolveCrowdScene("food", "fastFood")).toBe("fastFood");
    expect(resolveCrowdScene("cinema", "cinema")).toBe("cinema");
    expect(resolveCrowdScene("cinema", "partyHall")).toBe("partyHall");
  });

  it("maps the plain scenes and silences the intentional gaps", () => {
    expect(resolveCrowdScene("lobby", "lobby")).toBe("lobby");
    expect(resolveCrowdScene("residential", "condo")).toBe("condo");
    expect(resolveCrowdScene("metro", "empty")).toBe("metro");
    expect(resolveCrowdScene("outside", "outside")).toBe("outside");
    expect(resolveCrowdScene("overview", "empty")).toBeNull();
    expect(resolveCrowdScene("quiet", "empty")).toBeNull();
    expect(resolveCrowdScene("service", "security")).toBeNull();
  });
});

describe("hourActivity", () => {
  it("offices work the workday and sleep at night", () => {
    expect(hourActivity("workday", 3)).toBe(0);
    expect(hourActivity("workday", 8.5)).toBeCloseTo(0.5);
    expect(hourActivity("workday", 12)).toBe(1);
    expect(hourActivity("workday", 18)).toBeCloseTo(0.5);
    expect(hourActivity("workday", 21)).toBe(0);
  });

  it("condos bustle mornings and evenings, hush at midday, sleep at night", () => {
    expect(hourActivity("condoDay", 8)).toBe(1);
    expect(hourActivity("condoDay", 12)).toBeCloseTo(0.2);
    expect(hourActivity("condoDay", 16)).toBeCloseTo(0.6);
    expect(hourActivity("condoDay", 19)).toBe(1);
    expect(hourActivity("condoDay", 22)).toBeCloseTo(0.5);
    expect(hourActivity("condoDay", 2)).toBe(0);
  });

  it("always and attendance gates leave the clock out of it", () => {
    expect(hourActivity("always", 3)).toBe(1);
    expect(hourActivity("attendance", 3)).toBe(1);
  });
});

describe("calm mask", () => {
  const rate = 22050;
  const tone = (freq: number, seconds: number, amp: number): Float32Array => {
    const out = new Float32Array(Math.floor(seconds * rate));
    for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
    return out;
  };
  const concat = (...parts: Float32Array[]): Float32Array => {
    const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };

  it("accepts warm speech-band signal and rejects squeals and shouts", () => {
    const samples = concat(
      tone(300, 1, 0.2), // calm: warm and moderate
      tone(3000, 1, 0.2), // squeal: zero crossings far above the ceiling
      tone(300, 1, 0.5), // shout: too loud
    );
    const mask = computeCalmMask(samples, rate);
    expect(segmentIsCalm(mask, rate, 0.1, 0.7)).toBe(true);
    expect(segmentIsCalm(mask, rate, 1.1, 0.7)).toBe(false);
    expect(segmentIsCalm(mask, rate, 2.1, 0.7)).toBe(false);
  });

  it("treats silence as calm (a talker sampling silence just plays nothing)", () => {
    const mask = computeCalmMask(new Float32Array(rate), rate);
    expect(segmentIsCalm(mask, rate, 0, 0.9)).toBe(true);
  });
});

describe("whoopRate", () => {
  it("accelerates upward from below unity to well above", () => {
    expect(whoopRate(0)).toBeCloseTo(0.9);
    expect(whoopRate(1)).toBeCloseTo(1.9);
    let prev = whoopRate(0);
    for (let p = 0.1; p <= 1; p += 0.1) {
      const r = whoopRate(p);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });
});

describe("party remix", () => {
  it("runs at the approved 124 BPM and the hook fits inside the 4-bar loop", () => {
    expect(PARTY_BPM).toBe(124);
    const loopEnd = 16 * (60 / PARTY_BPM);
    for (const e of partyHookEvents()) {
      expect(e.t).toBeGreaterThanOrEqual(0);
      expect(e.t).toBeLessThan(loopEnd); // an event past loopEnd never plays
    }
  });

  it("quotes the splash hook's first phrase, re-timed to the party tempo", () => {
    const party = partyHookEvents();
    // Pinned, not re-derived: the Terrace tune's first phrase is 16 notes and
    // opens D4 E4 D4 E4 (the owner's hummed rise, up an octave). A silent
    // tempo or cutoff drift in the production constants must fail here.
    expect(party.length).toBe(16);
    expect(party.slice(0, 4).map((e) => e.midi)).toEqual([62, 64, 62, 64]);
    const loopEnd = 16 * (60 / PARTY_BPM);
    for (const e of party) {
      expect(e.t).toBeGreaterThanOrEqual(0);
      // The quote is clipped so no tail rings across the party loop restart.
      expect(e.t + e.dur).toBeLessThanOrEqual(loopEnd + 1e-6);
    }
    // Still the game's own tune: every quoted note exists in the splash hook.
    const hookMidis = new Set(
      splashProgram()
        .events.filter((e) => e.voice === "hook")
        .map((e) => e.midi),
    );
    for (const e of party) expect(hookMidis.has(e.midi)).toBe(true);
  });
});

describe("train event", () => {
  it("arrives, brakes, opens doors, and departs with a quickening rhythm", () => {
    const steps = trainEvent();
    expect(steps[0].kind).toBe("rumbleIn");
    expect(steps.filter((s) => s.kind === "door").length).toBe(2);
    expect(steps.some((s) => s.kind === "brake")).toBe(true);
    const departing = steps.filter((s) => s.kind === "daDum" && s.at >= 10.2);
    expect(departing.length).toBeGreaterThan(3);
    // Departure pairs speed up and fade: gaps shrink, gains fall.
    for (let i = 2; i < departing.length; i++) {
      const gapA = departing[i - 1].at - departing[i - 2].at;
      const gapB = departing[i].at - departing[i - 1].at;
      expect(gapB).toBeLessThanOrEqual(gapA + 1e-9);
      expect(departing[i].gain).toBeLessThan(departing[i - 1].gain);
    }
  });
});

describe("laugh seed regions", () => {
  it("stay inside the concatenated seed and in order", () => {
    for (const [a, b] of LAUGH_REGIONS) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThan(a);
      expect(b).toBeLessThanOrEqual(2.6);
    }
  });
});

describe("every scene key resolves to a spec", () => {
  it("has a CROWD_SCENES entry for each key the resolver can return", () => {
    const keys: CrowdSceneKey[] = [
      "lobby", "office", "condo", "hotel", "restaurant", "fastFood",
      "shop", "cinema", "partyHall", "metro", "outside",
    ];
    for (const k of keys) expect(CROWD_SCENES[k], k).toBeDefined();
  });
});
