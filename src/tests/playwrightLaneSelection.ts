const SPEC_SUFFIX = "\\.spec\\.ts$";

export const DUAL_LANE_SPECS = ["engineIntegrity"] as const;
export const SWITCHABLE_ONLY_SPECS = ["engineIdentity", "saveWithoutRust", "engineStatusRows", "atlas", "visual", "perf"] as const;
export const SWITCHABLE_LANE_SPECS = [...SWITCHABLE_ONLY_SPECS, ...DUAL_LANE_SPECS] as const;

const toNamePattern = (names: readonly string[]) => names.join("|");

export const SWITCHABLE_ONLY_SPEC = toNamePattern(SWITCHABLE_ONLY_SPECS);
export const SWITCHABLE_LANE_SPEC = toNamePattern(SWITCHABLE_LANE_SPECS);
export const SWITCHABLE_ONLY_SPEC_PATTERN = new RegExp(`^(?:.*(?:${SWITCHABLE_ONLY_SPEC})${SPEC_SUFFIX})`);
export const GENERAL_SPEC_PATTERN = new RegExp(`^(?!.*(?:${SWITCHABLE_LANE_SPEC})${SPEC_SUFFIX}).*${SPEC_SUFFIX}`);

const WASM_ONLY_SPEC_PATTERN = /wasmOnly\.spec\.ts$/;
const VISUAL_SPEC_PATTERN = /visual\.spec\.ts$/;

export function runsInSwitchable(specPath: string): boolean {
  return !WASM_ONLY_SPEC_PATTERN.test(specPath) && !GENERAL_SPEC_PATTERN.test(specPath);
}

export function runsInWasmOnly(specPath: string): boolean {
  return !VISUAL_SPEC_PATTERN.test(specPath) && !SWITCHABLE_ONLY_SPEC_PATTERN.test(specPath);
}
