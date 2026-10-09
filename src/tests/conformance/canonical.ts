import { createHash } from "node:crypto";
import { canonicalJson } from "../../engine/canonicalJson";

/**
 * The conformance hash (conformance/README.md): the canonical JSON lives in
 * the engine (`src/engine/canonicalJson.ts`, browser-safe); the digest needs
 * Node's crypto and stays here with the tests.
 */
export { canonicalJson };

/** First 16 hex digits of the SHA-256 of the canonical JSON's UTF-8 bytes. */
export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex").slice(0, 16);
}
