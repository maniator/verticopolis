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

  it("reads the answer to a fire only when its sequence moves, and forgets it on reset", () => {
    const answer = { floor: 6, x: 170, width: 9, guards: [], helicopter: null, out: false, seq: 2 };
    const fireResponse = vi.fn(() => JSON.stringify(answer));
    const port = { pendingChoice: () => undefined, fireResponse };
    const r = new EmergencyReads();
    r.read(port, false, 0, 0);
    expect(fireResponse).not.toHaveBeenCalled();
    r.read(port, false, 0, 2);
    r.read(port, false, 0, 2);
    expect(r.fire).toEqual(answer);
    expect(fireResponse).toHaveBeenCalledTimes(1);
    r.reset();
    expect(r.fire).toBeNull();
    r.read(port, false, 0, 0);
    expect(r.fire).toBeNull();
  });
});
