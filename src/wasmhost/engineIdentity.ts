import type { WasmModule } from "../dualrun/binding";

/**
 * The engine's own identity record (#963): which crate, which save, frame
 * layout and catalog contracts, and the conformance lock the engine was built
 * against. The Rust engine writes it (`engine-rs/src/identity.rs`); this file
 * only reads it back, so no identity value is spelled in the frontend.
 */
export interface EngineIdentity {
  schema: number;
  crate: { name: string; version: string };
  saveVersion: number;
  oldestSaveVersion: number;
  frameLayoutVersion: number;
  catalogVersion: number;
  catalogDigests: { classic: string; modern: string };
  lockDigest: string;
}

/** The engine's record text, or undefined when the package has no such call
 *  or it throws. About reports the gap, so a missing identity never stops a
 *  boot. */
export function readEngineIdentity(
  mod: Pick<WasmModule, "engineIdentity">,
): string | undefined {
  try {
    return typeof mod.engineIdentity === "function"
      ? mod.engineIdentity()
      : undefined;
  } catch {
    return undefined;
  }
}

const isString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;
const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The record from its text, or null when the text is missing, is not JSON or
 *  lacks a field. A record from a newer schema with extra fields still reads. */
export function parseEngineIdentity(
  text: string | undefined,
): EngineIdentity | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || !isObject(raw.crate) || !isObject(raw.catalogDigests))
    return null;
  const {
    schema,
    saveVersion,
    oldestSaveVersion,
    frameLayoutVersion,
    catalogVersion,
    lockDigest,
  } = raw;
  const { name, version } = raw.crate;
  const { classic, modern } = raw.catalogDigests;
  if (
    !isCount(schema) ||
    !isCount(saveVersion) ||
    !isCount(oldestSaveVersion) ||
    !isCount(frameLayoutVersion) ||
    !isCount(catalogVersion)
  )
    return null;
  if (
    !isString(lockDigest) ||
    !isString(name) ||
    !isString(version) ||
    !isString(classic) ||
    !isString(modern)
  )
    return null;
  return {
    schema,
    crate: { name, version },
    saveVersion,
    oldestSaveVersion,
    frameLayoutVersion,
    catalogVersion,
    catalogDigests: { classic, modern },
    lockDigest,
  };
}
