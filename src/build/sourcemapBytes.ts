/**
 * Which source each byte of an emitted script came from, read from its
 * sourcemap: every mapped segment runs from its generated column to the next
 * segment on the same line (or the line's end) and is charged to the segment's
 * source. Bytes before a line's first segment, and segments with no source,
 * are "unmapped". Used by scripts/engine-bundle-size.ts to measure how much of
 * the shipped JavaScript is the TypeScript engine
 * (docs/performance/wasm-only-bundle.md).
 *
 * Keep this file ERASABLE (no enums, namespaces or parameter properties).
 */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decode one Base64 VLQ segment into its fields. Throws on a character
 *  outside the alphabet or a value cut off mid-number. */
export function decodeVlq(segment: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (const ch of segment) {
    const digit = B64.indexOf(ch);
    if (digit === -1) throw new Error(`not a base64 VLQ character: ${JSON.stringify(ch)}`);
    value += (digit & 31) * 2 ** shift;
    if (digit & 32) {
      shift += 5;
    } else {
      out.push(value % 2 === 1 ? -(value - 1) / 2 : value / 2);
      value = 0;
      shift = 0;
    }
  }
  if (shift !== 0) throw new Error(`a VLQ value runs past the end of ${JSON.stringify(segment)}`);
  return out;
}

export const UNMAPPED = "(unmapped)";

/** Generated characters per source, and the text of each source's spans
 *  (for compressing one source's share on its own). Counts UTF-16 code
 *  units, the unit sourcemap columns use; the minified output is ASCII in
 *  practice, so this is its byte count. */
export function bytesBySource(code: string, map: { sources: string[]; mappings: string }): { bytes: Map<string, number>; text: Map<string, string[]> } {
  const bytes = new Map<string, number>();
  const text = new Map<string, string[]>();
  const add = (source: string, span: string) => {
    if (span.length === 0) return;
    bytes.set(source, (bytes.get(source) ?? 0) + span.length);
    let t = text.get(source);
    if (!t) text.set(source, (t = []));
    t.push(span);
  };
  const lines = code.split("\n");
  const groups = map.mappings.split(";");
  let src = 0;
  groups.forEach((line, li) => {
    const textLine = lines[li] ?? "";
    let col = 0;
    const points: { col: number; source: number | null }[] = [];
    for (const seg of line.split(",")) {
      if (seg === "") continue;
      const f = decodeVlq(seg);
      col += f[0];
      if (f.length > 1) src += f[1];
      points.push({ col, source: f.length > 1 ? src : null });
    }
    add(UNMAPPED, textLine.slice(0, points[0]?.col ?? textLine.length));
    points.forEach((p, i) => {
      const end = i + 1 < points.length ? points[i + 1].col : textLine.length;
      add(p.source === null ? UNMAPPED : (map.sources[p.source] ?? UNMAPPED), textLine.slice(p.col, end));
    });
  });
  // Lines past the last mappings group (the sourceMappingURL comment, say)
  // have no segments at all.
  for (let li = groups.length; li < lines.length; li++) add(UNMAPPED, lines[li]);
  return { bytes, text };
}
