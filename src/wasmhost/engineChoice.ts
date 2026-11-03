/**
 * The engine names analytics reports in the `requested` field of its engine
 * rows. The game always runs the Rust engine now; the other names stay in the
 * type so rows from older builds keep their meaning.
 */
export type EngineChoice = "ts" | "wasm" | "wasm-frame" | "wasm-worker";
