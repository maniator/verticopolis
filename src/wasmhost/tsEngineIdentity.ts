/**
 * The TypeScript engine's identity (#1422, owner 2026-10-28): a pinned
 * version and the hash of its sources, for the version line, Help's
 * diagnostics and a crash report, as the Rust engine reports its crate
 * version and its binary's source hash. The engine is frozen for 3.0 and
 * leaves in 3.x, so the version only moves when its rules do; the source
 * hash (`src/build/tsEngineSources.ts`) moves with any change to its code.
 */
export const TS_ENGINE_VERSION = "2.0";

/** SHA-256 of `src/engine`'s sources, from the build. */
export const TS_ENGINE_SOURCES: string =
  typeof __TS_ENGINE_SOURCES__ === "string" ? __TS_ENGINE_SOURCES__ : "unknown";
