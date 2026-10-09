/**
 * The gameplay event catalog (`conformance/events/catalog.json`) as data:
 * its shape, the payload rule both engines hold it to, a check for one
 * drained event, and the renderer that writes `src/engine/gameplayEvents.d.ts`
 * from it (`npm run gen:events`, and `npm run wasm:build`). The Rust twin is
 * `engine-rs/src/gameplay.rs` (`check_catalog`, `check_event`). Pure: no file
 * access here, so the script and the tests hand it the parsed catalog.
 */

export interface CatalogEnumField {
  type: "enum";
  /** The name of a set in {@link GameplayCatalog.enums}. */
  enum: string;
}

export interface CatalogIntegerField {
  type: "integer";
  min: number;
  max: number;
}

export type CatalogField = CatalogEnumField | CatalogIntegerField;

export interface CatalogEvent {
  name: string;
  version: number;
  cardinality: "per_occurrence" | "per_tower";
  semantics: string;
  payload: Record<string, CatalogField>;
  history: string;
}

export interface GameplayCatalog {
  catalogVersion: number;
  about: string;
  enums: Record<string, string[]>;
  events: CatalogEvent[];
}

/** The widest bound an integer field may declare: payloads carry small
 *  integers, never a money figure. */
const INTEGER_LIMIT = 100_000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
/** Prose the generated declaration carries in a doc comment: non-empty and
 *  unable to close that comment early. */
const prose = (v: unknown): v is string => nonEmpty(v) && !v.includes("*/");
/** An event name, and an enum set or payload field name (both become
 *  TypeScript identifiers in the generated declaration). */
const EVENT_NAME = /^[a-z][a-z0-9_]*$/;
const CAMEL_NAME = /^[a-z][A-Za-z0-9]*$/;
/** Enum set names whose generated type would collide with one the
 *  declaration already exports. */
const RESERVED_SETS = new Set(["catalogVersion", "event", "eventName", "eventPayloads", "eventVersions"]);
/** A whole number JavaScript holds exactly, the range both checkers read. */
const whole = (v: unknown): v is number => Number.isSafeInteger(v);

/** Throw unless `raw` is a well-formed catalog whose every payload field is
 *  a closed enum the catalog defines or a bounded integer. A string, number,
 *  boolean or any other field type is refused, so free text, a tower name or
 *  a money amount cannot enter the contract. The twin of `check_catalog` in
 *  `engine-rs/src/gameplay.rs`; both refuse the same catalogs. */
export function checkCatalog(raw: unknown): GameplayCatalog {
  if (!isObject(raw)) throw new Error("catalog: must be an object");
  if (!whole(raw.catalogVersion) || raw.catalogVersion < 1) throw new Error("catalog: catalogVersion must be a whole number from 1");
  if (!prose(raw.about)) throw new Error("catalog: about must be a non-empty string without */");
  const enums = raw.enums;
  if (!isObject(enums)) throw new Error("catalog: enums must be an object");
  for (const [name, values] of Object.entries(enums)) {
    if (!CAMEL_NAME.test(name)) throw new Error(`enum ${name}: name must be camelCase`);
    if (RESERVED_SETS.has(name)) throw new Error(`enum ${name}: name is reserved by the generated declaration`);
    if (!Array.isArray(values) || values.length === 0) throw new Error(`enum ${name}: must be a non-empty array`);
    const seen = new Set<string>();
    for (const v of values) {
      if (!nonEmpty(v)) throw new Error(`enum ${name}: values must be non-empty strings`);
      if (seen.has(v)) throw new Error(`enum ${name}: ${v} is listed twice`);
      seen.add(v);
    }
  }
  if (!Array.isArray(raw.events)) throw new Error("catalog: events must be an array");
  const names = new Set<string>();
  for (const e of raw.events as unknown[]) {
    if (!isObject(e) || typeof e.name !== "string" || !EVENT_NAME.test(e.name)) throw new Error("event: name must be snake_case");
    const name = e.name;
    if (names.has(name)) throw new Error(`event ${name}: listed twice`);
    names.add(name);
    if (!whole(e.version) || e.version < 1) throw new Error(`event ${name}: version must be a whole number from 1`);
    if (e.cardinality !== "per_occurrence" && e.cardinality !== "per_tower") throw new Error(`event ${name}: cardinality must be per_occurrence or per_tower`);
    for (const key of ["semantics", "history"]) {
      if (!prose(e[key])) throw new Error(`event ${name}: ${key} must be a non-empty string without */`);
    }
    if (!isObject(e.payload)) throw new Error(`event ${name}: payload must be an object`);
    for (const [field, spec] of Object.entries(e.payload)) {
      const where = `event ${name} field ${field}`;
      if (!CAMEL_NAME.test(field)) throw new Error(`${where}: name must be camelCase`);
      const type = isObject(spec) ? spec.type : undefined;
      if (type === "enum") {
        const set = (spec as Record<string, unknown>).enum;
        if (typeof set !== "string") throw new Error(`${where}: enum must name a catalog enum`);
        if (!own(enums, set)) throw new Error(`${where}: enum ${set} is not in the catalog`);
      } else if (type === "integer") {
        const { min, max } = spec as Record<string, unknown>;
        const bounded = (v: unknown) => whole(v) && Math.abs(v) <= INTEGER_LIMIT;
        if (!bounded(min) || !bounded(max) || (min as number) > (max as number)) {
          throw new Error(`${where}: an integer needs whole min and max within ${INTEGER_LIMIT}`);
        }
      } else {
        throw new Error(`${where}: type ${String(type ?? "(none)")} is not allowed; payloads carry closed enums and small integers only`);
      }
    }
  }
  return raw as unknown as GameplayCatalog;
}

