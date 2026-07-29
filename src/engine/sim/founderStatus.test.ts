import { describe, it, expect } from "vitest";
import { detectFounder, markFounderFromLoadedFile } from "./founderStatus";
import type { SerializedGame } from "../serializedGame";

/**
 * detectFounder is the whole one-shot recognition gate, and it runs on an
 * untrusted, possibly hand-edited or ancient save. These pin its behavior on the
 * awkward `appVersion` shapes so a future refactor can't silently regress the
 * "predates 2.0" read. (`appVersion` is always a bare package.json semver in
 * practice, but the guard must stay safe if that ever changes.)
 */

const raw = (over: Partial<SerializedGame> & Record<string, unknown>): SerializedGame => over as SerializedGame;

describe("detectFounder", () => {
  it("recognizes any real pre-2.0 semver stamp", () => {
    for (const v of ["0.9.9", "1.0.0", "1.23.0", "1.99.1"]) {
      expect(detectFounder(raw({ appVersion: v }))).toBe(true);
    }
  });

  it("does NOT recognize 2.0.0+ (including a prerelease-tagged 2.x)", () => {
    for (const v of ["2.0.0", "2.0.0-beta", "2.4.1", "10.0.0"]) {
      expect(detectFounder(raw({ appVersion: v }))).toBe(false);
    }
  });

  it("treats a non-numeric or absent stamp as non-founding (NaN < 2 is false)", () => {
    expect(detectFounder(raw({ appVersion: "dev" }))).toBe(false);
    expect(detectFounder(raw({ appVersion: "" }))).toBe(false);
    expect(detectFounder(raw({ appVersion: "v1.9.0" }))).toBe(false); // stored value is bare; a 'v' would misparse, so it must not grant
    expect(detectFounder(raw({}))).toBe(false); // no stamp at all (pre-provenance save)
  });

  it("only a string appVersion counts (a forged numeric type does not throw or grant)", () => {
    expect(detectFounder(raw({ appVersion: 1 as unknown as string }))).toBe(false);
    expect(detectFounder(raw({ appVersion: null as unknown as string }))).toBe(false);
  });

  it("honors an explicit founder:true flag regardless of appVersion (persisted 2.0+ re-save)", () => {
    expect(detectFounder(raw({ founder: true, appVersion: "2.4.1" }))).toBe(true);
    expect(detectFounder(raw({ founder: true }))).toBe(true);
  });

  it("only a strict boolean true flag counts (a forged truthy value does not)", () => {
    expect(detectFounder(raw({ founder: 1 as unknown as boolean, appVersion: "2.0.0" }))).toBe(false);
    expect(detectFounder(raw({ founder: "true" as unknown as boolean, appVersion: "2.0.0" }))).toBe(false);
    expect(detectFounder(raw({ founder: false, appVersion: "2.0.0" }))).toBe(false);
  });
});

describe("markFounderFromLoadedFile (oldest-tower recognition at the load boundary)", () => {
  it("promotes an unstamped loaded save (pre-appVersion-stamp = pre-2.0) to Founder", () => {
    const sim = { founder: false };
    markFounderFromLoadedFile(sim, {});
    expect(sim.founder).toBe(true);
  });

  it("does NOT touch a 2.0+ save (appVersion present), so an imported 2.0 tower stays non-Founder", () => {
    const sim = { founder: false };
    markFounderFromLoadedFile(sim, { appVersion: "2.4.1" });
    expect(sim.founder).toBe(false);
  });

  it("is additive: never clears an already-earned flag, stamped or not", () => {
    // The load-time promotion must only ever ADD the flag. The discriminating input
    // is an earned flag arriving with a 2.0+ stamp: written as an assignment
    // (`sim.founder = raw.appVersion === undefined`) instead of a guarded set, that
    // case silently demotes a real founder on every load of their own save, and no
    // other test here catches it (the stamped case above starts from false, where
    // both spellings agree). The stamp-free case is the idempotence half.
    const stamped = { founder: true };
    markFounderFromLoadedFile(stamped, { appVersion: "2.4.1" });
    expect(stamped.founder).toBe(true);

    const unstamped = { founder: true };
    markFounderFromLoadedFile(unstamped, {});
    expect(unstamped.founder).toBe(true);
  });
});
