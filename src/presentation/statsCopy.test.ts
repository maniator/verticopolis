import { describe, expect, it } from "vitest";
import { LAYOUT } from "../tests/portKit/mockPort";
import { LEDGER_CATS, LEDGER_LABELS, MILESTONE_COPY } from "./statsCopy";

/** The keys the engine reports by, from its published view layout
 *  (`portReads.integration.test.ts` holds the fixture to the engine). */
const published = LAYOUT as unknown as { ledgerCats: string[]; milestones: string[] };

describe("the Statistics window's copy", () => {
  it("names every ledger category the engine reports, in its order", () => {
    expect([...LEDGER_CATS]).toEqual(published.ledgerCats);
    expect(Object.keys(LEDGER_LABELS).sort()).toEqual([...published.ledgerCats].sort());
    for (const cat of LEDGER_CATS) expect(LEDGER_LABELS[cat], cat).toMatch(/\S/);
  });

  it("words every milestone the engine reports, in its order, and no other", () => {
    expect([...MILESTONE_COPY.keys()]).toEqual(published.milestones);
    for (const [id, copy] of MILESTONE_COPY) {
      expect(copy.label, id).toMatch(/\S/);
      expect(copy.desc, id).toMatch(/\S/);
    }
  });
});
