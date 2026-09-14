import { describe, expect, it } from "vitest";
import { createSessionThrottle } from "./analyticsThrottle";

describe("createSessionThrottle", () => {
  it("lets a fingerprint through once and refuses the repeat", () => {
    const t = createSessionThrottle(10);
    expect(t.allow("a")).toBe(true);
    expect(t.allow("a")).toBe(false);
    expect(t.allow("b")).toBe(true);
    expect(t.count).toBe(2);
  });

  it("stops at the cap even for fingerprints it has never seen", () => {
    const t = createSessionThrottle(3);
    for (let i = 0; i < 3; i++) expect(t.allow(`fp-${i}`)).toBe(true);
    expect(t.allow("fp-3")).toBe(false);
    expect(t.count).toBe(3);
  });

  it("reports exhaustion only once the cap is spent", () => {
    const t = createSessionThrottle(2);
    expect(t.exhausted).toBe(false);
    t.allow("a");
    expect(t.exhausted).toBe(false);
    t.allow("b");
    expect(t.exhausted).toBe(true);
    // A refused call does not consume a slot, so the count stays at the cap.
    expect(t.allow("c")).toBe(false);
    expect(t.count).toBe(2);
  });

  it("reset re-opens the cap and forgets the fingerprints", () => {
    const t = createSessionThrottle(1);
    expect(t.allow("a")).toBe(true);
    expect(t.allow("a")).toBe(false);
    t.reset();
    expect(t.count).toBe(0);
    expect(t.exhausted).toBe(false);
    expect(t.allow("a")).toBe(true);
  });

  it("keeps each instance's budget to itself", () => {
    const crashes = createSessionThrottle(1);
    const errors = createSessionThrottle(1);
    expect(crashes.allow("x")).toBe(true);
    // A flood on one path must not spend the other path's slot.
    expect(errors.allow("x")).toBe(true);
  });
});
