import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  desktopAnalyticsAllowed,
  desktopConsentState,
  heldEventCount,
  holdWhilePending,
  resetDesktopConsentForTests,
  setDesktopConsent,
  toggleDesktopAnalytics,
} from "./desktopConsent";

const CONSENT_SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "./desktopConsent.ts");

/** The key the consent value rides. Spelled out here rather than imported, so a
 *  rename has to be a deliberate edit in two places. */
const CONSENT_KEY = "vc.desktop-analytics";

describe("desktop consent state", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDesktopConsentForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetDesktopConsentForTests();
    localStorage.clear();
  });

  it("defaults to pending on a first run", () => {
    expect(desktopConsentState()).toBe("pending");
  });

  it("persists the answer, and a fresh read (a relaunch) sees it", () => {
    setDesktopConsent("granted");
    expect(localStorage.getItem(CONSENT_KEY)).toBe("granted");
    // Clearing only the MEMO is what a relaunch looks like: storage survives.
    resetMemoKeepingStorage();
    expect(desktopConsentState()).toBe("granted");
  });

  it("reads a corrupt or unknown stored value as pending, so it asks again", () => {
    localStorage.setItem(CONSENT_KEY, "yes-please");
    resetMemoKeepingStorage();
    expect(desktopConsentState()).toBe("pending");
  });

  it("reads as pending when storage throws, and never lets the throw escape", () => {
    vi.stubGlobal("localStorage", blockedStorage());
    expect(() => desktopConsentState()).not.toThrow();
    expect(desktopConsentState()).toBe("pending");
  });

  it("keeps the answer live for the session when the write is blocked", () => {
    vi.stubGlobal("localStorage", blockedStorage());
    expect(() => setDesktopConsent("granted")).not.toThrow();
    expect(desktopConsentState()).toBe("granted");
  });
});

describe("desktopAnalyticsAllowed", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDesktopConsentForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetDesktopConsentForTests();
    localStorage.clear();
  });

  it("follows the consent state on desktop, in BOTH directions", () => {
    expect(desktopAnalyticsAllowed("desktop")).toBe(false); // pending
    setDesktopConsent("granted");
    expect(desktopAnalyticsAllowed("desktop")).toBe(true);
    setDesktopConsent("declined");
    expect(desktopAnalyticsAllowed("desktop")).toBe(false);
    setDesktopConsent("granted");
    expect(desktopAnalyticsAllowed("desktop")).toBe(true);
  });

  it("is false for every other mode whatever the stored value says", () => {
    // The iOS Capacitor shell in particular: a consent value must not be a way to
    // open a surface the ruling deliberately left dark.
    setDesktopConsent("granted");
    for (const mode of ["native", "production", "development", "test", "staging"]) {
      expect(desktopAnalyticsAllowed(mode), `${mode} must not be opened by a consent value`).toBe(false);
    }
  });

  it("does not touch storage at all for a non-desktop mode", () => {
    // The web build must mint no key and read none: the consent value is a
    // desktop concept and a browser profile should never grow one.
    const getItem = vi.fn(() => null);
    vi.stubGlobal("localStorage", { getItem, setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() });
    expect(desktopAnalyticsAllowed("production")).toBe(false);
    expect(getItem).not.toHaveBeenCalled();
    // ...and the observer really would have seen a read, so the assertion above
    // is not passing because the stub is unreachable.
    expect(desktopAnalyticsAllowed("desktop")).toBe(false);
    expect(getItem, "the desktop path must read, or the check above proves nothing").toHaveBeenCalled();
  });
});

