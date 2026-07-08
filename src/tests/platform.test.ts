// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolvePlatform, getPlatform } from "../platform";
import { browserPlatform } from "../platform/browser";
import type { PlatformPort } from "../platform/types";

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

describe("resolvePlatform — fallback order", () => {
  it("native mode with a well-formed injected port uses the injected port", () => {
    const injected = fakePort();
    expect(resolvePlatform("native", injected)).toBe(injected);
  });

  it("native mode without an injected port falls back to the browser default", () => {
    expect(resolvePlatform("native", undefined)).toBe(browserPlatform);
  });

  it("native mode with a malformed injection falls back instead of crashing later", () => {
    // Anything that doesn't duck-type as a full port is ignored: a wrapper
    // shell bug must degrade to the browser download path, not break export.
    expect(resolvePlatform("native", null)).toBe(browserPlatform);
    expect(resolvePlatform("native", "port")).toBe(browserPlatform);
    expect(resolvePlatform("native", { isNativeWrapper: true })).toBe(browserPlatform);
    const noOpen = fakePort() as unknown as Record<string, unknown>;
    delete noOpen.openExternal;
    expect(resolvePlatform("native", noOpen)).toBe(browserPlatform);
    const badFlag = { ...fakePort(), isNativeWrapper: "yes" };
    expect(resolvePlatform("native", badFlag)).toBe(browserPlatform);
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

describe("getPlatform — boot-time resolution", () => {
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

describe("browserPlatform — the pre-port export behavior, byte for byte", () => {
  afterEach(() => {
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
});
