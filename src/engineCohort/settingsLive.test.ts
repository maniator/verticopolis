import { afterEach, describe, expect, it } from "vitest";
import { render } from "lit-html";
import { engineSectionTemplate } from "../ui/templates/settings";
import { setCurrentSelection } from "./current";
import { latchSafety, type Selection } from "./policy";
import { SAFETY_KEY, type KeyValueStore } from "./records";
import { forgetRetry, liveEngineSettings, wireEngineSection } from "./settingsLive";
import { ENGINE_STORAGE_KEY } from "../wasmhost/engineChoice";
import type { EngineBootState } from "../wasmhost/engineBoot";

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

function selection(over: Partial<Selection> = {}): Selection {
  return { boot: "ts", requested: "ts", selectedBy: "cohort", assignedArm: "ts", stage: 1, preference: "auto", suppression: null, crashLoop: false, transition: "none", notice: "none", markerId: null, ...over };
}

function open(store: KeyValueStore, running: "ts" | "wasm" = "ts", boot?: EngineBootState) {
  const src = { store, running: () => running, boot: () => boot };
  const box = document.createElement("div");
  render(engineSectionTemplate(liveEngineSettings(src)), box);
  wireEngineSection(box, src);
  const radio = (v: string) => box.querySelector<HTMLInputElement>(`input[name="set-engine"][value="${v}"]`)!;
  const pick = (v: string) => {
    radio(v).checked = true;
    radio(v).dispatchEvent(new Event("change"));
  };
  const status = () => box.querySelector("#set-engine-status")!.textContent!.replace(/\s+/g, " ").trim();
  return { box, radio, pick, status };
}

afterEach(() => {
  setCurrentSelection(null);
  forgetRetry();
});

describe("the Settings Game engine section", () => {
  it("lists the three choices with the owner's labels and no Classic", () => {
    const { box } = open(new MemoryStore());
    const labels = [...box.querySelectorAll(".set-radio span")].map((s) => s.textContent);
    expect(labels).toEqual(["Automatic (recommended)", "Rust engine (experimental)", "TypeScript engine (stable)"]);
    expect(box.textContent).not.toMatch(/classic/i);
  });

  it("checks the stored choice and shows the running engine", () => {
    const store = new MemoryStore();
    store.setItem(ENGINE_STORAGE_KEY, "wasm");
    setCurrentSelection(selection({ preference: "wasm", selectedBy: "setting", boot: "wasm" }));
    const { radio, status } = open(store, "wasm");
    expect(radio("rust").checked).toBe(true);
    expect(status()).toBe("Running now: Rust engine.");
  });

  it("stores a new choice and asks for a restart without reloading", () => {
    const store = new MemoryStore();
    setCurrentSelection(selection());
    const { pick, status } = open(store);
    pick("rust");
    expect(store.getItem(ENGINE_STORAGE_KEY)).toBe("wasm");
    expect(status()).toContain("Restart the game to switch engines.");
    pick("auto");
    expect(store.getItem(ENGINE_STORAGE_KEY)).toBeNull();
    expect(status()).not.toContain("Restart");
  });

  it("replaces a tester's stored test host when the player picks Rust", () => {
    const store = new MemoryStore();
    store.setItem(ENGINE_STORAGE_KEY, "wasm-frame");
    setCurrentSelection(selection({ preference: "wasm-frame", selectedBy: "setting", boot: "wasm-frame", requested: "wasm-frame" }));
    const { radio, status } = open(store, "wasm");
    expect(radio("rust").checked).toBe(true);
    expect(status()).toContain("(a test setup is selected)");
    radio("rust").click();
    expect(store.getItem(ENGINE_STORAGE_KEY)).toBe("wasm");
    expect(status()).not.toContain("a test setup");
  });

  it("explains a suppression and clears it on retry", () => {
    const store = new MemoryStore();
    const suppression = latchSafety(store, { reason: "trap-tick", stage: "host", sha: "a", now: 1 });
    setCurrentSelection(selection({ selectedBy: "safety", suppression, assignedArm: "wasm", requested: "wasm" }));
    const { box, status } = open(store);
    expect(status()).toContain("The Rust engine had a problem on this device earlier (it stopped while running)");
    box.querySelector<HTMLButtonElement>("[data-engine-retry]")!.click();
    expect(store.getItem(SAFETY_KEY)).toBeNull();
    expect(status()).toContain("Restart the game to switch engines.");
    expect(box.querySelector("[data-engine-retry]")).toBeNull();
  });

  it("explains a fallback in this session from the boot state", () => {
    const store = new MemoryStore();
    latchSafety(store, { reason: "trap-command", stage: "host", sha: "a", now: 1 });
    setCurrentSelection(selection({ assignedArm: "wasm", boot: "wasm", requested: "wasm" }));
    const boot: EngineBootState = { build: "switchable", engine: "ts", failure: { stage: "host", reason: "trap-command", message: "x" } };
    expect(open(store, "ts", boot).status()).toContain("The Rust engine had a problem in this session (it stopped while running)");
  });

  it("offers the retry for a safety record that could not be read, and clears it", () => {
    const store = new MemoryStore();
    store.setItem(SAFETY_KEY, "garbage");
    setCurrentSelection(selection({ assignedArm: "wasm", requested: "wasm" }));
    const { box, status } = open(store);
    box.querySelector<HTMLButtonElement>("[data-engine-retry]")!.click();
    expect(store.getItem(SAFETY_KEY)).toBeNull();
    expect(status()).toContain("Restart the game to switch engines.");
  });

  it("asks for a restart after a retry in the session where Rust failed, also on reopening Settings", () => {
    const store = new MemoryStore();
    latchSafety(store, { reason: "trap-tick", stage: "host", sha: "a", now: 1 });
    setCurrentSelection(selection({ assignedArm: "wasm", boot: "wasm", requested: "wasm" }));
    const boot: EngineBootState = { build: "switchable", engine: "ts", failure: { stage: "host", reason: "trap-tick", message: "x" } };
    const first = open(store, "ts", boot);
    expect(first.status()).not.toContain("Restart");
    first.box.querySelector<HTMLButtonElement>("[data-engine-retry]")!.click();
    expect(first.status()).toContain("Restart the game to switch engines.");
    expect(open(store, "ts", boot).status()).toContain("Restart the game to switch engines.");
  });

  it("shows the stored choice again when a new choice was not saved", () => {
    const store = new MemoryStore();
    const refusesChoice: KeyValueStore = {
      getItem: (k) => store.getItem(k),
      setItem: (k, v) => {
        if (k === ENGINE_STORAGE_KEY) throw new Error("quota");
        store.setItem(k, v);
      },
      removeItem: (k) => store.removeItem(k),
    };
    setCurrentSelection(selection());
    const { radio, pick, status } = open(refusesChoice);
    pick("rust");
    expect(store.getItem(ENGINE_STORAGE_KEY)).toBeNull();
    expect(radio("auto").checked).toBe(true);
    expect(radio("rust").checked).toBe(false);
    expect(status()).toContain("This browser cannot save a new choice right now.");
  });

  it("disables the choice where storage cannot keep it", () => {
    const blocked: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    const { radio, status } = open(blocked);
    expect(radio("auto").disabled).toBe(true);
    expect(status()).toContain("This browser cannot save a new choice right now.");
  });
});
