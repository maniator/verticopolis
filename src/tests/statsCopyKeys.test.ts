import { LEDGER_CATS, LEDGER_LABELS, MILESTONE_COPY } from "@verticopolis/components/presentation/statsCopy";
import { LAYOUT } from "@verticopolis/engine/testing/mockPort";
import { describe, expect, it } from "vitest";

/** The keys the engine reports by, from its published view layout
 *  (`portReads.integration.test.ts` holds the fixture to the engine). The
 *  components word them; this game checks the two agree. */
const published = LAYOUT as unknown as { ledgerCats: string[]; milestones: string[] };

describe("the Statistics window's copy against the engine", () => {
  it("names every ledger category the engine reports, in its order", () => {
    expect([...LEDGER_CATS]).toEqual(published.ledgerCats);
    expect(Object.keys(LEDGER_LABELS).sort()).toEqual([...published.ledgerCats].sort());
  });

  it("words every milestone the engine reports, in its order, and no other", () => {
    expect([...MILESTONE_COPY.keys()]).toEqual(published.milestones);
  });
});
