import { describe, expect, it } from "vitest";
import { html, type TemplateResult } from "lit-html";
import { LAYOUT_TEXT } from "../tests/portKit/mockPort";
import { createPortUnitDiagnostics, createPortUnitParts, joinParts, type SupplementalLines } from "./portUnitDiagnostics";

/** The Rust engine's view layout (the checked-in fixture), with the tables these tests code by. */
type CodeTable = "vacateReasons" | "bindings" | "accessLines" | "modes" | "noRateLines";
const VIEW_LAYOUT = JSON.parse(LAYOUT_TEXT) as { records: { unitFacts: string[] } } & Record<CodeTable, string[]>;
const slots = VIEW_LAYOUT.records.unitFacts;
function facts(changes: Record<string, number>): Float64Array {
  const record = new Float64Array(slots.length).fill(NaN);
  record[slots.indexOf("id")] = 73;
  for (const [name, value] of Object.entries(changes)) {
    const slot = slots.indexOf(name);
    if (slot < 0) throw new Error(`unknown facts field: ${name}`);
    record[slot] = value;
  }
  return record;
}
function code(table: CodeTable, value: string): number {
  return VIEW_LAYOUT[table].indexOf(value);
}
function text(lines: TemplateResult[]): string {
  return lines.map(({ strings, values }) => strings.map((part, i) => part + (i < values.length ? String(values[i]) : "")).join("")).join("\n");
}
function render(record: Float64Array, id = 73, supplemental?: () => SupplementalLines): string {
  const diag = createPortUnitDiagnostics({
    viewLayout: () => LAYOUT_TEXT,
    unitFacts: () => record,
  }, supplemental);
  return text(diag(id));
}

