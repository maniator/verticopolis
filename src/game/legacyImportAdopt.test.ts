import { beforeEach, describe, expect, it, vi } from "vitest";
import { trackFileImported } from "../analytics";
import { SaveGame } from "../storage/SaveGame";
import { adoptConfirmedLegacyImport } from "./legacyImportAdopt";

vi.mock("../analytics", async (importActual) => ({
  ...(await importActual<typeof import("../analytics")>()),
  trackFileImported: vi.fn(),
}));
vi.mock("../storage/SaveGame", () => ({ SLOT_COUNT: 3, SaveGame: { hasSlot: vi.fn(() => false), saveSlot: vi.fn() } }));
vi.mock("./portLifecycle", async (importActual) => ({
  ...(await importActual<typeof import("./portLifecycle")>()),
  saveText: vi.fn(() => "SAVE"),
}));

const HEADER = { mode: "classic" as const, star: 2, population: 90 };
const OK = Float64Array.of(1, 0);
const REFUSED = Float64Array.of(0, 0);

/** The adopt flow's deps, with the engine port standing in as spies. */
function setup(adopt: Float64Array = OK) {
  const port = { adoptTdt: vi.fn(() => adopt), lastReason: vi.fn(() => "refused"), logLine: vi.fn(), setCamera: vi.fn(), serialize: vi.fn(() => "SAVE") };
  const deps = {
    enginePort: () => port as never,
    portCodes: () => ({ code: () => 0 }) as never,
    reader: vi.fn(() => ({ header: HEADER }) as never),
    towerSwapped: vi.fn(),
    ui: { toast: vi.fn() } as never,
  };
  return { port, deps };
}

beforeEach(() => {
  vi.mocked(trackFileImported).mockClear();
  vi.mocked(SaveGame.saveSlot).mockClear();
});

describe("adopting a confirmed .TDT import", () => {
  it("reports the arrived tower as a tdt import, after the swap, with its header", () => {
    const { deps } = setup();
    adoptConfirmedLegacyImport(deps, "Old Tower", () => {}, () => OK);
    expect(trackFileImported).toHaveBeenCalledExactlyOnceWith("tdt", expect.any(Function));
    expect(vi.mocked(trackFileImported).mock.calls[0]![1]()).toBe(HEADER);
    expect(vi.mocked(trackFileImported).mock.invocationCallOrder[0]).toBeGreaterThan(deps.towerSwapped.mock.invocationCallOrder[0]!);
    expect(SaveGame.saveSlot).toHaveBeenCalledOnce();
  });

  it("reports nothing when the file no longer stages or adopts", () => {
    const refusedStage = setup();
    adoptConfirmedLegacyImport(refusedStage.deps, "Old Tower", () => {}, () => REFUSED);
    const refusedAdopt = setup(REFUSED);
    adoptConfirmedLegacyImport(refusedAdopt.deps, "Old Tower", () => {}, () => OK);
    expect(refusedStage.deps.towerSwapped).not.toHaveBeenCalled();
    expect(refusedAdopt.deps.towerSwapped).not.toHaveBeenCalled();
    expect(trackFileImported).not.toHaveBeenCalled();
  });
});
