import { describe, expect, it, vi } from "vitest";
import { EmergencyReads } from "./emergencyReads";

const SEARCH = { deadline: 780, sweeping: [{ floor: 3, left: 10, right: 40 }], searched: [2], seq: 1 };

describe("EmergencyReads", () => {
  it("reads the bomb search only when its sequence moves, and clears it at 0", () => {
    const bombSearch = vi.fn(() => JSON.stringify(SEARCH));
    const port = { pendingChoice: () => undefined, bombSearch };
    const r = new EmergencyReads();
    r.read(port, false, 0);
    expect(r.bomb).toBeNull();
    expect(bombSearch).not.toHaveBeenCalled();
    r.read(port, false, 1);
    r.read(port, false, 1);
    expect(r.bomb).toEqual(SEARCH);
    expect(bombSearch).toHaveBeenCalledTimes(1);
    r.read(port, false, 0);
    expect(r.bomb).toBeNull();
  });

  it("reads nothing from a port without the member (the TypeScript reference)", () => {
    const r = new EmergencyReads();
    r.read({ pendingChoice: () => undefined }, false, 4);
    expect(r.bomb).toBeNull();
  });

  it("rereads after a reset even when the new tower's sequence matches", () => {
    const bombSearch = vi.fn(() => JSON.stringify(SEARCH));
    const port = { pendingChoice: () => undefined, bombSearch };
    const r = new EmergencyReads();
    r.read(port, false, 1);
    r.reset();
    r.read(port, false, 1);
    expect(bombSearch).toHaveBeenCalledTimes(2);
  });

  it("reads the pending choice once when its flag rises", () => {
    const pendingChoice = vi.fn(() => JSON.stringify({ kind: "bombThreat", cost: 300000, message: "m" }));
    const r = new EmergencyReads();
    r.read({ pendingChoice }, true, 0);
    r.read({ pendingChoice }, true, 0);
    expect(r.choice?.kind).toBe("bombThreat");
    expect(pendingChoice).toHaveBeenCalledTimes(1);
    r.read({ pendingChoice }, false, 0);
    expect(r.choice).toBeNull();
  });
});
