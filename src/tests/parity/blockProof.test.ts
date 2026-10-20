import { expect, it } from "vitest";
import { onWasmParityProject } from "./typescriptOnly";

// Throwaway proof for #1082: fails only on the WASM parity projects. Never merge.
it("fails on the WASM parity projects only (#1082 proof)", () => {
  expect(onWasmParityProject()).toBe(false);
});
