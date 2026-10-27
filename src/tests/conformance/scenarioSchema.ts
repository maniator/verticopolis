import type { FacilityKind } from "../../engine/types";
import { FACILITIES } from "../../engine/facilitiesData";

/** Field types: "int" a whole number, "u32" a whole number from 0 to
 *  4294967295, "count" a whole number above zero, "dir" 1 or -1, "num" a finite
 *  number, "str" a non-empty string, "bool" a boolean, "place" a facility kind
 *  that is not a transport, "shaft" a transport kind, "mode" classic or modern,
 *  "obj" a JSON object, "kind" any facility kind, "choice" fireRescue or
 *  bombThreat, "policy" a film policy, "target" a batch rent target (a finite
 *  number, default or noRate), "end" up or down, "method" sell or bulldoze, "star" a whole number from 1 to 5.
 *  A trailing "?" marks the field optional. */
export type FieldType = "int" | "u32" | "count" | "dir" | "num" | "str" | "bool" | "place" | "shaft" | "mode" | "obj" | "kind" | "choice" | "policy" | "target" | "end" | "method" | "star";

function fits(type: FieldType, v: unknown): boolean {
  switch (type) {
    case "int": return Number.isInteger(v);
    case "u32": return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;
    case "count": return Number.isInteger(v) && (v as number) > 0;
    case "dir": return v === 1 || v === -1;
    case "num": return typeof v === "number" && Number.isFinite(v);
    case "str": return typeof v === "string" && v.length > 0;
    case "bool": return typeof v === "boolean";
    case "place": return typeof v === "string" && own(FACILITIES, v) && !FACILITIES[v as FacilityKind].transport;
    case "shaft": return typeof v === "string" && own(FACILITIES, v) && !!FACILITIES[v as FacilityKind].transport;
    case "mode": return v === "classic" || v === "modern";
    case "obj": return typeof v === "object" && v !== null && !Array.isArray(v);
    case "kind": return typeof v === "string" && own(FACILITIES, v);
    case "choice": return v === "fireRescue" || v === "bombThreat";
    case "policy": return v === "auto" || v === "feature" || v === "blockbuster";
    case "target": return v === "default" || v === "noRate" || (typeof v === "number" && Number.isFinite(v));
    case "end": return v === "up" || v === "down";
    case "method": return v === "sell" || v === "bulldoze";
    case "star": return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5;
  }
}

export const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export type Spec = Record<string, `${FieldType}` | `${FieldType}?`>;

export function check(where: string, value: unknown, spec: Spec, skip: string[] = []): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${where}: must be an object`);
  const obj = value as Record<string, unknown>;
  for (const k of Object.keys(obj)) if (!skip.includes(k) && !own(spec, k)) throw new Error(`${where}: unknown field ${k}`);
  for (const [k, t] of Object.entries(spec)) {
    if (obj[k] === undefined && t.endsWith("?")) continue;
    if (!fits(t.replace("?", "") as FieldType, obj[k])) throw new Error(`${where}: ${k} must be ${t.replace("?", "")}`);
  }
}