/** Throw unless a drained event is one the catalog describes: a known name,
 *  exactly the catalog's fields, each enum value listed and each integer in
 *  range, and nothing beside `name` and `payload`. */
export function checkEvent(catalog: GameplayCatalog, event: unknown): void {
  if (!isObject(event) || typeof event.name !== "string") throw new Error("event: name must be a string");
  const name = event.name;
  const entry = catalog.events.find((e) => e.name === name);
  if (!entry) throw new Error(`event ${name}: not in the catalog`);
  if (Object.keys(event).length !== 2 || !isObject(event.payload)) throw new Error(`event ${name}: must be exactly { name, payload }`);
  const payload = event.payload;
  for (const k of Object.keys(payload)) {
    if (!own(entry.payload, k)) throw new Error(`event ${name}: field ${k} is not in the catalog`);
  }
  for (const [field, spec] of Object.entries(entry.payload)) {
    if (!own(payload, field)) throw new Error(`event ${name}: field ${field} is missing`);
    const v = payload[field];
    const ok =
      spec.type === "enum"
        ? typeof v === "string" && catalog.enums[spec.enum].includes(v)
        : whole(v) && v >= spec.min && v <= spec.max;
    if (!ok) throw new Error(`event ${name}: field ${field} = ${JSON.stringify(v)} is outside the catalog`);
  }
}

/** `facilityKind` to `FacilityKind`: the TypeScript name of a catalog enum. */
function enumTypeName(set: string): string {
  return `Gameplay${set[0].toUpperCase()}${set.slice(1)}`;
}

/** One JSDoc block, wrapped at 80 columns, with the given indent. */
function doc(text: string, indent: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && indent.length + 3 + line.length + 1 + w.length > 80) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return [`${indent}/**`, ...lines.map((l) => `${indent} * ${l}`), `${indent} */`].join("\n");
}

/** The text of `src/engine/gameplayEvents.d.ts` for a checked catalog. */
export function renderGameplayEventsDts(catalog: GameplayCatalog): string {
  const out: string[] = [
    "// Generated from conformance/events/catalog.json by `npm run gen:events`.",
    "// Do not edit: change the catalog and regenerate (src/engine/gameplayCatalog.test.ts fails while this is stale).",
    "",
    doc(catalog.about, ""),
    `export type GameplayCatalogVersion = ${catalog.catalogVersion};`,
    "",
  ];
  for (const [set, values] of Object.entries(catalog.enums)) {
    out.push(`export type ${enumTypeName(set)} =\n${values.map((v) => `  | ${JSON.stringify(v)}`).join("\n")};`, "");
  }
  out.push("/** Every gameplay event's payload, by event name. */", "export interface GameplayEventPayloads {");
  for (const e of catalog.events) {
    out.push(doc(`${e.semantics} Version ${e.version}, ${e.cardinality === "per_tower" ? "once per tower" : "per occurrence"}. ${e.history}`, "  "));
    const fields = Object.entries(e.payload).map(([field, spec]) => {
      if (spec.type === "enum") return `    ${field}: ${enumTypeName(spec.enum)};`;
      return `    /** A whole number from ${spec.min} to ${spec.max}. */\n    ${field}: number;`;
    });
    out.push(fields.length ? `  ${e.name}: {\n${fields.join("\n")}\n  };` : `  ${e.name}: Record<string, never>;`);
  }
  out.push("}", "");
  out.push("/** Each event's schema version, by name. */", "export interface GameplayEventVersions {");
  for (const e of catalog.events) out.push(`  ${e.name}: ${e.version};`);
  out.push("}", "");
  out.push(
    "export type GameplayEventName = keyof GameplayEventPayloads;",
    "",
    "/** One drained event, `{ name, payload }`, as both engines hand it over. */",
    "export type GameplayEvent = {",
    "  [N in GameplayEventName]: { name: N; payload: GameplayEventPayloads[N] };",
    "}[GameplayEventName];",
    "",
  );
  return out.join("\n");
}
