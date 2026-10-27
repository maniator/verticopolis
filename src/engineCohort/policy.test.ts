import { describe, expect, it } from "vitest";
import { CRASH_LOOP_PAGES, STALE_MS, exitCleanly, heartbeat } from "./crashMarker";
import { clearSafety, latchSafety, safetyScope, selectEngine, setPreference, type SelectionEnv } from "./policy";
import { BOOT_MARKER_KEY, COHORT_KEY, readCohort, readMarker, readSafety, SAFETY_KEY, type KeyValueStore } from "./records";
import { ENGINE_STORAGE_KEY } from "../wasmhost/engineChoice";

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

/** Storage that throws on every call, as a blocked or private-mode store can. */
const throwing: KeyValueStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

const throwQuota = (): never => {
  throw new Error("quota");
};

/** Storage that accepts writes and forgets them, so a read-back fails. */
const forgetful: KeyValueStore = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

/** One boot whose page life exited cleanly: select, then remove its crash
 *  marker entry as a page that was hidden does. */
function boot(e: SelectionEnv) {
  const sel = selectEngine(e);
  if (sel.markerId) exitCleanly(e.store, { id: sel.markerId, sha: e.sha }, e.now);
  return sel;
}

let pages = 0;
function env(store: KeyValueStore | null, over: Partial<SelectionEnv> = {}): SelectionEnv {
  return { store, url: null, drawOn: true, safetyOn: true, stage: 1, share: 10, sha: "aaa1111", pageId: `p${++pages}`, now: 1_000, random: () => 0.5, ...over };
}

const withBucket = (bucket: number, extra: Record<string, unknown> = {}) => {
  const s = new MemoryStore();
  s.setItem(COHORT_KEY, JSON.stringify({ v: 1, bucket, ...extra }));
  return s;
};

describe("selectEngine: the draw", () => {
  it("draws a bucket once and keeps it on every later boot", () => {
    const s = new MemoryStore();
    const first = boot(env(s, { random: () => 0.07 }));
    expect(readCohort(s)).toMatchObject({ ok: true, value: { bucket: 7 } });
    expect(first).toMatchObject({ boot: "wasm", selectedBy: "cohort", assignedArm: "wasm" });
    for (let i = 0; i < 5; i++) {
      const again = boot(env(s, { random: () => 0.99 }));
      expect(again).toMatchObject({ boot: "wasm", assignedArm: "wasm", transition: "none" });
    }
    expect(readCohort(s)).toMatchObject({ ok: true, value: { bucket: 7 } });
  });

  it.each([
    [9, 10, "wasm"],
    [10, 10, "ts"],
    [24, 25, "wasm"],
    [25, 25, "ts"],
    [49, 50, "wasm"],
    [50, 50, "ts"],
    [0, 0, "ts"],
    [99, 50, "ts"],
  ] as const)("bucket %i at a %i%% share is in the %s arm", (bucket, share, arm) => {
    const sel = boot(env(withBucket(bucket), { share }));
    expect(sel.assignedArm).toBe(arm);
    expect(sel.boot).toBe(arm);
  });

  it("maps a draw of almost 1 to bucket 99", () => {
    const s = new MemoryStore();
    boot(env(s, { random: () => 0.9999999 }));
    expect(readCohort(s)).toMatchObject({ ok: true, value: { bucket: 99 } });
  });

  it("keeps a browser whose storage throws on TypeScript, unassigned", () => {
    expect(boot(env(throwing))).toMatchObject({ boot: "ts", assignedArm: "unassigned", selectedBy: "default" });
    expect(boot(env(null))).toMatchObject({ boot: "ts", assignedArm: "unassigned", selectedBy: "default" });
  });

  it("keeps a browser whose storage does not keep the write on TypeScript, unassigned", () => {
    expect(boot(env(forgetful, { random: () => 0 }))).toMatchObject({ boot: "ts", assignedArm: "unassigned" });
  });

  it("redraws a corrupt record once and keeps the new bucket", () => {
    const s = new MemoryStore();
    s.setItem(COHORT_KEY, "{not json");
    boot(env(s, { random: () => 0.42 }));
    expect(readCohort(s)).toMatchObject({ ok: true, value: { bucket: 42 } });
    s.setItem(COHORT_KEY, JSON.stringify({ v: 1, bucket: 140 }));
    boot(env(s, { random: () => 0.03 }));
    expect(readCohort(s)).toMatchObject({ ok: true, value: { bucket: 3 } });
  });

  it("turns the draw off in tooling and wasm-only builds: no bucket, today's behavior", () => {
    const s = new MemoryStore();
    expect(boot(env(s, { drawOn: false }))).toMatchObject({ boot: "ts", assignedArm: "none", selectedBy: "default" });
    expect(s.getItem(COHORT_KEY)).toBeNull();
    s.setItem(ENGINE_STORAGE_KEY, "wasm");
    s.setItem(SAFETY_KEY, JSON.stringify({ v: 1, scope: "fault", reason: "trap-tick", stage: "host", sha: "x", at: 1 }));
    expect(boot(env(s, { drawOn: false }))).toMatchObject({ boot: "wasm", selectedBy: "default" });
    expect(boot(env(s, { drawOn: false, url: "ts" }))).toMatchObject({ boot: "ts", selectedBy: "default" });
  });
});

