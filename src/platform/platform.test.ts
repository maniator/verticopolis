// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
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
  it("agrees with isWrappedMode for the mode this build actually is", () => {
    // The constant duplicates the mode literals so Vite can fold it and Rollup
    // can drop the wrapper-only modules from a browser bundle. That duplication
    // is only safe while the two answers match, which is what this pins.
    expect(IS_WRAPPED_BUILD).toBe(isWrappedMode(import.meta.env.MODE));
  });

  it("is false under the test runner, the same answer a browser build gets", () => {
    expect(IS_WRAPPED_BUILD).toBe(false);
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
    expect(resolvePlatform("desktop", { ...fakePort(), onHostCommand: null })).toBe(browserPlatform);
    expect(resolvePlatform("desktop", { ...fakePort(), onHostCommand: {} })).toBe(browserPlatform);
    expect(warn).toHaveBeenCalledTimes(3);
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

  it("the browser default defines neither, so the browser binds nothing", () => {
    expect(browserPlatform.onHostCommand).toBeUndefined();
    expect(browserPlatform.setCommandsAvailable).toBeUndefined();
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
