import { beforeEach, describe, expect, it, vi } from "vitest";
import { knownPlayerText, resetPlayerTextForTest } from "../analyticsPlayerText";
import { office, rec, root, setup } from "./editorActions.fixture";

vi.mock("../engineHost/headerClock", () => ({
  clockOf: () => ({ hour: 9, isWeekend: true }),
}));

// #607: a rename takes a name out of every source the error scrubber reads, so
// the old and new names are remembered at the rename.
describe("EditorActions and the error scrubber (#607)", () => {
  beforeEach(() => resetPlayerTextForTest());

  it("remembers a tower's old and new names", () => {
    const { actions, port } = setup({ towerName: () => "Old Spire", nameTower: () => rec("buildAt", true) });
    actions.renameTower("New Spire");
    expect(port.towerName).toHaveBeenCalledOnce();
    expect(port.nameTower).toHaveBeenCalledExactlyOnceWith("New Spire");
    expect(knownPlayerText()).toEqual(expect.arrayContaining(["Old Spire", "New Spire"]));
  });

  it("remembers a facility's old and new names", async () => {
    const { actions, deps } = setup({ labelUnit: () => rec("labelUnit", true) });
    vi.mocked(deps.kit().cards.unit).mockReturnValue({ ...office, label: "Old Office" } as never);
    await actions.handleEditAction("rename", root('<input id="ed-name" value="Acme Widgets">'));
    expect(knownPlayerText()).toEqual(expect.arrayContaining(["Acme Widgets", "Old Office"]));
  });
});