describe("selectEngine: stage changes", () => {
  it("moves a TypeScript-arm browser into WASM once when the stage rises, and back once on a drop-back", () => {
    const s = withBucket(15);
    expect(boot(env(s, { stage: 1, share: 10 }))).toMatchObject({ boot: "ts", transition: "none" });
    expect(boot(env(s, { stage: 1, share: 10 }))).toMatchObject({ boot: "ts", transition: "none" });
    expect(boot(env(s, { stage: 2, share: 25, sha: "bbb2222" }))).toMatchObject({ boot: "wasm", transition: "enrolled", notice: "enrolled" });
    expect(boot(env(s, { stage: 2, share: 25, sha: "bbb2222" }))).toMatchObject({ boot: "wasm", transition: "none" });
    expect(boot(env(s, { stage: 2, share: 25, sha: "ccc3333" }))).toMatchObject({ boot: "wasm", transition: "none" });
    expect(boot(env(s, { stage: 1, share: 10, sha: "ddd4444" }))).toMatchObject({ boot: "ts", transition: "withdrawn", notice: "withdrawn" });
    expect(boot(env(s, { stage: 1, share: 10, sha: "ddd4444" }))).toMatchObject({ boot: "ts", transition: "none" });
  });

  it("shows no notice where the engine did not change: a Settings choice or a suppression", () => {
    const chose = withBucket(15);
    setPreference(chose, "ts");
    boot(env(chose, { stage: 1, share: 10 }));
    expect(boot(env(chose, { stage: 2, share: 25, sha: "bbb2222" }))).toMatchObject({ boot: "ts", transition: "enrolled", notice: "none" });

    const suppressed = withBucket(15);
    boot(env(suppressed, { stage: 1, share: 10 }));
    latchSafety(suppressed, { reason: "trap-tick", stage: "host", sha: "aaa1111", now: 5 });
    expect(boot(env(suppressed, { stage: 2, share: 25, sha: "bbb2222" }))).toMatchObject({ boot: "ts", transition: "enrolled", notice: "none" });

    const dropped = withBucket(5);
    boot(env(dropped, { stage: 1, share: 10 }));
    latchSafety(dropped, { reason: "trap-tick", stage: "host", sha: "aaa1111", now: 5 });
    expect(boot(env(dropped, { stage: 1, share: 0, sha: "bbb2222" }))).toMatchObject({ boot: "ts", transition: "withdrawn", notice: "none" });
  });

  it("never moves a WASM-arm browser out when the stage rises", () => {
    const s = withBucket(5);
    for (const [stage, share] of [
      [1, 10],
      [2, 25],
      [3, 50],
    ] as const) {
      expect(boot(env(s, { stage, share }))).toMatchObject({ boot: "wasm", assignedArm: "wasm" });
    }
  });

  it("keeps everyone on TypeScript at stage 0, with the bucket kept", () => {
    const s = new MemoryStore();
    expect(boot(env(s, { stage: 0, share: 0, random: () => 0 }))).toMatchObject({ boot: "ts", assignedArm: "ts", selectedBy: "cohort" });
    expect(readCohort(s)).toMatchObject({ ok: true, value: { bucket: 0 } });
  });
});

