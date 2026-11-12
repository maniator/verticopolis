import { describe, expect, it, vi } from "vitest";
import { catalogFor } from "../tests/catalogFixture";
import { office, rec, root, setup } from "./editorActions.fixture";

vi.mock("../simport/headerClock", () => ({
  clockOf: () => ({ hour: 9, isWeekend: true }),
}));

/** The theater card's ticket price button over a mock port (#1950): the
 *  command it sends for each step, and what it does with the engine's
 *  answer. What a price does to income and visits is the Rust engine's,
 *  checked by `economy/tickets_tests.rs` and `rule_tests/venue_attendance.rs`. */

describe("EditorActions: ticket price", () => {
  it("steps a Modern theater's price through the catalog's steps, cheapest first, and wraps", async () => {
    const { actions, cards, codes, deps, port } = setup(
      { setTicketPrice: () => rec("setTicketPrice", true) },
      undefined,
      catalogFor("modern"),
    );
    for (const [now, next, label] of [
      [null, "high", "High"],
      ["low", "normal", "Normal"],
      ["normal", "high", "High"],
      ["high", "premium", "Premium"],
      ["premium", "low", "Low"],
    ] as const) {
      cards.unit.mockReturnValueOnce({ id: office.id, kind: "cinema", ticketPrice: now });
      await actions.handleEditAction("ticketPrice", root(""));
      expect(port.setTicketPrice).toHaveBeenLastCalledWith(office.id, codes.code("ticketPrices", next));
      expect(deps.announce).toHaveBeenLastCalledWith(`Ticket price set to ${label}.`);
    }
    expect(deps.captureUndo).toHaveBeenCalledWith("Ticket price");
    expect(deps.refreshEditor).toHaveBeenCalledTimes(5);
  });

  it("refreshes without a sound or a toast when the engine refuses the price", async () => {
    const { actions, cards, deps, port } = setup(
      { setTicketPrice: () => rec("setTicketPrice", false) },
      undefined,
      catalogFor("modern"),
    );
    cards.unit.mockReturnValueOnce({ id: office.id, kind: "cinema", ticketPrice: "normal" });
    await actions.handleEditAction("ticketPrice", root(""));
    expect(port.setTicketPrice).toHaveBeenCalledOnce();
    expect(deps.audio.sfx).not.toHaveBeenCalled();
    expect(deps.announce).not.toHaveBeenCalled();
    expect(deps.refreshEditor).toHaveBeenCalledOnce();
  });

  it("sends nothing where the mode has no ticket price (Classic)", async () => {
    const { actions, cards, deps, port } = setup({ setTicketPrice: () => rec("setTicketPrice", true) });
    cards.unit.mockReturnValueOnce({ id: office.id, kind: "cinema", ticketPrice: null });
    await actions.handleEditAction("ticketPrice", root(""));
    expect(port.setTicketPrice).not.toHaveBeenCalled();
    expect(deps.refreshEditor).not.toHaveBeenCalled();
  });
});
