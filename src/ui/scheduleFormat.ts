import { floorLabel } from "./templates/elevatorSchedule";

/**
 * Pure string formatters for the Schedule dialog's derived sentences (#305).
 * Split from the controller so the pinned copy (spec §11) has one DOM-free
 * home the controller and tests share.
 */

/** `8` to `08:00`. */
export const hh = (h: number): string => `${String(h).padStart(2, "0")}:00`;

/** Compress an ascending hour list into ranges ("07:00–10:00, 13:00") so a
 *  long advice stretch reads as one span, not a two-line comma flood (§11). */
export function fmtHours(hs: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < hs.length; ) {
    let j = i;
    while (j + 1 < hs.length && hs[j + 1] === hs[j] + 1) j++;
    parts.push(j > i ? `${hh(hs[i])}–${hh(hs[j])}` : hh(hs[i]));
    i = j + 1;
  }
  return parts.join(", ");
}

/** The Simulate origin clause (#465): the specced "where the rush originates"
 *  read, appended only once origins have measured mass. A contiguous band reads
 *  as a range; scattered floors list out; one floor names itself. */
export function originClause(fs: number[]): string {
  if (fs.length === 0) return "";
  const asc = [...fs].sort((a, b) => a - b);
  if (asc.length === 1) return ` Most riders board at Floor ${floorLabel(asc[0])}.`;
  const contiguous = asc.every((f, i) => i === 0 || f === asc[i - 1] + 1);
  if (contiguous) return ` Most riders board on floors ${floorLabel(asc[0])}–${floorLabel(asc[asc.length - 1])}.`;
  return ` Most riders board on floors ${asc.map(floorLabel).join(", ")}.`;
}
