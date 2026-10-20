import type { WasmModule } from "../../dualrun/binding";
import type { Scenario } from "./scenarios";

/**
 * Hourly save churn (release plan 9.2, RUN-0b): how much of the serialized
 * save changes from one in-game hour to the next, on the WASM engine in
 * Node. A "changed since last sent" contract (S6's design A) sends only the
 * changed part, so this is the share of the save it would send each hour.
 *
 * The save is cut into units: each element of a top-level array, each
 * property of a top-level object, and every other top-level value whole. A
 * unit counts as changed when its JSON text differs from the unit at the
 * same path an hour earlier or the path is new. An array whose elements
 * shift position counts them all as changed, which is what a positional
 * delta would send. A unit that disappears counts as changed at the size it
 * had, since that contract has to send the removal. Sizes are characters of
 * each unit's JSON text; the keys and punctuation between units are not
 * counted, so a save's character total here is smaller than its serialized
 * size. The median is the lower of the two middle hours when the count is even.
 */

export interface ChurnHour {
  hour: number;
  changedChars: number;
  totalChars: number;
  share: number;
}

export interface ChurnReport {
  scenario: string;
  saveChars: number;
  hours: number;
  hourly: ChurnHour[];
  medianShare: number;
  p95Share: number;
  maxShare: number;
  /** Per top-level section: its share of the save and its median hourly churn
   *  as a share of its own size. */
  sections: Record<string, { saveShare: number; medianChurn: number }>;
}

/** Joins a top-level key and a unit's name so no two paths collide, whatever characters the keys hold. */
const SEP = "\u0000";

export function churnUnits(save: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (save === null || typeof save !== "object" || Array.isArray(save)) {
    out.set("", JSON.stringify(save));
    return out;
  }
  for (const [key, value] of Object.entries(save)) {
    if (Array.isArray(value)) value.forEach((v, i) => out.set(`${key}${SEP}${i}`, JSON.stringify(v)));
    else if (value !== null && typeof value === "object") for (const [k, v] of Object.entries(value)) out.set(`${key}${SEP}${k}`, JSON.stringify(v));
    else out.set(key, JSON.stringify(value));
  }
  return out;
}

const sectionOf = (path: string): string => path.split(SEP, 1)[0];

/** Characters changed and total, overall and per section. */
export function churnBetween(prev: Map<string, string>, next: Map<string, string>): { changed: number; total: number; sections: Record<string, { changed: number; total: number }> } {
  let changed = 0;
  let total = 0;
  const sections: Record<string, { changed: number; total: number }> = {};
  for (const [path, text] of next) {
    const s = (sections[sectionOf(path)] ??= { changed: 0, total: 0 });
    total += text.length;
    s.total += text.length;
    if (prev.get(path) !== text) {
      changed += text.length;
      s.changed += text.length;
    }
  }
  for (const [path, text] of prev) {
    if (next.has(path)) continue;
    const s = (sections[sectionOf(path)] ??= { changed: 0, total: 0 });
    total += text.length;
    changed += text.length;
    s.total += text.length;
    s.changed += text.length;
  }
  return { changed, total, sections };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}

const median = (xs: number[]): number => quantile([...xs].sort((a, b) => a - b), 0.5);

/**
 * Run `hours` in-game hours in `dt`-minute steps and measure each hour's churn,
 * after `warmSteps` steps that keep the load transient out of hour 1. `dt` must
 * divide 60 so that an hour is exactly 60 in-game minutes.
 */
export function measureChurn(mod: WasmModule, sc: Scenario, hours: number, dt: number, warmSteps = 0): ChurnReport {
  if (!(dt > 0) || !Number.isInteger(60 / dt)) throw new Error(`dt ${dt} does not divide an hour; churn hours would not be 60 minutes`);
  const stepsPerHour = 60 / dt;
  const e = mod.Engine.fromSave(sc.save);
  try {
    for (let i = 0; i < warmSteps; i++) e.tick(dt);
    let prev = churnUnits(JSON.parse(e.serialize()));
    const hourly: ChurnHour[] = [];
    const perSection: Record<string, number[]> = {};
    const sectionChars: Record<string, number> = {};
    let saveChars = 0;
    for (let hour = 1; hour <= hours; hour++) {
      for (let i = 0; i < stepsPerHour; i++) e.tick(dt);
      const next = churnUnits(JSON.parse(e.serialize()));
      const c = churnBetween(prev, next);
      hourly.push({ hour, changedChars: c.changed, totalChars: c.total, share: c.total > 0 ? c.changed / c.total : 0 });
      for (const [name, s] of Object.entries(c.sections)) {
        (perSection[name] ??= []).push(s.total > 0 ? s.changed / s.total : 0);
        sectionChars[name] = (sectionChars[name] ?? 0) + s.total;
      }
      saveChars += c.total;
      prev = next;
    }
    const shares = hourly.map((h) => h.share).sort((a, b) => a - b);
    return {
      scenario: sc.name,
      saveChars: hourly.length ? Math.round(saveChars / hourly.length) : 0,
      hours,
      hourly,
      medianShare: quantile(shares, 0.5),
      p95Share: quantile(shares, 0.95),
      maxShare: shares[shares.length - 1] ?? NaN,
      sections: Object.fromEntries(Object.entries(perSection).map(([name, xs]) => [name, { saveShare: saveChars > 0 ? sectionChars[name] / saveChars : 0, medianChurn: median(xs) }])),
    };
  } finally {
    e.free();
  }
}
