import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  initPwaInstall,
  isStandalone,
  isIos,
  canPromptInstall,
  installAvailability,
  promptInstall,
  __resetPwaInstallForTest,
} from "./pwaInstall";

/** A fake beforeinstallprompt event: preventDefault spy + prompt/userChoice. */
function fakeBip(outcome: "accepted" | "dismissed" = "accepted") {
  const e = new Event("beforeinstallprompt") as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: string }>;
  };
  e.prompt = vi.fn(() => Promise.resolve());
  e.userChoice = Promise.resolve({ outcome });
  vi.spyOn(e, "preventDefault");
  return e;
}

beforeEach(() => {
  __resetPwaInstallForTest();
  vi.unstubAllGlobals();
  // Default: a browser session (not standalone), non-iOS.
  window.matchMedia = vi.fn((q: string) => ({ matches: false, media: q }) as MediaQueryList);
  Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (X11; Linux) Chrome/150", configurable: true });
  Object.defineProperty(navigator, "platform", { value: "Linux x86_64", configurable: true });
  Object.defineProperty(navigator, "maxTouchPoints", { value: 0, configurable: true });
  (window.navigator as { standalone?: boolean }).standalone = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetPwaInstallForTest();
});

describe("standalone / iOS detection", () => {
  it("isStandalone true under display-mode: standalone", () => {
    window.matchMedia = vi.fn((q: string) => ({ matches: q.includes("standalone") }) as MediaQueryList);
    expect(isStandalone()).toBe(true);
  });

  it("isStandalone true under iOS navigator.standalone", () => {
    (window.navigator as { standalone?: boolean }).standalone = true;
    expect(isStandalone()).toBe(true);
  });

  it("isStandalone false for a plain browser session", () => {
    expect(isStandalone()).toBe(false);
  });

  it("isIos detects iPhone and iPadOS-as-desktop", () => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17)", configurable: true });
    expect(isIos()).toBe(true);
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Macintosh)", configurable: true });
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
    Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true });
    expect(isIos()).toBe(true);
  });
});

describe("beforeinstallprompt capture (CAP-2)", () => {
  it("captures the event, prevents the browser's auto-infobar, and notifies", () => {
    const onChange = vi.fn();
    initPwaInstall({ onChange });
    expect(canPromptInstall()).toBe(false);
    const e = fakeBip();
    window.dispatchEvent(e);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(canPromptInstall()).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });

  it("initPwaInstall is idempotent: repeated calls bind the listener once", () => {
    initPwaInstall();
    initPwaInstall();
    initPwaInstall();
    const e = fakeBip();
    window.dispatchEvent(e);
    // One capture, one preventDefault: a double-bind would preventDefault twice.
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("catches an event fired before the callbacks are attached (early-boot capture)", () => {
    // The boot flow binds the listener early with NO callbacks; the controller
    // attaches its onChange later. An event captured in between must not be lost,
    // and the later callback attach must not clobber or re-bind.
    initPwaInstall(); // early, bare
    window.dispatchEvent(fakeBip()); // fires before the controller wires up
    expect(canPromptInstall()).toBe(true); // captured despite no onChange yet
    const onChange = vi.fn();
    initPwaInstall({ onChange }); // controller attaches its callback
    window.dispatchEvent(new Event("appinstalled")); // any later change reaches it
    expect(onChange).toHaveBeenCalled();
  });

  it("a later init never clobbers a set callback to null", () => {
    const onChange = vi.fn();
    const onInstalled = vi.fn();
    initPwaInstall({ onChange, onInstalled });
    initPwaInstall(); // bare re-init must keep the earlier callbacks
    window.dispatchEvent(new Event("appinstalled"));
    expect(onInstalled).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalled();
  });
});

describe("installAvailability", () => {
  it("is 'none' for a standalone session even with a captured event", () => {
    initPwaInstall();
    window.dispatchEvent(fakeBip());
    window.matchMedia = vi.fn((q: string) => ({ matches: q.includes("standalone") }) as MediaQueryList);
    expect(installAvailability()).toBe("none");
  });

  it("is 'prompt' for a browser with a captured event", () => {
    initPwaInstall();
    window.dispatchEvent(fakeBip());
    expect(installAvailability()).toBe("prompt");
  });

  it("is 'ios-howto' on iOS with no captured event", () => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17)", configurable: true });
    initPwaInstall();
    expect(installAvailability()).toBe("ios-howto");
  });

  it("is 'none' for a non-iOS browser that never became installable", () => {
    initPwaInstall();
    expect(installAvailability()).toBe("none");
  });
});

describe("promptInstall one-shot (CAP-2 guard)", () => {
  it("drives prompt() and returns the outcome", async () => {
    initPwaInstall();
    const e = fakeBip("accepted");
    window.dispatchEvent(e);
    const outcome = await promptInstall();
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(outcome).toBe("accepted");
  });

  it("consumes the event: a second call is unavailable and never re-prompts", async () => {
    initPwaInstall();
    const e = fakeBip("dismissed");
    window.dispatchEvent(e);
    await promptInstall();
    expect(canPromptInstall()).toBe(false); // consumed up front
    const second = await promptInstall();
    expect(second).toBe("unavailable");
    expect(e.prompt).toHaveBeenCalledTimes(1); // never fired twice
  });

  it("returns 'unavailable' with no captured event and does not throw", async () => {
    initPwaInstall();
    await expect(promptInstall()).resolves.toBe("unavailable");
  });
});

describe("appinstalled (CAP-4 signal, CAP-1 hide)", () => {
  it("fires onInstalled, clears promptability, and reads standalone", () => {
    const onInstalled = vi.fn();
    initPwaInstall({ onInstalled });
    window.dispatchEvent(fakeBip());
    expect(canPromptInstall()).toBe(true);
    window.dispatchEvent(new Event("appinstalled"));
    expect(onInstalled).toHaveBeenCalledTimes(1);
    expect(canPromptInstall()).toBe(false);
    expect(isStandalone()).toBe(true); // installed this session => offered nothing
    expect(installAvailability()).toBe("none");
  });
});

describe("wrapped builds (native/desktop): no install surface at all", () => {
  it("initPwaInstall binds nothing in a wrapped mode, so a shell BIP never arms the offer", () => {
    initPwaInstall({}, "desktop");
    window.dispatchEvent(fakeBip());
    expect(canPromptInstall()).toBe(false);
    expect(installAvailability()).toBe("none");
  });
  it("installAvailability reports none in wrapped modes even with a captured prompt", () => {
    // Captured under the browser default (test mode)...
    initPwaInstall({});
    window.dispatchEvent(fakeBip());
    expect(installAvailability()).toBe("prompt");
    // ...a wrapped build still offers nothing.
    expect(installAvailability("native")).toBe("none");
    expect(installAvailability("desktop")).toBe("none");
  });
});
