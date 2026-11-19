import { COMPONENT_FIXTURES } from "../packagePaths";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCatalog } from "@verticopolis/components/binding/catalog";
import { MAX_BRUSH_TILES } from "@verticopolis/components/port/request";

/** The Rust engine's Classic catalog as checked in (the file `catalogFor` in
 *  `src/tests/catalogFixture.ts` reads; `portReads.integration.test.ts` holds
 *  it to the engine), from the installed components package. */
const CLASSIC_CATALOG = resolve(COMPONENT_FIXTURES, "catalog.classic.json");

/** Each facility kind the engine lists, with its transport flag. Every mode's
 *  catalog lists every kind (a Modern-only one carries `modernOnly`), so the
 *  Classic one names them all. */
const TRANSPORT_BY_KIND: ReadonlyMap<string, boolean> = new Map(
  readCatalog({ catalog: () => readFileSync(CLASSIC_CATALOG, "utf8") }, "classic").facilities.map((f) => [f.key, f.transport]),
);

/** Field types: "int" a whole number, "u32" a whole number from 0 to
 *  4294967295, "count" a whole number above zero, "dir" 1 or -1, "num" a finite
 *  number, "str" a non-empty string, "bool" a boolean, "place" a facility kind
 *  that is not a transport, "shaft" a transport kind, "mode" classic or modern,
 *  "obj" a JSON object, "kind" any facility kind, "choice" fireRescue or
 *  bombThreat, "policy" a film policy, "target" a batch rent target (a finite
 *  number, default or noRate), "end" up or down, "method" sell or bulldoze, "star" a whole number from 1 to 5,
 *  "brush" floor or lobby, "tiles" a non-empty list of whole numbers no longer
 *  than one brush takes (`MAX_BRUSH_TILES`). A trailing "?" marks the field optional. */
export type FieldType = "int" | "u32" | "count" | "dir" | "num" | "str" | "bool" | "place" | "shaft" | "mode" | "obj" | "kind" | "choice" | "policy" | "target" | "end" | "method" | "star" | "brush" | "tiles";

function fits(type: FieldType, v: unknown): boolean {
  switch (type) {
    case "int": return Number.isInteger(v);
    case "u32": return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;
    case "count": return Number.isInteger(v) && (v as number) > 0;
    case "dir": return v === 1 || v === -1;
    case "num": return typeof v === "number" && Number.isFinite(v);
    case "str": return typeof v === "string" && v.length > 0;
    case "bool": return typeof v === "boolean";
    case "place": return typeof v === "string" && TRANSPORT_BY_KIND.get(v) === false;
    case "shaft": return typeof v === "string" && TRANSPORT_BY_KIND.get(v) === true;
    case "mode": return v === "classic" || v === "modern";
    case "obj": return typeof v === "object" && v !== null && !Array.isArray(v);
    case "kind": return typeof v === "string" && TRANSPORT_BY_KIND.has(v);
    case "choice": return v === "fireRescue" || v === "bombThreat";
    case "policy": return v === "auto" || v === "feature" || v === "blockbuster";
    case "target": return v === "default" || v === "noRate" || (typeof v === "number" && Number.isFinite(v));
    case "end": return v === "up" || v === "down";
    case "method": return v === "sell" || v === "bulldoze";
    case "star": return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5;
    case "brush": return v === "floor" || v === "lobby";
    case "tiles": return Array.isArray(v) && v.length > 0 && v.length <= MAX_BRUSH_TILES && v.every((t) => Number.isInteger(t));
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