describe("Rust port tenant explanations", () => {
  it("names the near-nightclub cause for a 1% occupied condo", () => {
    const rendered = render(facts({
      gripe: 1,
      gripeCause: code("vacateReasons", "noise"),
      gripeAdjacent: 1,
      gripeClub: 1,
      access: code("accessLines", "reachable"),
    }));
    expect(rendered).toContain("Access: reachable from the lobby.");
    expect(rendered).toContain("Main gripe: a noisy neighbor and a nearby nightclub.");
    expect(rendered).toContain("put more floors between it and this unit");
  });

  it("does not invent explanations for a satisfied tenant or an absent unit", () => {
    const clean = facts({ access: code("accessLines", "reachable") });
    expect(render(clean)).not.toContain("Main gripe:");
    expect(render(clean, 74)).toBe("");
    expect(render(new Float64Array(0))).toBe("");
  });

  it("uses the binding transport class, not generic elevator advice", () => {
    const rendered = render(facts({
      gripe: 1,
      gripeCause: code("vacateReasons", "congestion"),
      gripeBinding: code("bindings", "stairs"),
      gripeElevatorHere: 1,
    }));
    expect(rendered).toContain("Main gripe: crowded stairs.");
    expect(rendered).toContain("other floors they serve");
    expect(rendered).not.toContain("give this floor an elevator stop");
  });

  it("suppresses duplicate unmet-demand advice when the unit is unreachable", () => {
    const record = facts({
      access: code("accessLines", "noRoute"),
      gripe: 1,
      gripeCause: code("vacateReasons", "unmetDemand"),
      gripeCoverage: 0,
      gripeFloorReachable: 0,
    });
    expect(render(record)).toContain("Access: no route.");
    expect(render(record)).not.toContain("Main gripe:");
    record[slots.indexOf("gripeFloorReachable")] = 1;
    expect(render(record)).toContain("Reconnect your retail");
  });

  it("shows lobby placement fixes and No Rate from the port's flags", () => {
    const rendered = render(facts({
      modeCode: code("modes", "modern"),
      noRate: code("noRateLines", "occupied"),
      lobby: 1,
      sinking: 1,
      lobbyDistance: 13,
      slot: 1,
      slotFloor: 75,
      needsSupport: 1,
    }));
    expect(rendered).toContain("No Rate: the tenant stays");
    expect(rendered).toContain("Too far from any lobby: 13 floors.");
    expect(rendered).toContain("Build floors up to 74");
  });

  it("distinguishes an empty unit held by the move-in gate from an on-notice tenant", () => {
    const lease = render(facts({
      wontLease: 1,
      leaseGripe: 1,
      leaseGripeCause: code("vacateReasons", "rent"),
      carry: 1200,
    }));
    expect(lease).toContain("Won't lease: the rent is above the going rate.");
    expect(lease).toContain("$1,200 a month to hold empty");

    const notice = render(facts({
      notice: 1,
      noticeReason: code("vacateReasons", "noise"),
      minutesLeft: 90,
      noticeSatisfaction: 0.01,
      keepAt: 0.35,
    }));
    expect(notice).toContain("Giving notice:");
    expect(notice).toContain("Leaves in under 2 hour(s)");
    expect(notice).toContain("35% to keep them (now 1%)");
  });

  it("shows relocation without incorrectly telling players they can save the tenant", () => {
    const rendered = render(facts({
      notice: 1,
      noticeReason: code("vacateReasons", "relocation"),
      minutesLeft: 0,
    }));
    expect(rendered).toContain("any moment now");
    expect(rendered).toContain("A life event, so you cannot keep them.");
    expect(rendered).not.toContain("Fix the cause");
  });

  it("stacks service lines after No Rate and closes the card with the business block, below any notice", () => {
    const supplemental = () => ({ lines: [html`<div>SERVICE</div>`], trailing: [html`<div>RETAIL</div>`] });
    const inOrder = (rendered: string, marks: readonly string[]): void => {
      const order = marks.map((mark) => rendered.indexOf(mark));
      expect(order.every((at) => at >= 0), rendered).toBe(true);
      expect(order).toEqual([...order].sort((a, b) => a - b));
    };
    const onNotice = render(facts({
      access: code("accessLines", "reachable"),
      noRate: code("noRateLines", "occupied"),
      notice: 1,
      noticeReason: code("vacateReasons", "rent"),
      minutesLeft: 600,
      noticeSatisfaction: 0.25,
      keepAt: 0.4,
    }), 73, supplemental);
    inOrder(onNotice, ["Access:", "No Rate:", "SERVICE", "Giving notice:", "Fix the cause", "RETAIL"]);
    const noNotice = render(facts({ access: code("accessLines", "reachable") }), 73, supplemental);
    inOrder(noNotice, ["Access:", "SERVICE", "RETAIL"]);
    // A recycling center's block reads above the notice, as on the reference
    // card (only a hand-edited save can put one on notice), and after the
    // unit's facts.
    const reads: string[] = [];
    const recycling = () => {
      reads.push("recycling");
      return [html`<div>RECYCLING</div>`];
    };
    const recycler = createPortUnitDiagnostics({
      viewLayout: () => LAYOUT_TEXT,
      unitFacts: () => {
        reads.push("unitFacts");
        return facts({ access: code("accessLines", "reachable"), notice: 1, noticeReason: code("vacateReasons", "rent"), minutesLeft: 600, noticeSatisfaction: 0.25, keepAt: 0.4 });
      },
    }, supplemental);
    inOrder(text(recycler(73, recycling)), ["Access:", "SERVICE", "RECYCLING", "Giving notice:", "RETAIL"]);
    expect(reads).toEqual(["unitFacts", "recycling"]);
  });

  it("keeps a card's halves so a block read later lands in the same place, and keeps the block for a short record", () => {
    const inOrder = (rendered: string, marks: readonly string[]): void => {
      const order = marks.map((mark) => rendered.indexOf(mark));
      expect(order.every((at) => at >= 0), rendered).toBe(true);
      expect(order).toEqual([...order].sort((a, b) => a - b));
    };
    const block = () => [html`<div>RECYCLING</div>`];
    const supplemental = (): SupplementalLines => ({ lines: [html`<div>SERVICE</div>`], trailing: [html`<div>RETAIL</div>`] });
    let record = facts({ access: code("accessLines", "reachable"), gripe: 1, gripeCause: code("vacateReasons", "rent") });
    const parts = createPortUnitParts({ viewLayout: () => LAYOUT_TEXT, unitFacts: () => record }, supplemental);
    const kept = parts(73);
    // The same kept halves place the block above the gripe on every read,
    // and with no block the card is the kept lines themselves, with no copy made.
    inOrder(text(joinParts(kept, block)), ["Access:", "SERVICE", "RECYCLING", "Main gripe:", "RETAIL"]);
    inOrder(text(joinParts(kept, block)), ["Access:", "SERVICE", "RECYCLING", "Main gripe:", "RETAIL"]);
    expect(joinParts(kept)).toBe(kept.lines);
    inOrder(text(kept.lines), ["Access:", "SERVICE", "Main gripe:", "RETAIL"]);
    expect(text(kept.lines)).not.toContain("RECYCLING");
    record = new Float64Array(2);
    expect(text(joinParts(parts(73), block))).toBe("<div>RECYCLING</div>");
  });
});
