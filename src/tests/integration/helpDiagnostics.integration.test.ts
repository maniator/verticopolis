// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountAppDom, makeUI } from "../uiFixture";
import { IDENTITY_FIXTURE } from "../../wasmhost/engineIdentity.fixture";

/**
 * Help's About section carries the engine diagnostics (#963), and its Copy
 * diagnostics button works in every state, the engine that never loaded
 * included.
 */
const dialog = (): HTMLDialogElement =>
  document.getElementById("modal") as HTMLDialogElement;
const g = globalThis as { __vcEngineBoot?: unknown; __vcEngine?: unknown };

function stubClipboard(writeText: (t: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

beforeEach(() => {
  mountAppDom();
});

afterEach(() => {
  delete g.__vcEngineBoot;
  delete g.__vcEngine;
  vi.restoreAllMocks();
});

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe("Help diagnostics", () => {
  it("shows the engine's record and copies the same text", async () => {
    g.__vcEngineBoot = {
      build: "switchable",
      engine: "wasm",
      failure: null,
      identity: JSON.stringify(IDENTITY_FIXTURE),
    };
    g.__vcEngine = { status: { hosted: true } };
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    const { ui } = makeUI();
    ui.showHelp();
    const block = dialog().querySelector(".help-diagnostics")!;
    expect(block.getAttribute("data-state")).toBe("ok");
    expect(block.textContent).toContain("example-engine 9.8.7");
    dialog()
      .querySelector<HTMLButtonElement>('[data-act="copy-diagnostics"]')!
      .click();
    await flush();
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(copied).toContain("Engine crate: example-engine 9.8.7");
    expect(
      dialog().querySelector(".help-diagnostics-status")!.textContent,
    ).toBe("Copied.");
  });

  it("works when the engine never loaded", async () => {
    g.__vcEngineBoot = {
      build: "wasm-only",
      engine: "none",
      failure: { stage: "load", reason: "boot-timeout", message: "late" },
    };
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    const { ui } = makeUI();
    ui.showHelp();
    expect(
      dialog().querySelector(".help-diagnostics")!.getAttribute("data-state"),
    ).toBe("not-loaded");
    dialog()
      .querySelector<HTMLButtonElement>('[data-act="copy-diagnostics"]')!
      .click();
    await flush();
    expect((writeText.mock.calls[0] as unknown as [string])[0]).toContain(
      "Reason: boot-timeout",
    );
  });

  it("copies the stamped source hash beside the one the page expects", async () => {
    const sourceHash = "7".repeat(64);
    g.__vcEngineBoot = {
      build: "switchable",
      engine: "wasm",
      failure: null,
      identity: JSON.stringify(IDENTITY_FIXTURE),
      binary: { state: "ok", sourceHash },
    };
    g.__vcEngine = { status: { hosted: true } };
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    const { ui } = makeUI();
    ui.showHelp();
    dialog()
      .querySelector<HTMLButtonElement>('[data-act="copy-diagnostics"]')!
      .click();
    await flush();
    expect((writeText.mock.calls[0] as unknown as [string])[0]).toContain(
      "Source hash in the engine binary: 777777777777",
    );
  });

  it("says the source hash is unavailable, and copies that, for a binary with no build section", async () => {
    g.__vcEngineBoot = {
      build: "switchable",
      engine: "wasm",
      failure: null,
      identity: JSON.stringify(IDENTITY_FIXTURE),
      binary: { state: "missing" },
    };
    g.__vcEngine = { status: { hosted: true } };
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    const { ui } = makeUI();
    ui.showHelp();
    const block = dialog().querySelector(".help-diagnostics")!;
    expect(block.getAttribute("data-state")).toBe("unavailable");
    expect(block.textContent).toContain("no build metadata section");
    dialog()
      .querySelector<HTMLButtonElement>('[data-act="copy-diagnostics"]')!
      .click();
    await flush();
    expect((writeText.mock.calls[0] as unknown as [string])[0]).toContain(
      "Source hash in the engine binary: unavailable (no build metadata section)",
    );
  });

  it("copies the failed binary's source hash when the engine never initialized", async () => {
    g.__vcEngineBoot = {
      build: "wasm-only",
      engine: "none",
      failure: { stage: "load", reason: "package-mismatch", message: "import mismatch" },
      binary: { state: "ok", sourceHash: "8".repeat(64) },
    };
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    const { ui } = makeUI();
    ui.showHelp();
    dialog()
      .querySelector<HTMLButtonElement>('[data-act="copy-diagnostics"]')!
      .click();
    await flush();
    const copied = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(copied).toContain("Reason: package-mismatch");
    expect(copied).toContain("Source hash in the engine binary: 888888888888");
    expect(copied).not.toContain("Engine crate:");
  });

  it("tells the player when the copy fails", async () => {
    stubClipboard(async () => {
      throw new Error("denied");
    });
    document.execCommand = () => false;
    const { ui } = makeUI();
    ui.showHelp();
    dialog()
      .querySelector<HTMLButtonElement>('[data-act="copy-diagnostics"]')!
      .click();
    await flush();
    expect(
      dialog().querySelector(".help-diagnostics-status")!.textContent,
    ).toContain("Could not copy");
  });

  it("still closes with Got it", () => {
    const { ui } = makeUI();
    ui.showHelp();
    dialog().querySelector<HTMLButtonElement>('[data-act="close"]')!.click();
    expect(dialog().open).toBe(false);
  });
});
