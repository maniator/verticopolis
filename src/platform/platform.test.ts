// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolvePlatform, getPlatform, isWrappedMode, IS_WRAPPED_BUILD } from "./index";
import { browserPlatform } from "./browser";
import type { PlatformPort } from "./types";

/**
 * Pins the platform port seam (src/platform/): the resolution order that
 * decides whether the game talks to a native wrapper shell or to the plain
 * browser, and the browser default that must stay byte-identical to the
 * pre-port export behavior (mobile-distribution arch §2, PRD F1/F3/F4/N1).
 */

const fakePort = (): PlatformPort => ({
  isNativeWrapper: true,
  saveFile: vi.fn(() => Promise.resolve()),
  openExternal: vi.fn(),
});

describe("resolvePlatform: fallback order", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("native mode with a well-formed injected port uses the injected port", () => {
    const injected = fakePort();
    expect(resolvePlatform("native", injected)).toBe(injected);
  });

  it("native mode without an injected port falls back to the browser default, quietly", () => {
    // A bare native bundle (no wrapper shell, e.g. a local preview) is
    // legitimate, so the fallback must not cry wolf on the console.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolvePlatform("native", undefined)).toBe(browserPlatform);
    expect(warn).not.toHaveBeenCalled();
  });

  it("native mode with a malformed injection falls back instead of crashing later, and says so", () => {
    // Anything that doesn't duck-type as a full port is ignored: a wrapper
    // shell bug must degrade to the browser download path, not break export.
    // Each rejection warns once so the shell author gets a diagnostic.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolvePlatform("native", null)).toBe(browserPlatform);
    expect(resolvePlatform("native", "port")).toBe(browserPlatform);
    expect(resolvePlatform("native", { isNativeWrapper: true })).toBe(browserPlatform);
    const noOpen = fakePort() as unknown as Record<string, unknown>;
    delete noOpen.openExternal;
    expect(resolvePlatform("native", noOpen)).toBe(browserPlatform);
    const badFlag = { ...fakePort(), isNativeWrapper: "yes" };
    expect(resolvePlatform("native", badFlag)).toBe(browserPlatform);
    // The flag must be literally true: a port claiming NOT to be a wrapper is
    // a contract violation (types.ts), not a half-native third mode.
    const falseFlag = { ...fakePort(), isNativeWrapper: false };
    expect(resolvePlatform("native", falseFlag)).toBe(browserPlatform);
    expect(warn).toHaveBeenCalledTimes(6);
  });

  it("a booby-trapped injection (throwing getter) degrades instead of throwing out of boot", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const trapped = Object.defineProperty({ ...fakePort() }, "saveFile", {
      get() {
        throw new Error("revoked");
      },
    });
    expect(resolvePlatform("native", trapped)).toBe(browserPlatform);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("non-native modes use the browser default even when a global is injected", () => {
    // Injecting __VC_PLATFORM__ into a plain-mode bundle is unsupported: the
    // PWA layer is gated at compile time, so only the native bundle may bind.
    const injected = fakePort();
    expect(resolvePlatform("production", injected)).toBe(browserPlatform);
    expect(resolvePlatform("development", injected)).toBe(browserPlatform);
    expect(resolvePlatform("test", injected)).toBe(browserPlatform);
  });
});

describe("getPlatform: boot-time resolution", () => {
  afterEach(() => {
    delete (globalThis as { __VC_PLATFORM__?: unknown }).__VC_PLATFORM__;
  });

  it("resolves to the browser default under vitest (plain mode) and caches the instance", () => {
    // Vitest runs with MODE "test", so a stray global must be ignored here too.
    (globalThis as { __VC_PLATFORM__?: unknown }).__VC_PLATFORM__ = fakePort();
    const first = getPlatform();
    expect(first).toBe(browserPlatform);
    expect(first.isNativeWrapper).toBe(false);
    expect(getPlatform()).toBe(first);
  });
});

