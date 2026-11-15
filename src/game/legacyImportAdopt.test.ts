import { beforeEach, describe, expect, it, vi } from "vitest";
import { trackFileImported } from "../analytics";
import { adoptConfirmedLegacyImport } from "./legacyImportAdopt";
import { keepOpenedFile } from "./fileKeep";

vi.mock("../analytics", async (importActual) => ({
  ...(await importActual<typeof import("../analytics")>()),
  trackFileImported: vi.fn(),
}));
vi.mock("./fileKeep", () => ({ keepOpenedFile: vi.fn() }));

const HEADER = { mode: "classic" as const, star: 2, population: 90 };
const OK = Float64Array.of(1, 0);
const REFUSED = Float64Array.of(0, 0);
const FILE = { bytes: Uint8Array.of(7, 7), filename: "OLD.TDT" };

/** The adopt flow's deps, with the engine port standing in as spies. */
function setup(stage: Float64Array = OK, adopt: Float64Array = OK) {
  const port = {
    loadTdt: vi.fn(() => stage),
    adoptTdt: vi.fn(() => adopt),
    lastReason: vi.fn(() => "refused"),
    logLine: vi.fn(),
  };
  const deps = {
    enginePort: () => port as never,
    portCodes: () => ({ code: () => 0 }) as never,
    reader: vi.fn(() => ({ header: HEADER }) as never),
    towerSwapped: vi.fn(),
    ui: { toast: vi.fn() },
  };
  return { port, deps };
}

beforeEach(() => {
  vi.mocked(trackFileImported).mockClear();
  vi.mocked(keepOpenedFile).mockReset().mockResolvedValue({ id: "f", name: "OLD", kind: "tdt", size: 2, modified: 1 });
});

describe("adopting a confirmed .TDT import", () => {
  it("stages the report's own file again, then reports the arrived tower as a tdt import with its header", () => {
    const { port, deps } = setup();
    adoptConfirmedLegacyImport(deps as never, "Old Tower", () => {}, FILE);
    expect(port.loadTdt).toHaveBeenCalledExactlyOnceWith(FILE.bytes, FILE.filename);
    expect(trackFileImported).toHaveBeenCalledExactlyOnceWith("tdt", expect.any(Function));
    expect(vi.mocked(trackFileImported).mock.calls[0]![1]()).toBe(HEADER);
    expect(vi.mocked(trackFileImported).mock.invocationCallOrder[0]).toBeGreaterThan(deps.towerSwapped.mock.invocationCallOrder[0]!);
  });

  it("keeps the 1994 file in My Towers and says where", async () => {
    const { deps } = setup();
    adoptConfirmedLegacyImport(deps as never, "Old Tower", () => {}, FILE);
    expect(keepOpenedFile).toHaveBeenCalledExactlyOnceWith("OLD.TDT", FILE.bytes, "tdt");
    await vi.waitFor(() => expect(deps.ui.toast).toHaveBeenCalledWith('Tower imported. The 1994 file is in My Towers as "OLD".', "good"));
  });

  it("says how to keep the tower when My Towers could not keep the file", async () => {
    vi.mocked(keepOpenedFile).mockResolvedValue(null);
    const { deps } = setup();
    adoptConfirmedLegacyImport(deps as never, "Old Tower", () => {}, FILE);
    await vi.waitFor(() => expect(deps.ui.toast).toHaveBeenCalledWith("Tower imported. Use File > Save As… to keep it.", "good"));
  });

  it("says so when the tower it replaces could not be saved first", () => {
    const { deps } = setup();
    adoptConfirmedLegacyImport(deps as never, "Old Tower", () => {
      throw new Error("full");
    }, FILE);
    expect(deps.ui.toast).toHaveBeenCalledWith(expect.stringMatching(/couldn't be backed up/), "bad");
    expect(deps.towerSwapped).toHaveBeenCalledOnce();
  });

  it("swaps, reports and keeps nothing when the file no longer stages or adopts", () => {
    const refusedStage = setup(REFUSED);
    adoptConfirmedLegacyImport(refusedStage.deps as never, "Old Tower", () => {}, FILE);
    const refusedAdopt = setup(OK, REFUSED);
    adoptConfirmedLegacyImport(refusedAdopt.deps as never, "Old Tower", () => {}, FILE);
    expect(refusedStage.deps.towerSwapped).not.toHaveBeenCalled();
    expect(refusedAdopt.deps.towerSwapped).not.toHaveBeenCalled();
    expect(trackFileImported).not.toHaveBeenCalled();
    expect(keepOpenedFile).not.toHaveBeenCalled();
  });
});
