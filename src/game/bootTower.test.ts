import { describe, expect, it, vi } from "vitest";
import type { EnginePort } from "../simport/enginePort";
import { SaveGame } from "../storage/SaveGame";
import { bootTower } from "./bootTower";
import { NEWER_SAVE_REFUSAL } from "./portLifecycle";

const portRefusing = (reason: string): EnginePort =>
  ({ setBackdrop: vi.fn(), loadSave: vi.fn(() => Float64Array.of(0, 0)), lastReason: () => reason }) as unknown as EnginePort;

describe("bootTower", () => {
  it("flags a stored save the engine refused as written by a newer build", () => {
    localStorage.clear();
    localStorage.setItem("verticopolis-save", SaveGame.packSync("{}"));
    const boot = bootTower(portRefusing(NEWER_SAVE_REFUSAL));
    expect(boot).toMatchObject({ corrupt: true, loaded: false, newer: true });
  });

  it("stashes the newer key when the Verticopolis key is only damaged", () => {
    localStorage.clear();
    localStorage.setItem("verticopolis-save", "VCZ1:not-actually-deflate");
    localStorage.setItem("simtower-clone-save", SaveGame.packSync("{}"));
    // The damaged key never reaches the engine, so only the legacy one is refused, as newer.
    expect(bootTower(portRefusing(NEWER_SAVE_REFUSAL))).toMatchObject({ newer: true, stashKey: "simtower-clone-save" });
    localStorage.setItem("verticopolis-save", SaveGame.packSync("{}"));
    expect(bootTower(portRefusing("json: bad"))).toMatchObject({ newer: false, stashKey: "verticopolis-save" });
  });

  it("does not call a damaged save newer", () => {
    localStorage.clear();
    localStorage.setItem("verticopolis-save", SaveGame.packSync("{}"));
    expect(bootTower(portRefusing("json: expected value"))).toMatchObject({ corrupt: true, newer: false });
  });

  it("loads the save without its people on the boot after a crash, and whole otherwise (#2209)", () => {
    const save = JSON.stringify({ money: 5, crowd: { people: [] }, dispatch: { cars: [] } });
    // The stored text is stamped with its build and write time as it is packed.
    const loads = () => ({ setBackdrop: vi.fn(), loadSave: vi.fn((_text: string) => Float64Array.of(1, 0)), lastReason: () => "" });
    localStorage.clear();
    localStorage.setItem("verticopolis-save", SaveGame.packSync(save));
    const afterCrash = loads();
    expect(bootTower(afterCrash as unknown as EnginePort, true)).toMatchObject({ loaded: true });
    const loaded = JSON.parse(afterCrash.loadSave.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(loaded).toMatchObject({ money: 5 });
    expect(loaded).not.toHaveProperty("crowd");
    expect(loaded).not.toHaveProperty("dispatch");
    const plain = loads();
    expect(bootTower(plain as unknown as EnginePort, false)).toMatchObject({ loaded: true });
    expect(JSON.parse(plain.loadSave.mock.calls[0][0] as string)).toMatchObject({ money: 5, crowd: { people: [] }, dispatch: { cars: [] } });
  });

  it("flags nothing when no save is stored", () => {
    localStorage.clear();
    expect(bootTower(portRefusing(NEWER_SAVE_REFUSAL))).toMatchObject({ corrupt: false, newer: false });
  });
});
