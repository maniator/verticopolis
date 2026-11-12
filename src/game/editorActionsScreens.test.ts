import { describe, expect, it, vi } from "vitest";
import { catalogFor } from "../tests/catalogFixture";
import { office, rec, root, setup } from "./editorActions.fixture";

vi.mock("../simport/headerClock", () => ({
  clockOf: () => ({ hour: 9, isWeekend: true }),
}));

/** A Modern theater's second screen on the card over a mock port (#1950):
 *  the screen each button's command names, and the choice the screen's
 *  Auto-rebook button steps from. What a screen's film does to visits and
 *  income is the Rust engine's, checked by `economy/screens_tests.rs`. */

describe("EditorActions: a theater's second screen", () => {
  it("books a film on the second screen, naming that screen", async () => {
    const { actions, codes, deps, port } = setup(
      { changeFilm: () => rec("changeFilm", true, { cost: 1 }) },
      undefined,
      catalogFor("modern"),
    );
    await actions.handleEditAction("blockbusterFilm2", root(""));
    expect(port.changeFilm).toHaveBeenCalledExactlyOnceWith(office.id, codes.code("filmTiers", "blockbuster"), 1);
    expect(deps.captureUndo).toHaveBeenCalledExactlyOnceWith("Film change");
    expect(deps.announce).toHaveBeenCalledExactlyOnceWith("Now showing on screen 2: a blockbuster.");
    expect(deps.refreshEditor).toHaveBeenCalledOnce();
  });

  it("steps the second screen's Auto-rebook choice from its own, leaving the first screen's", async () => {
    const { actions, cards, codes, deps, port } = setup({ setFilm: () => rec("setFilm", true) }, undefined, catalogFor("modern"));
    cards.unit.mockReturnValueOnce({
      id: office.id,
      kind: "cinema",
      filmPolicy: "off",
      screen2: { filmPolicy: "revival", filmDays: 3, filmTier: "classic" },
    });
    await actions.handleEditAction("filmPolicy2", root(""));
    expect(port.setFilm).toHaveBeenCalledExactlyOnceWith(office.id, codes.code("filmPolicies", "feature"), 1);
    expect(deps.captureUndo).toHaveBeenCalledExactlyOnceWith("Film policy");
    // A second screen with no choice of its own follows the mode's default.
    cards.unit.mockReturnValueOnce({
      id: office.id,
      kind: "cinema",
      filmPolicy: "off",
      screen2: { filmPolicy: null, filmDays: 3, filmTier: "classic" },
    });
    await actions.handleEditAction("filmPolicy2", root(""));
    expect(port.setFilm).toHaveBeenLastCalledWith(office.id, codes.code("filmPolicies", "blockbuster"), 1);
  });

  it("sends nothing for a second screen where the mode runs one (Classic)", async () => {
    const { actions, deps, port } = setup({
      changeFilm: () => rec("changeFilm", true, { cost: 1 }),
      setFilm: () => rec("setFilm", true),
    });
    await actions.handleEditAction("newFilm2", root(""));
    await actions.handleEditAction("filmPolicy2", root(""));
    expect(port.changeFilm).not.toHaveBeenCalled();
    expect(port.setFilm).not.toHaveBeenCalled();
    expect(deps.captureUndo).toHaveBeenNthCalledWith(1, "Edit");
    expect(deps.captureUndo).toHaveBeenNthCalledWith(2, "Edit");
  });
});
