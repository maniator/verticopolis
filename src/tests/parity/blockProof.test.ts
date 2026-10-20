import { expect, it } from "vitest";

// Throwaway proof for #1082: fails only on the WASM parity projects. Never merge.
it("fails on the WASM parity projects only (#1082 proof)", () => {
  expect((globalThis as Record<string, unknown>).__vcWasmParityProject).not.toBe(true);
});
