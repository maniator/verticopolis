import { describe, expect, it } from "vitest";
import { engineRequested } from "./engineChoice";

const storage = (v: string | null) => ({ getItem: () => v });

describe("engineRequested", () => {
  it("defaults to the TypeScript engine", () => {
    expect(engineRequested({ search: "" }, storage(null))).toBe("ts");
    expect(engineRequested({ search: "" }, null)).toBe("ts");
  });
  it("takes the query first, then the stored choice", () => {
    expect(engineRequested({ search: "?engine=wasm" }, storage(null))).toBe("wasm");
    expect(engineRequested({ search: "" }, storage("wasm"))).toBe("wasm");
    expect(engineRequested({ search: "?engine=ts" }, storage("wasm"))).toBe("ts");
    expect(engineRequested({ search: "?engine=rust" }, storage(null))).toBe("ts");
  });
  it("picks the experimental hosts only when asked by name", () => {
    expect(engineRequested({ search: "?engine=wasm-worker" }, storage(null))).toBe("wasm-worker");
    expect(engineRequested({ search: "?engine=wasm-frame" }, storage("wasm"))).toBe("wasm-frame");
    expect(engineRequested({ search: "" }, storage("wasm-worker"))).toBe("wasm-worker");
    expect(engineRequested({ search: "?engine=ts" }, storage("wasm-worker"))).toBe("ts");
    expect(engineRequested({ search: "?engine=worker" }, storage(null))).toBe("ts");
  });
  it("treats a throwing storage as unset", () => {
    expect(engineRequested({ search: "" }, { getItem: () => { throw new Error("blocked"); } })).toBe("ts");
  });
});