describe("selectEngine: the player's choice", () => {
  it("follows a stored choice over the cohort, through new builds and stage changes", () => {
    const s = withBucket(3);
    setPreference(s, "ts");
    for (const [stage, share, sha] of [
      [1, 10, "a"],
      [2, 25, "b"],
      [3, 50, "c"],
    ] as const) {
      expect(boot(env(s, { stage, share, sha }))).toMatchObject({ boot: "ts", selectedBy: "setting", assignedArm: "wasm", preference: "ts" });
    }
    expect(s.getItem(ENGINE_STORAGE_KEY)).toBe("ts");
  });

  it("runs Rust for a TypeScript-arm browser that chose it, keeping the arm", () => {
    const s = withBucket(80);
    setPreference(s, "wasm");
    expect(boot(env(s))).toMatchObject({ boot: "wasm", selectedBy: "setting", assignedArm: "ts" });
  });

  it("goes back to the cohort on Automatic", () => {
    const s = withBucket(3);
    setPreference(s, "ts");
    setPreference(s, "auto");
    expect(s.getItem(ENGINE_STORAGE_KEY)).toBeNull();
    expect(boot(env(s))).toMatchObject({ boot: "wasm", selectedBy: "cohort", preference: "auto" });
  });

  it("takes the URL for this visit only, without writing anything the player chose", () => {
    const s = withBucket(80);
    setPreference(s, "ts");
    expect(boot(env(s, { url: "wasm" }))).toMatchObject({ boot: "wasm", selectedBy: "url", assignedArm: "ts" });
    expect(s.getItem(ENGINE_STORAGE_KEY)).toBe("ts");
    expect(boot(env(s))).toMatchObject({ boot: "ts", selectedBy: "setting" });
  });

  it("ignores an unknown URL value", () => {
    expect(boot(env(withBucket(80), { url: "rust" }))).toMatchObject({ boot: "ts", selectedBy: "cohort" });
  });

  it("reports a failed preference write", () => {
    expect(setPreference(throwing, "wasm")).toBe(false);
    expect(setPreference(forgetful, "wasm")).toBe(false);
    expect(setPreference(new MemoryStore(), "wasm")).toBe(true);
  });
});

