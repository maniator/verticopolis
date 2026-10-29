import { afterEach, describe, expect, it, vi } from "vitest";
import {
  codecFromModule,
  prepareTdtCodec,
  tdtCodec,
  TDT_UNAVAILABLE,
  useTdtCodec,
  type TdtCodec,
} from "./tdtCodec";

type FakeEngine = {
  loadTdt: (bytes: Uint8Array, filename: string) => Float64Array;
  adoptTdt: () => Float64Array;
  tdtNote: (i: number) => string | undefined;
  tdtTowerName: () => string | undefined;
  serialize: () => string;
  lastReason: () => string | undefined;
  tdtExport: () => Float64Array;
  tdtFile: () => Uint8Array | undefined;
  free: () => void;
};

function engine(over: Partial<FakeEngine> = {}): FakeEngine {
  const notes = ["first", "second"];
  return {
    loadTdt: () => Float64Array.of(1),
    adoptTdt: () => Float64Array.of(1),
    tdtNote: (i) => notes[i],
    tdtTowerName: () => "Tower",
    serialize: () => '{"save":1}',
    lastReason: () => undefined,
    tdtExport: () => Float64Array.of(1),
    tdtFile: () => Uint8Array.of(1, 2, 3),
    free: vi.fn(),
    ...over,
  };
}

const moduleOf = (e: FakeEngine) =>
  ({
    Engine: { newGame: () => e, fromSave: () => e },
  }) as unknown as Parameters<typeof codecFromModule>[0];

afterEach(() => useTdtCodec(undefined));

describe("codecFromModule", () => {
  it("reads a file into its save, record, notes and name, and frees the engine", () => {
    const e = engine();
    const read = codecFromModule(moduleOf(e)).read(new Uint8Array(4), "A.TDT");
    expect(read).toMatchObject({
      saveJson: '{"save":1}',
      notes: ["first", "second"],
      name: "Tower",
    });
    expect(e.free).toHaveBeenCalledOnce();
  });

  it("throws the engine's reason when the file is refused, or a plain sentence without one", () => {
    const refused = engine({
      loadTdt: () => Float64Array.of(0),
      lastReason: () => "Not a tower.",
    });
    expect(() =>
      codecFromModule(moduleOf(refused)).read(new Uint8Array(), "A.TDT"),
    ).toThrow("Not a tower.");
    expect(refused.free).toHaveBeenCalledOnce();
    const silent = engine({ loadTdt: () => Float64Array.of(0) });
    expect(() =>
      codecFromModule(moduleOf(silent)).read(new Uint8Array(), "A.TDT"),
    ).toThrow("This SimTower save couldn't be read.");
  });

  it("throws when the tower cannot be adopted", () => {
    expect(() =>
      codecFromModule(
        moduleOf(
          engine({
            adoptTdt: () => Float64Array.of(0),
            lastReason: () => "Cannot adopt.",
          }),
        ),
      ).read(new Uint8Array(), "A"),
    ).toThrow("Cannot adopt.");
    expect(() =>
      codecFromModule(
        moduleOf(engine({ adoptTdt: () => Float64Array.of(0) })),
      ).read(new Uint8Array(), "A"),
    ).toThrow("This SimTower save couldn't be read.");
  });

  it("writes a tower into its record and bytes, and frees the engine", () => {
    const e = engine();
    const written = codecFromModule(moduleOf(e)).write("{}");
    expect(Array.from(written.bytes)).toEqual([1, 2, 3]);
    expect(e.free).toHaveBeenCalledOnce();
  });

  it("throws the engine's reason when the export is refused, or a plain sentence without one", () => {
    const refused = engine({
      tdtExport: () => Float64Array.of(0),
      lastReason: () => "Too tall.",
    });
    expect(() => codecFromModule(moduleOf(refused)).write("{}")).toThrow(
      "Too tall.",
    );
    expect(refused.free).toHaveBeenCalledOnce();
    expect(() =>
      codecFromModule(
        moduleOf(engine({ tdtExport: () => Float64Array.of(0) })),
      ).write("{}"),
    ).toThrow("Export failed.");
    expect(() =>
      codecFromModule(moduleOf(engine({ tdtFile: () => undefined }))).write(
        "{}",
      ),
    ).toThrow("Export failed.");
  });
});

describe("the installed codec", () => {
  it("says the package is unavailable until one is installed", () => {
    expect(() => tdtCodec()).toThrow(TDT_UNAVAILABLE);
    const stub: TdtCodec = { read: vi.fn(), write: vi.fn() };
    useTdtCodec(stub);
    expect(tdtCodec()).toBe(stub);
  });

  it("installs a codec on a loaded package once", async () => {
    const load = vi.fn(async () => moduleOf(engine()));
    await prepareTdtCodec(load);
    await prepareTdtCodec(load);
    expect(load).toHaveBeenCalledOnce();
    expect(tdtCodec().write("{}").bytes.length).toBe(3);
  });

  it("names the load failure when the package cannot be loaded", async () => {
    await prepareTdtCodec(async () => {
      throw new Error("no wasm");
    });
    expect(() => tdtCodec()).toThrow(`${TDT_UNAVAILABLE} (no wasm)`);
    await prepareTdtCodec(async () => {
      throw "plain";
    });
    expect(() => tdtCodec()).toThrow(`${TDT_UNAVAILABLE} (plain)`);
  });
});
