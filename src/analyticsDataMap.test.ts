import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ENGINE_BUILDS, ENGINE_KINDS, ENGINE_STATUS_FIELDS, ENGINE_STATUS_TRIGGERS, MAX_ENGINE_STATUS_ROWS } from "./analyticsEngineStatus";
import { FALLBACK_REASONS, FALLBACK_STAGES } from "./wasmhost/engineBoot";
import { MAX_BODY_BYTES, RATE_LIMIT_MAX } from "./analyticsIngest";
import type { EngineChoice } from "./wasmhost/engineChoice";

/** Every engine a page life can ask for. Typed against `EngineChoice` both
 *  ways, so a new choice fails the typecheck here until the map lists it. */
const ENGINE_CHOICES = ["ts", "wasm", "wasm-frame", "wasm-worker"] as const satisfies readonly EngineChoice[];
type MissingChoice = Exclude<EngineChoice, (typeof ENGINE_CHOICES)[number]>;
const everyChoice: [MissingChoice] extends [never] ? true : MissingChoice = true;
void everyChoice;

/**
 * The analytics data map (`docs/analytics-data-map.md`) has to keep up with
 * what the game sends: every event in the vocabulary gets an entry, and the
 * reliability instrument's entry names every field and code it can carry. A
 * new event or field that lands without its entry fails here, before it ships.
 */

const here = dirname(fileURLToPath(import.meta.url));
const map = readFileSync(resolve(here, "../docs/analytics-data-map.md"), "utf8");
const core = readFileSync(resolve(here, "analyticsCore.ts"), "utf8");

/** The event names `GameplayEvents` declares: its top-level keys. */
function vocabulary(): string[] {
  const start = core.indexOf("export interface GameplayEvents {");
  expect(start, "GameplayEvents should be findable in analyticsCore.ts").toBeGreaterThan(-1);
  const names: string[] = [];
  let depth = 0;
  for (const line of core.slice(start).split("\n").slice(1)) {
    // Doc comment lines can hold braces (`{@link ...}`); only code counts.
    if (/^\s*(\/\*|\*|\/\/)/.test(line)) continue;
    const code = line.replace(/\/\*.*?\*\/|\/\/.*$/g, "");
    if (depth === 0 && /^\s*}/.test(code)) break;
    const key = /^ {2}["']?([A-Za-z0-9_$]+)["']?\??: /.exec(line);
    if (depth === 0 && key) names.push(key[1]);
    depth += (code.match(/{/g) ?? []).length - (code.match(/}/g) ?? []).length;
  }
  return names;
}

/** The table row the map gives one `engine_status` field. */
function fieldRow(section: string, field: string): string {
  const row = section.split("\n").find((l) => l.startsWith(`| \`${field}\` |`));
  expect(row, `the map should have a row for ${field}`).toBeDefined();
  return row ?? "";
}

/** One level-two section of the map, up to the next. */
function section(heading: string): string {
  const start = map.indexOf(`\n## ${heading}\n`);
  expect(start, `the map should have a ${heading} section`).toBeGreaterThan(-1);
  const end = map.indexOf("\n## ", start + 1);
  return map.slice(start, end === -1 ? undefined : end);
}

const engineSection = () => section("`engine_status`");

/** The first cell of every table row in a section: the names it lists. */
const rowNames = (text: string) => [...text.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);

describe("analytics data map", () => {
  it("reads the whole vocabulary", () => {
    const names = vocabulary();
    expect(names).toContain("new_game_started");
    expect(names).toContain("engine_status");
    expect(names.length).toBeGreaterThanOrEqual(17);
  });

  it("has a row in the Events table for every event the game sends, and no other", () => {
    // Only the Events table counts: the field tables list names such as
    // `version` that an event could one day share.
    expect(rowNames(section("Events")).sort()).toEqual(vocabulary().sort());
  });

  it("lists exactly the engine_status fields the game sends", () => {
    expect(rowNames(engineSection()).sort()).toEqual([...ENGINE_STATUS_FIELDS].sort());
  });

  it("lists exactly the codes an engine_status row can carry, each in its own field's row", () => {
    const section = engineSection();
    const codes: Record<string, readonly string[]> = {
      trigger: ENGINE_STATUS_TRIGGERS,
      engine_requested: ENGINE_CHOICES,
      engine: ENGINE_KINDS,
      build: ENGINE_BUILDS,
      fallback_reason: FALLBACK_REASONS,
      fallback_stage: FALLBACK_STAGES,
    };
    for (const [field, list] of Object.entries(codes)) {
      // The Values cell only: the Meaning cell names codes of other fields.
      const values = fieldRow(section, field).split(" | ")[1] ?? "";
      const listed = [...values.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      expect(listed.sort(), field).toEqual([...list].sort());
    }
  });

  it("states the limits the code sets", () => {
    expect(engineSection()).toContain(`Past ${MAX_ENGINE_STATUS_ROWS} such rows`);
    expect(MAX_BODY_BYTES).toBe(8 * 1024);
    expect(section("Posture")).toContain(`The relay caps bodies at 8 KiB and each IP at ${RATE_LIMIT_MAX} posts a minute.`);
  });

  it("states retention and the deletion path", () => {
    expect(map).toContain("## Retention and deletion");
    expect(map).toContain("https://posthog.com/docs/privacy/data-storage#data-deletion");
  });
});
