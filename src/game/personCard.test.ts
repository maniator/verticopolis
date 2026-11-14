import { describe, expect, it, vi } from "vitest";
import type { PersonDetail } from "../simport/personCards";
import { catalogFor } from "../tests/catalogFixture";
import { renderToFragment } from "../ui/testing/litTestUtils";
import { PERSON_FOLLOW_ACTION } from "../ui/templates/personCard";
import type { TemplateResult } from "lit-html";
import { PersonCardController, type PersonCardDeps } from "./personCard";

function person(over: Partial<PersonDetail> = {}): PersonDetail {
  return {
    id: 5,
    state: "riding",
    floor: 3,
    x: 4,
    staff: false,
    purpose: "toWork",
    returning: false,
    shift: null,
    from: { place: "lobby", floor: 1 },
    to: { place: "floor", floor: 12 },
    wait: 0,
    waitMinutes: 0,
    tripWaitMinutes: 3,
    shaftId: 2,
    ...over,
  };
}

function deps(answers: Array<PersonDetail | undefined>) {
  let following = false;
  let open = true;
  const d = {
    person: vi.fn((id: number) => {
      const next = answers.length > 1 ? answers.shift() : answers[0];
      return next && { ...next, id };
    }),
    catalog: () => catalogFor("modern"),
    shaftKind: vi.fn(() => "elevatorExpress" as const),
    mood: vi.fn(() => "content" as const),
    ui: { renderEditor: vi.fn<(tpl: TemplateResult) => void>(), isEditorOpen: () => open },
    focus: vi.fn(),
    ringed: vi.fn(() => true),
    place: vi.fn(),
    setFollow: vi.fn((on: boolean) => (following = on)),
    following: () => following,
    closeWindow: () => (open = false),
  };
  return d satisfies PersonCardDeps & { closeWindow(): void };
}

/** The text of the card last rendered. */
const shown = (d: ReturnType<typeof deps>) => renderToFragment(d.ui.renderEditor.mock.lastCall![0]).textContent ?? "";

describe("PersonCardController", () => {
  it("opens on a person the engine knows, rings them and shows their card", () => {
    const d = deps([person()]);
    const c = new PersonCardController(d);
    expect(c.open(5)).toBe(true);
    expect(d.person).toHaveBeenCalledWith(5);
    expect(d.focus).toHaveBeenCalledWith(5);
    expect(d.place).toHaveBeenCalledWith(4, 3);
    expect(d.shaftKind).toHaveBeenCalledWith(2);
    expect(c.openId).toBe(5);
    expect(shown(d)).toContain("Coming in to work");
  });

  it("opens nothing on someone already gone", () => {
    const d = deps([undefined]);
    const c = new PersonCardController(d);
    expect(c.open(5)).toBe(false);
    expect(d.focus).not.toHaveBeenCalled();
    expect(d.ui.renderEditor).not.toHaveBeenCalled();
    expect(c.openId).toBeNull();
  });

  it("refreshes on the tick, and marks them gone when they leave", () => {
    const d = deps([person(), person({ state: "toDest", x: 9, floor: 6 }), undefined]);
    const c = new PersonCardController(d);
    c.open(5);
    c.handleAction(PERSON_FOLLOW_ACTION);
    expect(d.setFollow).toHaveBeenLastCalledWith(true);
    c.tick();
    expect(d.person).toHaveBeenCalledTimes(2);
    expect(d.place).toHaveBeenLastCalledWith(9, 6);
    c.tick();
    expect(shown(d)).toContain("They left the tower.");
    expect(d.setFollow).toHaveBeenLastCalledWith(false);
    expect(d.focus).toHaveBeenLastCalledWith(null);
    // A gone card asks the engine no more.
    c.tick();
    expect(d.person).toHaveBeenCalledTimes(3);
  });

  it("says where they went in when the engine lets them go at the end of the trip", () => {
    // Followed up the elevator to floor 12: they walk off and go in.
    const d = deps([person(), person({ state: "toDest", x: 9, floor: 12 }), undefined]);
    const c = new PersonCardController(d);
    c.open(5);
    c.tick();
    c.tick();
    expect(shown(d)).toContain("They reached Floor 12.");
    expect(shown(d)).not.toContain("left the tower");
    expect(d.setFollow).toHaveBeenLastCalledWith(false);
  });

  it("rings the person again on a view rebuilt after a lost graphics context", () => {
    const d = deps([person()]);
    const c = new PersonCardController(d);
    c.open(5);
    d.focus.mockClear();
    c.tick();
    expect(d.focus).not.toHaveBeenCalled(); // still ringed
    d.ringed.mockReturnValue(false);
    c.tick();
    expect(d.ringed).toHaveBeenLastCalledWith(5);
    expect(d.focus).toHaveBeenCalledWith(5);
  });

  it("lets the person go once the window closes", () => {
    const d = deps([person()]);
    const c = new PersonCardController(d);
    c.open(5);
    d.closeWindow();
    c.tick();
    expect(c.openId).toBeNull();
    expect(d.focus).toHaveBeenLastCalledWith(null);
  });

  it("toggles the follow and leaves other buttons to the editor", () => {
    const d = deps([person()]);
    const c = new PersonCardController(d);
    expect(c.handleAction(PERSON_FOLLOW_ACTION)).toBe(false); // no card open
    c.open(5);
    expect(c.handleAction("rename")).toBe(false);
    expect(c.handleAction(PERSON_FOLLOW_ACTION)).toBe(true);
    expect(shown(d)).toContain("Stop following");
    expect(c.handleAction(PERSON_FOLLOW_ACTION)).toBe(true);
    expect(d.setFollow).toHaveBeenLastCalledWith(false);
    expect(shown(d)).toContain("Follow");
  });
});
