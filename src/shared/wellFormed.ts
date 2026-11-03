/**
 * `String.prototype.toWellFormed`: the string with every lone UTF-16
 * surrogate replaced by U+FFFD. A name typed into a box that limits length in
 * UTF-16 units can end in half of an emoji's pair; the Rust engine cannot hold
 * that half and reads it as U+FFFD (`load::parse_save_json`, and wasm-bindgen
 * for strings passed to it), so the TypeScript engine repairs the same strings
 * the same way and both engines keep one tower name.
 *
 * Written as "match a well-formed pair or a lone half, keep the pair" rather
 * than with lookbehind, which is a parse-time SyntaxError on Safari below
 * 16.4, and rather than calling `toWellFormed`, which is newer than the
 * build's ES2020 library.
 */
export function wellFormed(s: string): string {
  return s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (m) => (m.length === 2 ? m : "\uFFFD"));
}