describe("selectEngine: safety suppression", () => {
  it("keeps a browser on TypeScript on every reload after Rust failed, until the player retries", () => {
    const s = withBucket(3);
    expect(boot(env(s)).boot).toBe("wasm");
    latchSafety(s, { reason: "trap-tick", stage: "host", sha: "aaa1111", now: 5 });
    for (const sha of ["aaa1111", "aaa1111", "bbb2222", "ccc3333"]) {
      const sel = boot(env(s, { sha }));
      expect(sel).toMatchObject({ boot: "ts", requested: "wasm", selectedBy: "safety", assignedArm: "wasm" });
      expect(sel.suppression).toMatchObject({ scope: "fault", reason: "trap-tick" });
    }
    clearSafety(s);
    expect(boot(env(s))).toMatchObject({ boot: "wasm", selectedBy: "cohort", suppression: null });
  });

  it("suppresses a Settings choice of Rust too, and keeps the choice", () => {
    const s = withBucket(80);
    setPreference(s, "wasm");
    latchSafety(s, { reason: "trap-command", stage: "host", sha: "aaa1111", now: 5 });
    expect(boot(env(s))).toMatchObject({ boot: "ts", requested: "wasm", selectedBy: "safety", preference: "wasm" });
    expect(s.getItem(ENGINE_STORAGE_KEY)).toBe("wasm");
  });

  it("lets the URL bypass a suppression for a test visit", () => {
    const s = withBucket(3);
    latchSafety(s, { reason: "trap-tick", stage: "host", sha: "aaa1111", now: 5 });
    expect(boot(env(s, { url: "wasm" }))).toMatchObject({ boot: "wasm", selectedBy: "url" });
  });

  it("does not report a suppression for a player who chose TypeScript", () => {
    const s = withBucket(3);
    setPreference(s, "ts");
    latchSafety(s, { reason: "trap-tick", stage: "host", sha: "aaa1111", now: 5 });
    expect(boot(env(s))).toMatchObject({ boot: "ts", selectedBy: "setting", suppression: null });
  });

  it("keeps a package that did not load suppressed for that build only, then tries once on the next", () => {
    const s = withBucket(3);
    latchSafety(s, { reason: "boot-timeout", stage: "load", sha: "aaa1111", now: 5 });
    expect(boot(env(s))).toMatchObject({ boot: "ts", selectedBy: "safety" });
    expect(boot(env(s))).toMatchObject({ boot: "ts", selectedBy: "safety" });
    expect(boot(env(s, { sha: "bbb2222" }))).toMatchObject({ boot: "wasm", selectedBy: "cohort" });
    expect(s.getItem(SAFETY_KEY)).toBeNull();
    latchSafety(s, { reason: "package-mismatch", stage: "load", sha: "bbb2222", now: 6 });
    expect(boot(env(s, { sha: "bbb2222" }))).toMatchObject({ boot: "ts", selectedBy: "safety" });
  });

  it("scopes by the stage that failed: the load is the build, anything later the engine", () => {
    expect(safetyScope("load")).toBe("build");
    for (const st of ["start", "host", "adopt", "undo", "none", "crash-loop"] as const) expect(safetyScope(st)).toBe("fault");
  });

  it("treats a boot-error while the package loads as build-scoped, and one from the host as a fault", () => {
    const s = withBucket(3);
    latchSafety(s, { reason: "boot-error", stage: "load", sha: "aaa1111", now: 5 });
    expect(boot(env(s, { sha: "bbb2222" }))).toMatchObject({ boot: "wasm", selectedBy: "cohort" });
    latchSafety(s, { reason: "boot-error", stage: "start", sha: "bbb2222", now: 6 });
    expect(boot(env(s, { sha: "ccc3333" }))).toMatchObject({ boot: "ts", selectedBy: "safety", suppression: { scope: "fault", stage: "start" } });
  });

  it("treats a corrupt safety record as a fault suppression", () => {
    const s = withBucket(3);
    s.setItem(SAFETY_KEY, "garbage");
    expect(boot(env(s))).toMatchObject({ boot: "ts", selectedBy: "safety", suppression: { scope: "fault", reason: "corrupt" } });
  });

  it("never changes the bucket or the arm", () => {
    const s = withBucket(3);
    latchSafety(s, { reason: "trap-tick", stage: "host", sha: "aaa1111", now: 5 });
    boot(env(s));
    expect(readCohort(s)).toMatchObject({ ok: true, value: { bucket: 3 } });
  });

  it("keeps the engine hash it latched on", () => {
    const s = new MemoryStore();
    latchSafety(s, { reason: "trap-tick", stage: "host", sha: "aaa1111", engine: "f".repeat(64), now: 5 });
    expect(readSafety(s)).toMatchObject({ ok: true, value: { engine: "f".repeat(64) } });
  });
});

