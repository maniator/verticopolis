import { describe, expect, it } from "vitest";
import { LEDGER_CATS as ENGINE_LEDGER_CATS, LEDGER_LABELS as ENGINE_LEDGER_LABELS } from "../engine/Ledger";
import { MILESTONES } from "../engine/milestones";
import { LEDGER_CATS, LEDGER_LABELS, MILESTONE_COPY } from "./statsCopy";

describe("the Statistics window's copy", () => {
  it("names every ledger category the engine reports, in its order", () => {
    expect([...LEDGER_CATS]).toEqual(ENGINE_LEDGER_CATS);
    expect(LEDGER_LABELS).toEqual(ENGINE_LEDGER_LABELS);
  });

  it("words every milestone the engine defines, and no other", () => {
    expect([...MILESTONE_COPY.keys()]).toEqual(MILESTONES.map((m) => m.id));
    for (const m of MILESTONES) expect(MILESTONE_COPY.get(m.id)).toEqual({ label: m.label, desc: m.desc });
  });
});