describe("the pending hold (memory only, bounded, ordered)", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDesktopConsentForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetDesktopConsentForTests();
    localStorage.clear();
  });

  it("holds while pending and flushes in emission order on grant", () => {
    const order: string[] = [];
    for (const name of ["boot", "game_started", "first_build"]) {
      holdWhilePending(() => order.push(name), "desktop");
    }
    expect(order, "nothing may be sent while the answer is outstanding").toEqual([]);
    expect(heldEventCount()).toBe(3);
    setDesktopConsent("granted");
    expect(order).toEqual(["boot", "game_started", "first_build"]);
    expect(heldEventCount()).toBe(0);
  });

  it("discards everything held on decline, sending none of it", () => {
    const sent: string[] = [];
    holdWhilePending(() => sent.push("boot"), "desktop");
    holdWhilePending(() => sent.push("game_started"), "desktop");
    setDesktopConsent("declined");
    expect(sent).toEqual([]);
    expect(heldEventCount()).toBe(0);
  });

  it("caps the queue at 32 and drops the OLDEST rather than growing", () => {
    for (let i = 0; i < 32; i++) holdWhilePending(() => {}, "desktop");
    expect(heldEventCount()).toBe(32);
    // The 33rd: the queue stays at 32 and the first one is gone.
    const flushed: number[] = [];
    resetDesktopConsentForTests();
    for (let i = 0; i < 33; i++) holdWhilePending(() => flushed.push(i), "desktop");
    expect(heldEventCount(), "the cap is a hard bound, not a target").toBe(32);
    setDesktopConsent("granted");
    expect(flushed).toHaveLength(32);
    expect(flushed[0], "the OLDEST event is the one dropped").toBe(1);
    expect(flushed[31]).toBe(32);
  });

  it("stops the flush the moment a held event turns the answer around", () => {
    // A held thunk runs arbitrary caller code, and that code can reach the
    // Settings switch. A decline raised part way through the flush must stop the
    // rest of the queue, not merely be recorded while it keeps sending behind
    // the player's back.
    const sent: string[] = [];
    holdWhilePending(() => {
      sent.push("boot");
      setDesktopConsent("declined");
    }, "desktop");
    holdWhilePending(() => sent.push("game_started"), "desktop");
    holdWhilePending(() => sent.push("first_build"), "desktop");
    setDesktopConsent("granted");
    expect(sent, "nothing may go out after the decline was recorded").toEqual(["boot"]);
    expect(desktopConsentState()).toBe("declined");
    expect(heldEventCount()).toBe(0);
  });

  it("holds nothing on any mode but desktop, so the web build is untouched", () => {
    for (const mode of ["production", "development", "test", "native"]) {
      holdWhilePending(() => {}, mode);
    }
    expect(heldEventCount()).toBe(0);
  });

  it("holds nothing once the player has answered, either way", () => {
    setDesktopConsent("granted");
    holdWhilePending(() => {}, "desktop");
    expect(heldEventCount()).toBe(0);
    resetDesktopConsentForTests();
    setDesktopConsent("declined");
    holdWhilePending(() => {}, "desktop");
    expect(heldEventCount()).toBe(0);
  });

  it("writes NOTHING to any storage API while holding, and drops a failed send", () => {
    // AC10: an offline or otherwise failed send leaves no residue anywhere. A
    // disk or localStorage queue would turn a session-scoped anonymous stream
    // into stored behavioral data, which is the line this whole design holds.
    const before = snapshotStorage();
    holdWhilePending(() => {
      throw new Error("offline");
    }, "desktop");
    holdWhilePending(() => {}, "desktop");
    expect(snapshotStorage(), "a held event must live only in memory").toEqual(before);
    // Granting sends them; the throwing one is dropped rather than retried or
    // written down, and it does not strand the queue behind it.
    let secondRan = false;
    resetDesktopConsentForTests();
    holdWhilePending(() => {
      throw new Error("offline");
    }, "desktop");
    holdWhilePending(() => {
      secondRan = true;
    }, "desktop");
    expect(() => setDesktopConsent("granted")).not.toThrow();
    expect(secondRan, "one failed send must not strand the rest").toBe(true);
    expect(heldEventCount(), "a failed send is dropped, never re-queued").toBe(0);
    // The only storage entry this whole flow may have created is the consent
    // answer itself, which AC11 requires to persist.
    expect(storageKeys().filter((k) => k !== CONSENT_KEY)).toEqual(
      Object.keys(before).filter((k) => k !== CONSENT_KEY),
    );
  });
});

describe("toggleDesktopAnalytics", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDesktopConsentForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetDesktopConsentForTests();
    localStorage.clear();
  });

  it("flips both ways and returns the new on-state", () => {
    expect(toggleDesktopAnalytics()).toBe(true); // pending reads as off, so it grants
    expect(desktopConsentState()).toBe("granted");
    expect(toggleDesktopAnalytics()).toBe(false);
    expect(desktopConsentState()).toBe("declined");
    expect(toggleDesktopAnalytics()).toBe(true);
    expect(desktopConsentState()).toBe("granted");
  });

  it("takes effect on the very next gate call, with no reload", () => {
    setDesktopConsent("granted");
    expect(desktopAnalyticsAllowed("desktop")).toBe(true);
    toggleDesktopAnalytics();
    expect(desktopAnalyticsAllowed("desktop"), "turning it off must bite immediately").toBe(false);
  });
});

describe("the live build-mode reads, checked in the source", () => {
  // Asserted against the SOURCE TEXT, and that is the point: under vitest
  // `import.meta.env.MODE` is "test", so every behavioral assertion above passes
  // the mode in by hand. The live defaults could be replaced by constants and
  // stay green here while no desktop build ever held or reported anything. The
  // same technique platform.test.ts and analyticsEnrichment.test.ts use.
  const source = readFileSync(CONSENT_SOURCE, "utf8");

  it("the source was actually read", () => {
    expect(source, "the source file could not be read, so these tests prove nothing").toContain("holdWhilePending");
  });

  it("IS_DESKTOP_BUILD compares the REAL build mode against the desktop literal", () => {
    const found = /export const IS_DESKTOP_BUILD =([^;]+);/.exec(source);
    expect(found, "could not find IS_DESKTOP_BUILD in the source").not.toBeNull();
    expect(found![1]).toContain("import.meta.env.MODE");
    expect(found![1]).toContain('"desktop"');
  });

  it("holdWhilePending defaults its mode to the REAL build mode", () => {
    // Up to the RETURN type, not the first `)`: the first parameter is itself a
    // function type, so a lazy `[^)]*` would stop inside `send: () => void`.
    const found = /export function holdWhilePending\(([\s\S]*?)\): void \{/.exec(source);
    expect(found, "could not find holdWhilePending's signature in the source").not.toBeNull();
    expect(found![1], "the mode parameter must default to the live build mode").toContain("import.meta.env.MODE");
    expect(found![1]).toContain("mode: string =");
  });
});

/** A storage object whose every access throws, as in a locked-down profile. */
function blockedStorage(): Storage {
  const boom = (): never => {
    throw new Error("blocked");
  };
  return { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 } as unknown as Storage;
}

/** Clear only the in-memory memo, leaving storage intact: what a relaunch of the
 *  desktop app looks like from this module's point of view. The exported reset
 *  clears both, which is a fresh install rather than a relaunch. */
function resetMemoKeepingStorage(): void {
  const stored = localStorage.getItem(CONSENT_KEY);
  resetDesktopConsentForTests();
  if (stored !== null) localStorage.setItem(CONSENT_KEY, stored);
}

/** Every key/value in both web storages, so a test can prove nothing new landed. */
function snapshotStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const store of [localStorage, sessionStorage]) {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key !== null) out[key] = store.getItem(key) ?? "";
    }
  }
  return out;
}

function storageKeys(): string[] {
  return Object.keys(snapshotStorage());
}