describe("selectEngine: crash loops", () => {
  const later = (n: number) => 1_000 + n * (STALE_MS + 1);
  /** A page life that requested Rust and died while visible: its entry stays. */
  const crash = (s: KeyValueStore, n: number, sha = "aaa1111") => selectEngine(env(s, { sha, now: later(n) }));

  it("latches unclean-exit once two page lives of one build died while visible", () => {
    const s = withBucket(3);
    for (let i = 0; i < CRASH_LOOP_PAGES; i++) expect(crash(s, i)).toMatchObject({ boot: "wasm", crashLoop: false });
    const looped = crash(s, CRASH_LOOP_PAGES);
    expect(looped).toMatchObject({ boot: "ts", selectedBy: "safety", crashLoop: true, markerId: null, suppression: { reason: "unclean-exit", stage: "crash-loop", scope: "fault" } });
    expect(s.getItem(BOOT_MARKER_KEY)).toBeNull();
    expect(crash(s, CRASH_LOOP_PAGES + 1, "bbb2222")).toMatchObject({ boot: "ts", selectedBy: "safety" });
  });

  it("never counts another open window whose heartbeat is fresh", () => {
    const s = withBucket(3);
    const a = selectEngine(env(s, { now: later(0) }));
    const b = selectEngine(env(s, { now: later(0) + 1 }));
    expect([a.boot, b.boot]).toEqual(["wasm", "wasm"]);
    for (let n = 1; n < 5; n++) {
      heartbeat(s, { id: a.markerId!, sha: "aaa1111" }, later(n));
      heartbeat(s, { id: b.markerId!, sha: "aaa1111" }, later(n));
      expect(boot(env(s, { now: later(n) + 2 })).crashLoop).toBe(false);
    }
    expect(readMarker(s)).toMatchObject({ ok: true, value: { entries: [{ id: a.markerId }, { id: b.markerId }] } });
  });

  it("keeps a window's entry when another window exits", () => {
    const s = withBucket(3);
    const a = selectEngine(env(s));
    boot(env(s));
    expect(readMarker(s)).toMatchObject({ ok: true, value: { entries: [{ id: a.markerId }] } });
  });

  it("starts a new count when a page life exits cleanly", () => {
    const s = withBucket(3);
    crash(s, 0);
    for (let n = 1; n < 6; n++) {
      expect(boot(env(s, { now: later(n) })).crashLoop).toBe(false);
      crash(s, n);
      expect(readMarker(s)).toMatchObject({ ok: true, value: { entries: [{}] } });
    }
  });

  it("drops another build's entries", () => {
    const s = withBucket(3);
    crash(s, 0);
    crash(s, 1);
    expect(crash(s, 2, "bbb2222")).toMatchObject({ boot: "wasm", crashLoop: false });
    expect(readMarker(s)).toMatchObject({ ok: true, value: { entries: [{ sha: "bbb2222" }] } });
  });

  it("does not count a TypeScript boot or a URL visit", () => {
    const s = withBucket(80);
    for (let i = 0; i < 4; i++) selectEngine(env(s, { now: later(i) }));
    expect(s.getItem(BOOT_MARKER_KEY)).toBeNull();
    for (let i = 0; i < 4; i++) selectEngine(env(s, { url: "wasm", now: later(i) }));
    expect(s.getItem(BOOT_MARKER_KEY)).toBeNull();
  });

  it("latches on the second stale entry and never on the first", () => {
    const s = withBucket(3);
    crash(s, 0);
    expect(crash(s, 1)).toMatchObject({ boot: "wasm", crashLoop: false });
    expect(crash(s, 2)).toMatchObject({ boot: "ts", crashLoop: true });
  });

  it("counts an entry as stale only past STALE_MS, and never one beating in the future", () => {
    const s = withBucket(3);
    s.setItem(BOOT_MARKER_KEY, JSON.stringify({ v: 1, entries: [
      { id: "x", sha: "aaa1111", beat: 1_000 - 25_000 },
      { id: "y", sha: "aaa1111", beat: 1_000 - STALE_MS },
      { id: "z", sha: "aaa1111", beat: 1_000 + 60_000 },
    ] }));
    expect(selectEngine(env(s, { now: 1_000 }))).toMatchObject({ boot: "wasm", crashLoop: false });
  });

  it("forgets the crash marker on the player's retry", () => {
    const s = withBucket(3);
    crash(s, 0);
    expect(s.getItem(BOOT_MARKER_KEY)).not.toBeNull();
    clearSafety(s);
    expect(s.getItem(BOOT_MARKER_KEY)).toBeNull();
  });

  it("reads a corrupt marker as empty", () => {
    const s = withBucket(3);
    s.setItem(BOOT_MARKER_KEY, "garbage");
    expect(crash(s, 0)).toMatchObject({ boot: "wasm", crashLoop: false });
    expect(readMarker(s)).toMatchObject({ ok: true, value: { entries: [{}] } });
  });
});

