import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showEngineFailure } from "./bootstrap";
import { runEngineRepair } from "./engineRepairControl";
import type { RepairResult } from "./wasmhost/engineRepair";

const mismatch = {
  stage: "load",
  reason: "package-mismatch",
  message: "m",
  package: { kind: "mismatch", expectedPackage: "111111111111", servedPackage: "222222222222" },
} as const;

function setController(controller: object | null) {
  Object.defineProperty(navigator, "serviceWorker", { value: { controller, getRegistration: async () => undefined }, configurable: true });
}

describe("Repair engine files button", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="stage"></div>`;
  });
  afterEach(() => {
    document.body.innerHTML = "";
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  const repairButton = () => document.querySelector<HTMLButtonElement>('[data-act="repair-engine"]');

  it("is offered on a load-stage mismatch when a worker controls the page, with the repair step in the copy", () => {
    setController({});
    showEngineFailure({ build: "wasm-only", engine: "none", failure: { ...mismatch, package: { ...mismatch.package } } as never }, true);
    expect(repairButton()?.textContent).toBe("Repair engine files");
    expect(document.querySelector("#boot-fallback")?.textContent).toMatch(/press Repair engine files to download a fresh copy/);
  });

  it("is not offered without a controlling worker, for a timeout or for a start-stage failure", () => {
    setController(null);
    showEngineFailure({ build: "wasm-only", engine: "none", failure: mismatch as never }, true);
    expect(repairButton()).toBeNull();
    setController({});
    showEngineFailure({ build: "wasm-only", engine: "none", failure: { stage: "load", reason: "boot-timeout", message: "m" } }, true);
    expect(repairButton()).toBeNull();
    showEngineFailure({ build: "wasm-only", engine: "none", failure: { stage: "start", reason: "attach-refused", message: "m" } }, true);
    expect(repairButton()).toBeNull();
  });

  it("says to connect before repairing when offline", () => {
    setController({});
    showEngineFailure({ build: "wasm-only", engine: "none", failure: mismatch as never }, false);
    expect(document.querySelector("#boot-fallback")?.textContent).toMatch(/Connect to the internet before repairing engine files/);
  });
});

describe("runEngineRepair", () => {
  function mount() {
    document.body.innerHTML = `<p><button data-act="repair-engine">Repair engine files</button><span class="engine-failure-repair-status"></span></p>`;
    const button = document.querySelector("button")!;
    const status = document.querySelector<HTMLElement>(".engine-failure-repair-status")!;
    const click = (repair: () => Promise<RepairResult>) => {
      const e = new Event("click");
      Object.defineProperty(e, "currentTarget", { value: button });
      return runEngineRepair(e, repair);
    };
    return { button, status, click };
  }

  it("shows progress, then the outcome, and keeps the button available", async () => {
    const { button, status, click } = mount();
    let finish!: (r: RepairResult) => void;
    const pending = click(() => new Promise<RepairResult>((r) => (finish = r)));
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(status.textContent).toBe("Repairing the engine files.");
    finish({ ok: true, written: ["a"] });
    await pending;
    expect(status.textContent).toBe("Engine files repaired. Press Reload to try again.");
    expect(button.hasAttribute("aria-disabled")).toBe(false);
  });

  it("ignores a second press while a repair runs", async () => {
    const { click } = mount();
    const repair = vi.fn(() => new Promise<RepairResult>(() => {}));
    void click(repair);
    void click(repair);
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it("reports a failure as nothing changed, including a repair that throws", async () => {
    const { status, click } = mount();
    await click(async () => ({ ok: false, reason: "fetch", file: "x" }));
    expect(status.textContent).toMatch(/Nothing was changed/);
    await click(async () => {
      throw new Error("boom");
    });
    expect(status.textContent).toMatch(/Repair is not available here\. Nothing was changed/);
  });

  it("never reloads the page", async () => {
    const { click } = mount();
    const reload = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, "location", { value: { ...orig, reload }, configurable: true });
    await click(async () => ({ ok: true, written: [] }));
    expect(reload).not.toHaveBeenCalled();
    Object.defineProperty(window, "location", { value: orig, configurable: true });
  });
});