describe("browserPlatform: the pre-port export behavior, byte for byte", () => {
  afterEach(() => {
    // Unconditional: a mid-test assertion failure must not leak fake timers
    // (or destroyed URL statics) into the rest of the file.
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (URL as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  });

  it("saveFile clicks a temporary <a download> at a blob URL of the contents, revoking it only later", async () => {
    vi.useFakeTimers();
    const blobs: Blob[] = [];
    (URL as { createObjectURL?: unknown }).createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:vctower";
    });
    const revoke = ((URL as { revokeObjectURL?: unknown }).revokeObjectURL = vi.fn());
    const clicks: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download });
    });

    await browserPlatform.saveFile("my-tower.vctower", "VCTOWER1\npayload", "application/octet-stream");
    expect(clicks).toEqual([{ href: "blob:vctower", download: "my-tower.vctower" }]);
    expect(blobs).toHaveLength(1);
    // The caller owns the MIME decision; the blob must carry it verbatim.
    expect(blobs[0].type).toBe("application/octet-stream");
    // Revoking in the click's own task can abort the download on engines that
    // resolve blob URLs asynchronously; it must be deferred, then still happen.
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:vctower");
    vi.useRealTimers();
  });

  it("openExternal opens a new tab with noopener,noreferrer", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    browserPlatform.openExternal("https://example.com/");
    expect(open).toHaveBeenCalledExactlyOnceWith("https://example.com/", "_blank", "noopener,noreferrer");
  });

  it("openExternal refuses non-http(s) URLs instead of opening them", () => {
    // The seam must never become a javascript:/file: gadget.
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    browserPlatform.openExternal("javascript:alert(1)");
    browserPlatform.openExternal("file:///etc/passwd");
    browserPlatform.openExternal("not a url");
    expect(open).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

describe("isWrappedMode: the one predicate every wrapper gate shares", () => {
  it("is true for the two wrapper build modes and nothing else", () => {
    expect(isWrappedMode("native")).toBe(true);
    expect(isWrappedMode("desktop")).toBe(true);
    expect(isWrappedMode("production")).toBe(false);
    expect(isWrappedMode("development")).toBe(false);
    expect(isWrappedMode("test")).toBe(false);
    expect(isWrappedMode("")).toBe(false);
    // Exact match only: no prefix or casing creep.
    expect(isWrappedMode("Native")).toBe(false);
    expect(isWrappedMode("desktop-extra")).toBe(false);
  });
});

describe("IS_WRAPPED_BUILD: the build-time twin of the predicate", () => {
  it("is false under the test runner, the same answer a browser build gets", () => {
    expect(IS_WRAPPED_BUILD).toBe(false);
    expect(IS_WRAPPED_BUILD).toBe(isWrappedMode(import.meta.env.MODE));
  });

  it("covers exactly the same modes as isWrappedMode, checked in the source", () => {
    // Asserted against the SOURCE TEXT, and that is the whole point. Under vitest
    // `import.meta.env.MODE` is "test", so comparing the constant to the
    // predicate compares false to false and would stay green if someone dropped
    // "native" from the literal expression, shipping a native bundle with the
    // seam tree-shaken out and a menu that does nothing.
    //
    // The constant cannot call the predicate: Vite only folds a literal
    // comparison, and Rollup will not inline a cross-module call to decide a
    // branch is dead. So the duplication is forced, and this is what keeps it
    // honest, the same technique the private shell uses on its sandboxed preload.
    // A plain path from the repo root: under vitest `import.meta.url` is not a
    // file: URL, so `new URL("./index.ts", import.meta.url)` cannot be read.
    const source = readFileSync("src/platform/index.ts", "utf8");
    expect(source, "the source file could not be read, so this test proves nothing").toContain("isWrappedMode");

    const predicate = /export function isWrappedMode[^{]*\{\s*return ([^;]+);/.exec(source);
    expect(predicate, "could not find isWrappedMode in the source").not.toBeNull();
    const constant = /export const IS_WRAPPED_BUILD =([^;]+);/.exec(source);
    expect(constant, "could not find IS_WRAPPED_BUILD in the source").not.toBeNull();

    const modesIn = (text: string) => [...text.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).sort();
    const predicateModes = modesIn(predicate![1]);
    const constantModes = modesIn(constant![1]);

    expect(predicateModes.length, "expected isWrappedMode to compare mode literals").toBeGreaterThan(0);
    expect(constantModes).toEqual(predicateModes);
    // And the constant must still be written as literal comparisons on
    // `import.meta.env.MODE`, or Vite cannot fold it and the tree-shake silently
    // stops working while every other test stays green.
    expect(constant![1]).toContain("import.meta.env.MODE");
  });
});

describe("isPlatformPort: onHostCommand is optional on purpose", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a port that omits it, so a three-member shell keeps validating", () => {
    // The iOS Capacitor shell was built against the contract before the command
    // channel existed. Demanding a fourth member would demote it to the browser
    // port silently and take its native file save with it.
    const legacy = fakePort();
    expect("onHostCommand" in legacy).toBe(false);
    expect(resolvePlatform("native", legacy)).toBe(legacy);
    expect(resolvePlatform("desktop", legacy)).toBe(legacy);
  });

  it("accepts a port that provides it", () => {
    const withCommands = { ...fakePort(), onHostCommand: vi.fn() };
    expect(resolvePlatform("desktop", withCommands)).toBe(withCommands);
  });

  it("rejects a port whose onHostCommand is present but not callable", () => {
    // Optional means absent-or-function. A non-function would throw at the
    // binding call site during boot, so it is a malformed injection like any
    // other and must degrade instead.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolvePlatform("desktop", { ...fakePort(), onHostCommand: "yes" })).toBe(browserPlatform);
    // A number specifically: a buggy shell is far likelier to inject a stray
    // value like this than a string, so it is the case worth naming.
    expect(resolvePlatform("desktop", { ...fakePort(), onHostCommand: 42 })).toBe(browserPlatform);
    expect(resolvePlatform("desktop", { ...fakePort(), setCommandsAvailable: 42 })).toBe(browserPlatform);
    expect(resolvePlatform("desktop", { ...fakePort(), onHostCommand: null })).toBe(browserPlatform);
    expect(resolvePlatform("desktop", { ...fakePort(), onHostCommand: {} })).toBe(browserPlatform);
    expect(warn).toHaveBeenCalledTimes(5);
  });

  it("rejects a port whose setCommandsAvailable is present but not callable", () => {
    // Same rule as onHostCommand: optional means absent-or-function, because the
    // game calls it during bind and a non-function would throw out of boot.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolvePlatform("desktop", { ...fakePort(), setCommandsAvailable: 1 })).toBe(browserPlatform);
    expect(resolvePlatform("desktop", { ...fakePort(), setCommandsAvailable: {} })).toBe(browserPlatform);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("accepts a port that provides both command members", () => {
    const full = { ...fakePort(), onHostCommand: vi.fn(), setCommandsAvailable: vi.fn() };
    expect(resolvePlatform("desktop", full)).toBe(full);
  });

  it("onFlushRequest follows the same rule: absent fine, function fine, junk rejected", () => {
    // Story D6's member. Pinned here so deleting its duck-check clause (or
    // the browser port growing the member) cannot go green.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const withFlush = { ...fakePort(), onFlushRequest: vi.fn() };
    expect(resolvePlatform("desktop", withFlush)).toBe(withFlush);
    expect(resolvePlatform("desktop", { ...fakePort(), onFlushRequest: 42 })).toBe(browserPlatform);
    expect(resolvePlatform("desktop", { ...fakePort(), onFlushRequest: {} })).toBe(browserPlatform);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(browserPlatform.onFlushRequest).toBeUndefined();
  });

  it("the browser default defines neither, so the browser binds nothing", () => {
    expect(browserPlatform.onHostCommand).toBeUndefined();
    expect(browserPlatform.setCommandsAvailable).toBeUndefined();
  });
});

describe("isPlatformPort: saveStore is optional on the same grounds", () => {
  const fakeStore = () => ({
    list: vi.fn(),
    read: vi.fn(),
    write: vi.fn(),
    delete: vi.fn(),
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a port that omits it, so a shell with no store keeps validating", () => {
    // Same hazard as the command members, and it bites harder here: the iOS
    // shell has no save store and never will, so a required member would demote
    // it to the browser port and cost it its native file save.
    const noStore = fakePort();
    expect("saveStore" in noStore).toBe(false);
    expect(resolvePlatform("native", noStore)).toBe(noStore);
    expect(resolvePlatform("desktop", noStore)).toBe(noStore);
  });

  it("accepts a port that provides a well-formed one", () => {
    const withStore = { ...fakePort(), saveStore: fakeStore() };
    expect(resolvePlatform("desktop", withStore)).toBe(withStore);
  });

  it("rejects a port whose saveStore is present but incomplete", () => {
    // An object rather than a function, so it needs its own shape check. A
    // store missing `write` would resolve fine and then throw on the first
    // autosave, which is the worst possible time to discover it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { write: _omitted, ...missingWrite } = fakeStore();
    expect(resolvePlatform("desktop", { ...fakePort(), saveStore: missingWrite })).toBe(browserPlatform);
    expect(resolvePlatform("desktop", { ...fakePort(), saveStore: { ...fakeStore(), read: 42 } })).toBe(
      browserPlatform,
    );
    expect(resolvePlatform("desktop", { ...fakePort(), saveStore: {} })).toBe(browserPlatform);
    expect(resolvePlatform("desktop", { ...fakePort(), saveStore: null })).toBe(browserPlatform);
    expect(resolvePlatform("desktop", { ...fakePort(), saveStore: "yes" })).toBe(browserPlatform);
    expect(warn).toHaveBeenCalledTimes(5);
  });

  it("the browser default omits it, so the desktop path folds out of a browser bundle", () => {
    // `if (port.saveStore)` is the only gate, so omitting rather than stubbing
    // is what lets the store code drop from a browser build entirely.
    expect(browserPlatform.saveStore).toBeUndefined();
    expect("saveStore" in browserPlatform).toBe(false);
  });
});

describe("isPlatformPort: channel is a data member, so it is not shape-checked", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a port that omits it, so an existing iOS shell keeps validating", () => {
    // The optional-member rule again: the iOS shell has no storefront to name,
    // and demanding the member would demote it to the browser port and cost it
    // its native file save.
    const noChannel = fakePort();
    expect("channel" in noChannel).toBe(false);
    expect(resolvePlatform("native", noChannel)).toBe(noChannel);
    expect(resolvePlatform("desktop", noChannel)).toBe(noChannel);
  });

  it("accepts a port that names one", () => {
    const steam = { ...fakePort(), channel: "steam" };
    expect(resolvePlatform("desktop", steam)).toBe(steam);
  });

  it("accepts a port whose channel is hostile, because the VALUE is sanitized at read time", () => {
    // Deliberately unlike the function members. A junk `channel` cannot throw
    // during boot the way a non-callable `onHostCommand` would, so refusing the
    // whole port over one would trade a working shell's file save for a
    // telemetry label. `resolveChannel` (src/analyticsEnrichment.ts) is what
    // turns any of these into `unknown`.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const channel of [42, null, {}, "evil", "STEAM", "steam "]) {
      const port = { ...fakePort(), channel };
      expect(resolvePlatform("desktop", port)).toBe(port);
    }
    const trapped = Object.defineProperty({ ...fakePort() }, "channel", {
      get() {
        throw new Error("revoked");
      },
    });
    expect(resolvePlatform("desktop", trapped)).toBe(trapped);
    expect(warn).not.toHaveBeenCalled();
  });

  it("the browser default omits it", () => {
    expect(browserPlatform.channel).toBeUndefined();
    expect("channel" in browserPlatform).toBe(false);
  });
});

describe("resolvePlatform: desktop mode binds like native", () => {
  const port = {
    isNativeWrapper: true as const,
    saveFile: () => Promise.resolve(),
    openExternal: () => {},
  };
  it("binds a well-formed injection under desktop mode", () => {
    expect(resolvePlatform("desktop", port)).toBe(port);
  });
  it("still degrades to the browser platform for malformed desktop injections", () => {
    expect(resolvePlatform("desktop", { isNativeWrapper: true })).toBe(browserPlatform);
  });
});
