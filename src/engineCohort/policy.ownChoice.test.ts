import { describe, expect, it } from "vitest";
import { STALE_MS } from "./crashMarker";
import { clearSafety, latchSafety, selectEngine, setPreference, type SelectionEnv } from "./policy";
import type { KeyValueStore } from "./records";

/**
 * The owner's 2026-10-28 call: a player who picks the Rust engine in Settings
 * gets the crash marker and the sticky suppression even before the cohort's
 * fields ship, so a Rust tab that dies hard on load stops booting Rust.
 */

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

let pages = 0;
function env(store: KeyValueStore, over: Partial<SelectionEnv> = {}): SelectionEnv {
  return { store, url: null, drawOn: true, safetyOn: true, stage: 1, share: 10, sha: "aaa1111", pageId: `p${++pages}`, now: 1_000, random: () => 0.5, rustOnlyByChoice: false, ...over };
}

describe("selectEngine: a Settings choice of Rust before the cohort's fields", () => {
  // Production today: the draw runs at stage 0, safety is off, and only a
  // choice boots Rust. The player's own pick still gets the crash check.
  const prod = (s: KeyValueStore, over: Partial<SelectionEnv> = {}) => selectEngine(env(s, { safetyOn: false, stage: 0, share: 0, rustOnlyByChoice: true, ...over }));
  const chose = () => {
    const s = new MemoryStore();
    setPreference(s, "wasm");
    return s;
  };

  it("runs the crash marker, and latches unclean-exit after two page lives died", () => {
    const s = chose();
    expect(prod(s, { now: 1_000 })).toMatchObject({ boot: "wasm", selectedBy: "setting", markerId: expect.any(String) });
    expect(prod(s, { now: 1_000 + STALE_MS + 1 })).toMatchObject({ boot: "wasm" });
    expect(prod(s, { now: 1_000 + 2 * (STALE_MS + 1) })).toMatchObject({ boot: "ts", selectedBy: "safety", crashLoop: true, suppression: { reason: "unclean-exit" } });
  });

  it("keeps a latched fault on TypeScript until the player retries", () => {
    const s = chose();
    latchSafety(s, { reason: "trap-loop", stage: "crash-loop", sha: "aaa1111", now: 5 });
    expect(prod(s)).toMatchObject({ boot: "ts", selectedBy: "safety", suppression: { reason: "trap-loop" } });
    clearSafety(s);
    expect(prod(s)).toMatchObject({ boot: "wasm", selectedBy: "setting" });
  });

  it("leaves a test link and Automatic without the crash check", () => {
    const s = chose();
    latchSafety(s, { reason: "trap-tick", stage: "host", sha: "aaa1111", now: 5 });
    expect(prod(s, { url: "wasm" })).toMatchObject({ boot: "wasm", selectedBy: "url", markerId: null });
    setPreference(s, "auto");
    expect(prod(s).markerId).toBeNull();
  });
});
