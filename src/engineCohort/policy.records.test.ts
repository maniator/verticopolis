import { describe, expect, it } from "vitest";
import { CRASH_LOOP_PAGES, STALE_MS } from "./crashMarker";
import {
  latchSafety,
  selectEngine,
  setPreference,
  type SelectionEnv,
} from "./policy";
import {
  COHORT_KEY,
  SAFETY_KEY,
  readCohort,
  readSafety,
  versionAfter,
  type KeyValueStore,
} from "./records";

/**
 * The cohort's records across builds (#1289 items 2, 3 and 7), the crash-loop
 * check's scope (#1248 item 1) and a suppression on the drawn arm while only
 * a choice or the draw boots Rust.
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
function env(
  store: KeyValueStore,
  over: Partial<SelectionEnv> = {},
): SelectionEnv {
  return {
    store,
    url: null,
    drawOn: true,
    safetyOn: true,
    stage: 1,
    share: 10,
    sha: "aaa1111",
    pageId: `p${++pages}`,
    now: 1_000,
    random: () => 0.5,
    rustOnlyByChoice: false,
    ...over,
  };
}

const storeWith = (key: string, value: unknown) => {
  const s = new MemoryStore();
  s.setItem(key, JSON.stringify(value));
  return s;
};

describe("a record from a newer build", () => {
  it("keeps the newer cohort record's bucket and never rewrites it", () => {
    const newer = {
      v: 2,
      bucket: 5,
      applied: { stage: 0, arm: "ts", sha: "fff9999" },
      more: true,
    };
    const s = storeWith(COHORT_KEY, newer);
    expect(selectEngine(env(s))).toMatchObject({
      assignedArm: "wasm",
      boot: "wasm",
      transition: "none",
    });
    expect(JSON.parse(s.getItem(COHORT_KEY)!)).toEqual(newer);
  });

  it("reads a newer safety record as a fault on TypeScript and leaves it in place", () => {
    const newer = { v: 2, scope: "device", why: "something new" };
    const s = storeWith(SAFETY_KEY, newer);
    s.setItem(COHORT_KEY, JSON.stringify({ v: 1, bucket: 5 }));
    expect(selectEngine(env(s))).toMatchObject({
      boot: "ts",
      selectedBy: "safety",
      suppression: { scope: "fault", reason: "corrupt" },
    });
    expect(JSON.parse(s.getItem(SAFETY_KEY)!)).toEqual(newer);
    expect(readSafety(s)).toMatchObject({
      ok: true,
      value: { v: 2, scope: "fault" },
    });
  });

  it("still reads an unknown version below this build's as corrupt", () => {
    expect(readCohort(storeWith(COHORT_KEY, { v: 0, bucket: 5 }))).toEqual({
      ok: false,
      why: "corrupt",
    });
    expect(readCohort(storeWith(COHORT_KEY, { v: 1.5, bucket: 5 }))).toEqual({
      ok: false,
      why: "corrupt",
    });
  });
});

describe("two builds open during a deploy", () => {
  it("lets an older build boot on its own arm without rewriting the newer build's enrollment", () => {
    const s = storeWith(COHORT_KEY, { v: 1, bucket: 5 });
    const older = (over: Partial<SelectionEnv> = {}) =>
      env(s, {
        stage: 0,
        share: 0,
        sha: "old0000",
        version: "2.57.0",
        ...over,
      });
    const newer = (over: Partial<SelectionEnv> = {}) =>
      env(s, {
        stage: 1,
        share: 10,
        sha: "new1111",
        version: "2.58.0",
        ...over,
      });
    expect(selectEngine(older())).toMatchObject({
      boot: "ts",
      transition: "none",
    });
    expect(selectEngine(newer())).toMatchObject({
      boot: "wasm",
      transition: "enrolled",
    });
    const enrolled = s.getItem(COHORT_KEY);
    // The old tab reloads: its own arm, no notice, the record untouched.
    expect(selectEngine(older())).toMatchObject({
      boot: "ts",
      transition: "none",
      notice: "none",
    });
    expect(s.getItem(COHORT_KEY)).toBe(enrolled);
    // So the new tab sees no change and repeats no notice.
    expect(selectEngine(newer())).toMatchObject({
      boot: "wasm",
      transition: "none",
      notice: "none",
    });
  });

  it("lets a later version move the enrollment back, as a drop-back does", () => {
    const s = storeWith(COHORT_KEY, {
      v: 1,
      bucket: 5,
      applied: { stage: 1, arm: "wasm", sha: "new1111", version: "2.58.0" },
    });
    expect(
      selectEngine(
        env(s, { stage: 0, share: 0, sha: "drop222", version: "2.59.0" }),
      ),
    ).toMatchObject({ boot: "ts", transition: "withdrawn" });
  });

  it("compares app versions by number, and refuses what does not parse", () => {
    expect(versionAfter("2.10.0", "2.9.9")).toBe(true);
    expect(versionAfter("2.58.0", "2.58.0")).toBe(false);
    expect(versionAfter("2.57.9", "2.58.0")).toBe(false);
    expect(versionAfter("dev", "2.58.0")).toBe(false);
  });
});

describe("a redraw after a corrupt cohort record", () => {
  it("is recorded locally and kept when the enrollment is written", () => {
    const s = new MemoryStore();
    s.setItem(COHORT_KEY, "{not json");
    selectEngine(env(s, { now: 42 }));
    expect(JSON.parse(s.getItem(COHORT_KEY)!)).toMatchObject({
      v: 1,
      redrawn: 42,
      applied: { stage: 1 },
    });
    // A first draw on a clean device is not a redraw.
    const fresh = new MemoryStore();
    selectEngine(env(fresh));
    expect(JSON.parse(fresh.getItem(COHORT_KEY)!).redrawn).toBeUndefined();
  });
});

describe("the crash-loop check's scope (#1248 item 1)", () => {
  it("never runs for a boot that chose TypeScript, so no opted-out boot carries a crash-loop reason", () => {
    const s = storeWith(COHORT_KEY, { v: 1, bucket: 5 });
    const later = (n: number) => 1_000 + n * (STALE_MS + 1);
    // Rust page lives that died while visible leave their marker entries.
    for (let i = 0; i < CRASH_LOOP_PAGES; i++)
      selectEngine(env(s, { now: later(i) }));
    setPreference(s, "ts");
    expect(
      selectEngine(env(s, { now: later(CRASH_LOOP_PAGES) })),
    ).toMatchObject({
      boot: "ts",
      selectedBy: "setting",
      crashLoop: false,
      suppression: null,
    });
    expect(s.getItem(SAFETY_KEY)).toBeNull();
  });
});

describe("a suppression on the drawn arm while only a choice or the draw boots Rust", () => {
  it("keeps the drawn browser on TypeScript and says safety chose it", () => {
    const s = storeWith(COHORT_KEY, { v: 1, bucket: 5 });
    latchSafety(s, {
      reason: "trap-tick",
      stage: "host",
      sha: "aaa1111",
      now: 5,
    });
    expect(selectEngine(env(s, { rustOnlyByChoice: true }))).toMatchObject({
      assignedArm: "wasm",
      boot: "ts",
      selectedBy: "safety",
    });
  });
});
