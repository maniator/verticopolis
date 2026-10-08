import { createHash } from "node:crypto";

/**
 * Canonical JSON for the engine conformance suite (conformance/README.md).
 *
 * Every engine that claims parity must reproduce these bytes exactly, so this
 * writes the text itself instead of trusting a JSON library's defaults (a
 * JavaScript object, for one, always lists integer-like keys first):
 *
 * - Values are plain objects, arrays, strings, finite numbers, booleans and
 *   null. Anything else (a Map, a Set, a class instance, a function, a
 *   non-finite number, an array hole or an `undefined` array element) throws,
 *   so a value the rules cannot describe never reaches a pinned hash.
 * - An object key whose value is `undefined` is left out.
 * - Object keys are sorted by UTF-16 code unit order at every depth. Arrays
 *   keep their order.
 * - Numbers print as ECMAScript `Number.prototype.toString` does (shortest
 *   round-trip form, `1e+21` style exponents, `-0` prints as `0`).
 * - Strings are escaped as `JSON.stringify` escapes them. No whitespace.
 */
export function canonicalJson(value: unknown, path = "$"): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error(`canonicalJson: non-finite number at ${path}`);
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new Error(`canonicalJson: ${typeof value} at ${path}`);
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) {
      if (!(i in value) || value[i] === undefined) throw new Error(`canonicalJson: missing array element at ${path}[${i}]`);
      parts.push(canonicalJson(value[i], `${path}[${i}]`));
    }
    return `[${parts.join(",")}]`;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) throw new Error(`canonicalJson: non-plain object at ${path}`);
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  // Array.prototype.sort with no comparator orders strings by UTF-16 code units.
  for (const k of Object.keys(obj).sort()) {
    if (obj[k] === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalJson(obj[k], `${path}.${k}`)}`);
  }
  return `{${parts.join(",")}}`;
}

/** First 16 hex digits of the SHA-256 of the canonical JSON's UTF-8 bytes. */
export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex").slice(0, 16);
}
