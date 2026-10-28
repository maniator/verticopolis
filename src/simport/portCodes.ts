import type { FacilityKind } from "../engine/types";
import type { EnginePort, PortRecord } from "./enginePort";

/** The code tables a caller passes names through, as `viewLayout()` names
 *  them. */
export type CodeTable = "kinds" | "modes" | "calendars" | "filmPolicies" | "logKinds" | "heatModes";

/** What a command's record says, in the shape the game's callers check. */
export interface PortOutcome {
  readonly ok: boolean;
  /** The refusal text, from `lastReason()`; only on a refusal. */
  readonly reason?: string;
  /** The money delta the engine measured around the command. */
  readonly delta: number;
}

interface Tables extends Record<CodeTable, readonly string[]> {
  records: Record<string, readonly string[]>;
}

/**
 * The layout tables the game's callers need to speak to an `EnginePort`
 * (contract sections 1 and 4), read once from the port's own `viewLayout()`
 * so the game imports no engine at runtime. Build one per app; the layout
 * does not change across a swap.
 */
export class PortCodes {
  private readonly maps = new Map<CodeTable, ReadonlyMap<string, number>>();
  private readonly records: Record<string, readonly string[]>;

  constructor(port: Pick<EnginePort, "viewLayout">) {
    const l = JSON.parse(port.viewLayout()) as Tables;
    for (const t of ["kinds", "modes", "calendars", "filmPolicies", "logKinds", "heatModes"] as const) {
      this.maps.set(t, new Map(l[t].map((n, i) => [n, i])));
    }
    this.records = l.records;
  }

  /** The code for `name` in `table`, or NaN for a name the table lacks (the
   *  port refuses a NaN code as an invalid request). */
  code(table: CodeTable, name: string): number {
    return this.maps.get(table)!.get(name) ?? NaN;
  }

  kind(kind: FacilityKind): number {
    return this.code("kinds", kind);
  }

  /** Slot `name` of `op`'s record, or NaN when the record has no such slot. */
  slot(rec: PortRecord, op: string, name: string): number {
    const at = this.records[op]?.indexOf(name) ?? -1;
    return at < 0 ? NaN : rec[at];
  }
}

/** Read a command's record. Call it right after the command, before the next
 *  status-producing member replaces `lastReason()`. */
export function outcome(port: Pick<EnginePort, "lastReason">, rec: PortRecord): PortOutcome {
  if (rec[0] === 1) return { ok: true, delta: rec[1] };
  return { ok: false, reason: port.lastReason(), delta: rec[1] };
}
