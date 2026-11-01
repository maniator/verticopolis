import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showEngineFailure } from "./bootstrap";

vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ inject: vi.fn() }));
vi.mock("virtual:pwa-register", () => ({ registerSW: () => () => {} }));
vi.mock("./engineCrash/failureArchive", () => ({ downloadEngineFailureArchive: vi.fn(() => "saved") }));

const unverifiable = { build: "wasm-only", engine: "none", failure: { stage: "load", reason: "unverifiable", message: "m", package: { kind: "unverifiable", file: null, expected: null, found: null, expectedPackage: null, servedPackage: null, controlled: false } } } as never;

describe("showEngineFailure, the secure-context wiring (#985)", () => {
  const original = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  beforeEach(() => {
    document.body.innerHTML = `<div id="stage"></div>`;
  });
  afterEach(() => {
    document.body.innerHTML = "";
    if (original) Object.defineProperty(window, "isSecureContext", original);
    else Reflect.deleteProperty(window, "isSecureContext");
  });

  const shown = () => document.querySelector("#engine-failure")?.textContent ?? "";

  it("offers a crash report while the Rust engine is stopped, with download feedback", () => {
    showEngineFailure(unverifiable, true);
    const button = document.querySelector<HTMLButtonElement>('[data-act="download-failure-report"]');
    expect(button?.textContent).toBe("Download crash report");
    button?.click();
    expect(document.querySelector(".engine-failure-report-status")?.textContent).toContain("Report downloaded");
  });

  it("tells an insecure page to open the game using HTTPS", () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    showEngineFailure(unverifiable, true);
    expect(shown()).toMatch(/Open the game using HTTPS/);
    expect(shown()).not.toMatch(/try another browser/);
  });

  it("tells a secure page to reload or try another browser, without the HTTPS step", () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    showEngineFailure(unverifiable, true);
    expect(shown()).toMatch(/try another browser/);
    expect(shown()).not.toMatch(/HTTPS/);
  });
});
