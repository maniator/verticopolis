/**
 * What play alone changes in a save (#1664). The engine leaves default and empty fields out when it
 * serializes, so a tower that plays for a while loses some paths and shortens some lists with no
 * older build involved. The engine step records those paths by playing each candidate-written save on
 * the candidate engine itself; the browser layer then fails only on a loss that is not in that set
 * (or in the owner's allowed-loss list). Node only and ERASABLE, like its siblings.
 */
import { diffSaves, type DiffEntry, type EnginePackage } from "./rollbackRehearsal.ts";

/** Loss key to how much play alone lost there (places for a dropped field, elements for a shorter list). */
export type ChurnCounts = Record<string, number>;

/** Fixture name (without `.json`) to the losses play alone produced for it. */
export type ChurnMap = Record<string, ChurnCounts>;

/** Game hours the candidate plays each save to find its own churn: longer than any browser verify. */
export const CHURN_HOURS = 24;
const STEP_MINUTES = 2;
const MINUTES_PER_HOUR = 60;
/** The save is diffed after this many ticks (10 game minutes), so a list that shrinks and regrows inside that span is the one thing it can miss. */
const TICKS_PER_CHECK = 5;

/** A dropped field, or a list that came back shorter in at least one place. */
export const isLoss = (d: DiffEntry): boolean => d.kind === "dropped" || (d.kind === "changed" && (d.removed ?? 0) > 0);

export const lossKey = (d: DiffEntry): string => `${d.kind} ${d.path}`;

/** How much a loss took: a dropped field counts each place, a list counts the elements it lost. */
export const lossCount = (d: DiffEntry): number => (d.kind === "dropped" ? d.count : (d.removed ?? 0));

/** The losses between a save and the same save after play, by key, with how much was lost. */
export function churnOf(before: unknown, after: unknown): ChurnCounts {
  const out: ChurnCounts = {};
  for (const d of diffSaves(before, after).filter(isLoss)) out[lossKey(d)] = lossCount(d);
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k] as number]));
}

/**
 * The candidate engine loads the save and plays `hours` game hours. Every 10 game minutes the serialized save is diffed
 * against the save text itself (the same text the browser seeds and compares against, so a field the load already leaves out
 * counts too), and each key keeps the most it lost at any checkpoint: a list that shrinks early and regrows later still counts.
 */
export function playChurn(candidate: EnginePackage, saveText: string, hours: number = CHURN_HOURS): ChurnCounts {
  const engine = candidate.fromSave(saveText);
  try {
    const seeded: unknown = JSON.parse(saveText);
    const mostLost: ChurnCounts = {};
    const ticks = Math.ceil((hours * MINUTES_PER_HOUR) / STEP_MINUTES);
    for (let done = 0; done < ticks; ) {
      for (let i = 0; i < TICKS_PER_CHECK && done < ticks; i++, done++) engine.tick(STEP_MINUTES);
      for (const [key, n] of Object.entries(churnOf(seeded, JSON.parse(engine.serialize())))) mostLost[key] = Math.max(mostLost[key] ?? 0, n);
    }
    return Object.fromEntries(Object.keys(mostLost).sort().map((k) => [k, mostLost[k] as number]));
  } finally {
    engine.free();
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A churn file's content, or a clear reason it is not one. */
export function parseChurn(json: unknown): ChurnMap {
  if (!isObject(json)) throw new Error("the churn file is not an object of fixture name to loss counts");
  const out: ChurnMap = {};
  for (const [name, counts] of Object.entries(json)) {
    if (!isObject(counts) || Object.values(counts).some((n) => typeof n !== "number" || !Number.isInteger(n) || n < 1)) throw new Error(`the churn entry for ${name} is not an object of loss key to a count of one or more`);
    out[name] = counts as ChurnCounts;
  }
  return out;
}

export interface Classified {
  /** Losses to fail on (before the allowed-loss list is applied). */
  failing: DiffEntry[];
  /** Losses play alone explains, or nested ones when there is no churn record: listed for a person, never a failure. */
  review: DiffEntry[];
}

/** A top-level key of the save, as opposed to a path inside a list or an object. */
const isTopLevel = (d: DiffEntry): boolean => !d.path.includes(".") && !d.path.includes("[");

/**
 * Sort a rewritten save's losses. With a churn record a loss fails unless play alone makes it in at least as
 * many places; without one only a dropped top-level field fails and the nested rest is listed for review.
 */
export function classifyLosses(losses: readonly DiffEntry[], churn: ChurnCounts | undefined): Classified {
  const out: Classified = { failing: [], review: [] };
  for (const d of losses) {
    const fails = churn ? lossCount(d) > (churn[lossKey(d)] ?? 0) : d.kind === "dropped" && isTopLevel(d);
    (fails ? out.failing : out.review).push(d);
  }
  return out;
}
