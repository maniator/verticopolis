import { describe, expect, it } from "vitest";
import { crowdView, stateView } from "../../engine/conformanceView";
import { TsEngine } from "../../engine/port/tsEngine";
import { canonicalJson } from "../conformance/canonical";
import { PORT_EDIT_CASES, runPortEditCase } from "../goldens/portEditCases";
import { firstPortEditDifference, readPortEdits, type LineField, type PortEditLeg, type PortEditLine } from "../goldens/portEdits";
import { PORT_EDITS_UPDATE } from "../goldens/updateGate";

/**
 * The TypeScript referee's check of the port-edit golden
 * (`src/tests/goldens/portEdits.ts`): the same scripts, sent to `TsEngine`'s
 * port commands, must answer and move the tower as the Rust engine pinned at
 * every step. With `conformanceWasmPortEdits.integration.test.ts` this is the
 * edit half of the dual run (`dualRunEdits`, `dualRunBrush`): both engines
 * equal the golden after every step, so they equal each other, apart from
 * the lines {@link ON_PURPOSE} names.
 *
 * It stays while the TypeScript engine does and is deleted with `src/engine/`.
 */

function tsLeg(): PortEditLeg {
  const engine = TsEngine.newGame(1, "classic");
  return {
    name: "typescript",
    port: engine,
    stateView: () => canonicalJson(stateView(engine.sim)),
    crowdView: () => canonicalJson(crowdView(engine.sim)),
    // The tooling write the Rust engine's `setMoney` makes.
    setMoney: (amount) => {
      engine.sim.money = amount;
    },
  };
}

/** Lines where the reference engine differs on purpose. Its undo swaps a
 *  whole save back in (`src/engine/port/tsEngine.ts`, the undo steps), and a
 *  save holds no people, so from the first undo its crowd is empty where the
 *  Rust engine's undo, which puts back only what the edit changed, keeps the
 *  crowd; the hour played after it then moves the two towers apart, until
 *  the restore brings both back to the same save. The answers, the clock and
 *  the events still have to match on every line. */
const ON_PURPOSE: readonly { case: string; fields: readonly LineField[]; from: string; after?: string; until: string }[] = [
  { case: "four-star tower edits", fields: ["crowd"], from: "undo the bulldoze", until: "restore the save from before the sale" },
  { case: "four-star tower edits", fields: ["state"], after: "redo the sale", from: "play 60 minutes", until: "restore the save from before the sale" },
];

interface Span {
  readonly fields: readonly LineField[];
  readonly from: number;
  readonly until: number;
}

/** The line spans of {@link ON_PURPOSE} for one case, found by step. */
function spansOf(id: string, pinned: readonly PortEditLine[]): Span[] {
  return ON_PURPOSE.filter((a) => a.case === id).map((a) => {
    const after = a.after === undefined ? -1 : pinned.findIndex((l) => l.step === a.after);
    const from = pinned.findIndex((l, i) => i > after && l.step === a.from);
    const until = pinned.findIndex((l, i) => i > from && l.step === a.until);
    const staleAfter = a.after !== undefined && after < 0;
    if (staleAfter || from < 0 || until < 0) throw new Error(`${id}: the allowance for ${a.fields.join(", ")} from "${a.from}" names a step the golden lacks`);
    return { fields: a.fields, from, until };
  });
}

// An update run rewrites the golden from the Rust engine; run this check on
// the new file afterwards, without the switch.
describe.skipIf(PORT_EDITS_UPDATE)("the port-edit golden on the TypeScript referee", () => {
  const pinned = readPortEdits();

  it("names only cases the golden has", () => {
    for (const a of ON_PURPOSE) expect(PORT_EDIT_CASES.map((c) => c.id), a.case).toContain(a.case);
  });

  for (const c of PORT_EDIT_CASES) {
    it(c.id, () => {
      const want = pinned.cases[c.id];
      const got = runPortEditCase(tsLeg(), c);
      const spans = want ? spansOf(c.id, want) : [];
      const mayDiffer = (line: number, field: LineField) => spans.some((w) => line >= w.from && line < w.until && w.fields.includes(field));
      expect(firstPortEditDifference(got, want, mayDiffer)).toBeNull();
      // Each allowance is still needed: its field does differ in its span.
      for (const w of spans) {
        for (const field of w.fields) {
          const differs = got.slice(w.from, w.until).some((l, i) => canonicalJson(l[field]) !== canonicalJson(want[w.from + i][field]));
          expect(differs, `${field} from line ${w.from}`).toBe(true);
        }
      }
    }, 120_000);
  }
});
