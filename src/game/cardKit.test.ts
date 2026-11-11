import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isOperational, type UnitState } from "../shared/types";
import type { ViewReader } from "../simport/viewReader";
import { createCardKit, INERT_STATES } from "./cardKit";
import { refreshEditorCard, type EditorCardApp } from "./editorCard";
import { LAYOUT, code, mockPort, record } from "../tests/portKit/mockPort";
import { renderToFragment } from "../ui/testing/litTestUtils";
import { unitEditorTemplate } from "../ui/templates/editor";
import { repoRoot } from "../tests/guardFiles";
import { unitInspectorTemplate } from "../ui/templates/inspector";
import { groupDigits } from "../ui/format";

/**
 * The card kit's unit and shaft lines over a mock port: the engine facts it
 * reads, the lines it makes of them and when it reads them again. The facts
 * on the Rust engine are decoded in `portReader.integration.test.ts`; the
 * lines' wording in `portUnitDiagnostics.test.ts`.
 */

const CENTER = 11;
const OFFICE = 12;
const SHAFT = 73;

const layoutCode = (table: "accessLines", name: string) => (LAYOUT as unknown as Record<string, string[]>)[table].indexOf(name);

/** One room's card record, as the engine answers `unitCard`. */
const card = (id: number, kind: string, floor: number, over: Record<string, number> = {}) =>
  record("unitCard", { id, kindCode: code("kinds", kind), floor, x: 180, width: 9, stateCode: code("unitStates", "occupied"), rent: NaN, price: 0, vacateReason: NaN, filmPolicy: NaN, blockbuster: NaN, served: 1, reachable: 1, floorHasLobby: 0, satisfaction: 0.5, ...over });

/** A room's engine facts (`unitFacts`): no access or No Rate line unless set. */
const facts = (id: number, over: Record<string, number> = {}) => record("unitFacts", { id, access: NaN, noRate: NaN, ...over });

/** A tower with a recycling center in the basement and an occupied office on
 *  floor 2 that no elevator reaches; each answer can be changed by the test. */
function tower() {
  const state = {
    center: card(CENTER, "recycling", -1),
    office: card(OFFICE, "office", 2, { served: 0, reachable: 0 }),
    officeFacts: { access: layoutCode("accessLines", "notConnected") } as Record<string, number>,
    generation: 1,
    utilization: 0.91,
    nearCapacity: 1,
  };
  const port = mockPort({
    unitCard: (id: number) => ({ [CENTER]: state.center, [OFFICE]: state.office })[id] ?? new Float64Array(0),
    unitLabel: () => undefined,
    unitSubtype: () => undefined,
    unitFacts: (id: number) => facts(id, id === OFFICE ? state.officeFacts : {}),
    serviceDiagnostics: () => undefined,
    recyclingCapacity: () => 2500,
    recyclingFill: () => 0.4,
    recyclingDemandMet: () => true,
    shaftCard: (id: number) => (id === SHAFT ? record("shaftCard", { id, kindCode: code("kinds", "elevatorStandard"), utilization: state.utilization, nearCapacity: state.nearCapacity }) : new Float64Array(0)),
    generation: () => state.generation,
  });
  const reader = {
    header: { revision: 1, minutes: 7 * 60, minuteOfDay: 7 * 60, day: 0, dayOfWeek: 0, isWeekend: false, quarter: 0, year: 0, weekDays: 7, weekendDays: 2, population: 40, star: 2, mode: "classic" },
    tower: { revision: 1 },
  } as unknown as ViewReader & { header: { minutes: number; population: number; revision: number } };
  const kit = createCardKit({ enginePort: port, reader });
  return { state, port, reader, kit };
}

/** A line list as the text it renders. */
const text = (lines: ReturnType<ReturnType<typeof tower>["kit"]["diagnostics"]["unit"]>) =>
  lines.map((l) => l.strings.map((s, i) => s + (i < l.values.length ? String(l.values[i]) : "")).join("")).join("\n");