describe("selectEngine: with the safety path off", () => {
  it("runs a stored Rust choice with no suppression and no crash marker, as main does", () => {
    const s = withBucket(80);
    setPreference(s, "wasm");
    latchSafety(s, { reason: "trap-tick", stage: "host", sha: "aaa1111", now: 5 });
    for (let i = 0; i < 4; i++) {
      const sel = selectEngine(env(s, { safetyOn: false, now: 1_000 + i * (STALE_MS + 1) }));
      expect(sel).toMatchObject({ boot: "wasm", requested: "wasm", selectedBy: "setting", suppression: null, crashLoop: false, markerId: null });
    }
    expect(s.getItem(BOOT_MARKER_KEY)).toBeNull();
  });

  it("still runs Rust where the marker could not be written", () => {
    const s = withBucket(3);
    setPreference(s, "wasm");
    const noMarker: KeyValueStore = { getItem: (k) => s.getItem(k), setItem: (k, v) => (k === BOOT_MARKER_KEY ? throwQuota() : s.setItem(k, v)), removeItem: (k) => s.removeItem(k) };
    expect(selectEngine(env(noMarker, { safetyOn: false }))).toMatchObject({ boot: "wasm", markerId: null });
  });

  it("shows a withdrawal notice to a TypeScript boot whatever the safety record says", () => {
    const s = withBucket(5);
    boot(env(s, { stage: 1, share: 10 }));
    latchSafety(s, { reason: "trap-tick", stage: "host", sha: "aaa1111", now: 5 });
    expect(selectEngine(env(s, { safetyOn: false, stage: 0, share: 0, sha: "bbb2222" }))).toMatchObject({ boot: "ts", notice: "withdrawn" });
  });
});

describe("selectEngine: records that fail", () => {
  it("rewrites a corrupt safety record as a fault, so Settings can show it and retry clears it", () => {
    const s = withBucket(3);
    s.setItem(SAFETY_KEY, "garbage");
    boot(env(s));
    expect(readSafety(s)).toMatchObject({ ok: true, value: { scope: "fault", reason: "corrupt" } });
    clearSafety(s);
    expect(boot(env(s)).boot).toBe("wasm");
  });

  it("keeps a held fault when a later failure is build-scoped", () => {
    const s = withBucket(3);
    latchSafety(s, { reason: "trap-tick", stage: "host", sha: "aaa1111", now: 5 });
    expect(latchSafety(s, { reason: "boot-timeout", stage: "load", sha: "aaa1111", now: 6 })).toMatchObject({ scope: "fault", reason: "trap-tick" });
    expect(boot(env(s, { sha: "bbb2222" }))).toMatchObject({ boot: "ts", selectedBy: "safety" });
  });

  it("leaves the enrollment alone on a URL visit, so the next ordinary boot still tells the player", () => {
    const s = withBucket(15);
    boot(env(s, { stage: 1, share: 10 }));
    expect(boot(env(s, { stage: 2, share: 25, sha: "bbb2222", url: "ts" }))).toMatchObject({ transition: "none", notice: "none" });
    expect(boot(env(s, { stage: 2, share: 25, sha: "bbb2222" }))).toMatchObject({ boot: "wasm", notice: "enrolled" });
  });

  it("reports no stage change that storage did not keep, so the notice cannot repeat", () => {
    const s = withBucket(15);
    boot(env(s, { stage: 1, share: 10 }));
    const full: KeyValueStore = { getItem: (k) => s.getItem(k), setItem: () => throwQuota(), removeItem: (k) => s.removeItem(k) };
    expect(selectEngine(env(full, { stage: 2, share: 25, sha: "bbb2222" }))).toMatchObject({ transition: "none", notice: "none" });
  });

  it("keeps the bucket when the enrollment beside it does not parse", () => {
    const s = withBucket(7, { applied: { stage: "x" } });
    boot(env(s, { random: () => 0.99 }));
    expect(readCohort(s)).toMatchObject({ ok: true, value: { bucket: 7 } });
  });

  it("starts no Rust where the crash marker cannot be written, keeping the rule that chose", () => {
    const s = withBucket(3);
    s.setItem(ENGINE_STORAGE_KEY, "wasm");
    const noMarker: KeyValueStore = { getItem: (k) => s.getItem(k), setItem: (k, v) => (k === BOOT_MARKER_KEY ? throwQuota() : s.setItem(k, v)), removeItem: (k) => s.removeItem(k) };
    expect(selectEngine(env(noMarker))).toMatchObject({ boot: "ts", requested: "wasm", selectedBy: "setting", markerId: null, markerBlocked: true });
  });
});