describe("the card kit's unit and shaft lines over the port", () => {
  it("show a recycling center's fill and capacity lines from the port's recycling reads", () => {
    const { port, kit } = tower();
    const center = kit.diagnostics.unit(CENTER);
    expect(center).toHaveLength(2);
    expect(text(center)).toContain("Fill: 40%");
    expect(text(center)).toContain(`${groupDigits(40)}/${groupDigits(2500)} population; demand met`);
    expect([port.recyclingCapacity, port.recyclingFill, port.recyclingDemandMet].map((f) => vi.mocked(f).mock.calls.length)).toEqual([1, 1, 1]);
    expect(kit.diagnostics.unit(OFFICE).length).toBeGreaterThan(0);
  });

  it("shows the shaft's average load warning from its port record, with the engine's verdict", () => {
    const { state, kit } = tower();
    const copy = (id: number) => text(kit.diagnostics.transport(id));
    expect(copy(SHAFT)).toContain("Avg load: 91% full. Near capacity; consider more cars or a parallel shaft.");
    expect(copy(SHAFT)).toContain("var(--bad)");
    expect(copy(9999)).toBe("");

    state.utilization = 0.85;
    state.nearCapacity = 0;
    kit.cards.forget();
    expect(copy(SHAFT)).toContain("Avg load: 85% full");
    expect(copy(SHAFT)).not.toContain("Near capacity");
    expect(copy(SHAFT)).toContain("var(--good)");

    // The engine owns the verdict: a high load it does not call near capacity
    // shows no warning, and a low load it does call near capacity shows one.
    state.utilization = 0.97;
    state.nearCapacity = 0;
    kit.cards.forget();
    expect(copy(SHAFT)).not.toContain("Near capacity");
    state.utilization = 0.4;
    state.nearCapacity = 1;
    kit.cards.forget();
    expect(copy(SHAFT)).toContain("Avg load: 40% full. Near capacity");

    state.utilization = NaN;
    kit.cards.forget();
    expect(copy(SHAFT)).toBe("");
  });

  it("show tenant access from port facts, without recycling lines for another kind or a center under construction", () => {
    const { state, port, kit } = tower();
    const officeText = text(kit.diagnostics.unit(OFFICE));
    expect(officeText).toContain("Access:");
    expect(officeText).toContain("No elevator or stair reaches this floor.");
    expect(port.recyclingCapacity, "an office reads no recycling").not.toHaveBeenCalled();
    state.center = card(CENTER, "recycling", -1, { stateCode: code("unitStates", "construction") });
    kit.cards.forget();
    expect(kit.diagnostics.unit(CENTER)).toEqual([]);
    expect(port.recyclingCapacity, "an inert center reads no recycling").not.toHaveBeenCalled();
  });

  it("shows the engine-reported Main gripe on both mobile and desktop", () => {
    const { state, kit } = tower();
    state.office = card(OFFICE, "office", 2, { satisfaction: 0.01 });
    state.officeFacts = { access: layoutCode("accessLines", "reachable"), gripe: 1, gripeCause: code("vacateReasons", "rent") };
    const unit = kit.cards.unit(OFFICE)!;
    const copy = "Main gripe: the rent is above the going rate. Lower it to keep them.";
    const mobile = renderToFragment(unitEditorTemplate(unit, kit.catalog(), 12, true, kit.diagnostics.unit(OFFICE)));
    const desktop = renderToFragment(unitInspectorTemplate(unit, kit.catalog(), 12, kit.diagnostics.unit(OFFICE)));
    expect(mobile.querySelector(".ed-diagnostics")?.textContent).toContain(copy);
    expect(desktop.textContent).toContain(copy);
  });

  it("does not recalculate the engine's grievance facts on every 160ms editor refresh", () => {
    const { state, port, reader, kit } = tower();
    const reads = () => vi.mocked(port.unitFacts).mock.calls.length;
    reader.header = { ...reader.header, minutes: 23 * 60 + 50 };
    // Opening a card asks the engine once. A frame pump only changes the clock
    // within an hour, so it reuses the same engine-authored explanation.
    kit.diagnostics.unit(OFFICE, true);
    expect(reads()).toBe(1);
    for (let i = 0; i < 12; i++) kit.diagnostics.unit(OFFICE);
    expect(reads()).toBe(1);
    reader.header = { ...reader.header, minutes: reader.header.minutes + 5 };
    kit.diagnostics.unit(OFFICE);
    expect(reads()).toBe(1);

    // Game hour (also across midnight) invalidates the inspector demand memo.
    reader.header = { ...reader.header, minutes: reader.header.minutes + 60 };
    kit.diagnostics.unit(OFFICE);
    expect(reads()).toBe(2);
    // Selected unit state and price change without a structural revision.
    state.office = card(OFFICE, "office", 2, { served: 0, reachable: 0, satisfaction: 0.02 });
    kit.cards.forget();
    kit.diagnostics.unit(OFFICE);
    expect(reads()).toBe(3);
    state.office = card(OFFICE, "office", 2, { served: 0, reachable: 0, satisfaction: 0.02, rent: 10_050 });
    kit.cards.forget();
    kit.diagnostics.unit(OFFICE);
    expect(reads()).toBe(4);
    // A direct command re-reads even if an unrelated room's rent changed.
    kit.diagnostics.unit(OFFICE, true);
    expect(reads()).toBe(5);
    // A command elsewhere in the tower may leave every selected-unit field
    // unchanged; explicit mutation invalidation still forces a fresh cause.
    kit.diagnostics.invalidate();
    kit.diagnostics.unit(OFFICE);
    expect(reads()).toBe(6);

    reader.header = { ...reader.header, population: reader.header.population + 1 };
    kit.diagnostics.unit(OFFICE);
    expect(reads()).toBe(7);
    reader.header = { ...reader.header, revision: reader.header.revision + 1 };
    kit.diagnostics.unit(OFFICE);
    expect(reads()).toBe(8);
    // A load or undo can reuse the same room id and clock; generation must
    // keep those tower identities apart.
    state.generation++;
    kit.diagnostics.unit(OFFICE);
    expect(reads()).toBe(9);
  });

  it("wires cached refreshes through the real mobile editor and invalidates after explicit edits", () => {
    const { port, reader, kit } = tower();
    const reads = () => vi.mocked(port.unitFacts).mock.calls.length;
    const editor = {
      selected: { type: "unit", id: OFFICE },
      engine: { selectedId: null },
      ui: { renderEditor: vi.fn() },
      mobileMq: { matches: true },
      cardKit: kit,
      reader,
      clearSelection: vi.fn(),
    } as unknown as EditorCardApp;
    refreshEditorCard(editor);
    expect(reads()).toBe(1);
    for (let i = 0; i < 10; i++) refreshEditorCard(editor, false);
    expect(reads()).toBe(1);
    refreshEditorCard(editor);
    expect(reads()).toBe(2);

    // An edit while the card is on desktop invalidates a mobile snapshot,
    // even though desktop doesn't fold diagnostic text into its editor.
    const desktop = { ...editor, mobileMq: { matches: false } };
    refreshEditorCard(desktop);
    expect(reads()).toBe(2);
    kit.diagnostics.unit(OFFICE);
    expect(reads()).toBe(3);
  });

  it("keeps a tenant's on-notice countdown live instead of caching it per hour", () => {
    const { state, port, reader, kit } = tower();
    state.office = card(OFFICE, "office", 2, { stateCode: code("unitStates", "vacating"), vacateReason: code("vacateReasons", "noise") });
    kit.diagnostics.unit(OFFICE);
    reader.header = { ...reader.header, minutes: reader.header.minutes + 5 };
    kit.diagnostics.unit(OFFICE);
    expect(port.unitFacts).toHaveBeenCalledTimes(2);
  });

  it("treat a room as inert in exactly the states the engine does", () => {
    const all: UnitState[] = ["construction", "empty", "occupied", "moving_in", "vacating", "asleep", "dirty", "infested", "fire", "gutted"];
    for (const state of all) expect(INERT_STATES.has(state), state).toBe(!isOperational({ state }));
    // The game runs the Rust engine, so its predicate is the one to match,
    // and this pin outlives the TypeScript one above.
    const rust = readFileSync(resolve(repoRoot, "engine-rs/src/tower_query_state.rs"), "utf8");
    // The body must be the one `matches!` over the state, with nothing after
    // it and no arm guard, so no other condition can hide beside the states.
    const inert = /fn is_operational\(&self\) -> bool \{\s*!matches!\(\s*self\.state,\s*((?:UnitState::\w+\s*\|\s*)*UnitState::\w+),?\s*\)\s*\}/.exec(rust)?.[1];
    expect(inert, "is_operational's shape changed; read its states again").toBeDefined();
    const names = [...(inert ?? "").matchAll(/UnitState::(\w+)/g)].map((m) => m[1].replace(/[A-Z]/g, (c, at: number) => (at ? "_" : "") + c.toLowerCase()));
    expect(new Set(names)).toEqual(INERT_STATES);
  });
});
