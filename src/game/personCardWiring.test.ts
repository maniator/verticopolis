import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";
import type { PersonCardDeps } from "./personCard";

const focus = vi.hoisted(() => ({
  clearPersonFocus: vi.fn(),
  focusPerson: vi.fn(),
  focusedPerson: vi.fn(),
  notePersonPlace: vi.fn(),
  setFollow: vi.fn(),
}));
const person = vi.hoisted(() => vi.fn());
const waitMood = vi.hoisted(() => vi.fn(() => "impatient"));
const catalog = vi.hoisted(() => ({ rules: { fedUpWait: 120 } }));

vi.mock("../render/excalibur/personFocus", () => focus);
vi.mock("../render/excalibur/crowdLook", () => ({ waitMood }));
vi.mock("./portAccess", () => ({ catalogOf: () => catalog }));
vi.mock("../simport/personCards", () => ({
  PersonCards: class {
    person = person;
  },
}));
vi.mock("./personCard", () => ({
  PersonCardController: class {
    constructor(readonly deps: PersonCardDeps) {}
  },
}));

const { createPersonCard } = await import("./personCardWiring");

/** The deps the wiring hands the controller, for an app of spies. */
function wired() {
  const app = {
    engine: { tag: "engine" },
    enginePort: {},
    reader: { tower: { getTransport: vi.fn((id: number) => (id === 4 ? { kind: "elevatorExpress" } : undefined)) } },
    ui: { renderEditor: vi.fn(), isEditorOpen: vi.fn(() => true) },
  };
  const card = createPersonCard(app as unknown as GameApp) as unknown as { deps: PersonCardDeps };
  return { app, deps: card.deps };
}

describe("createPersonCard (#2092)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads people from the port and shafts from the view", () => {
    const { deps } = wired();
    person.mockReturnValue({ id: 3 });
    expect(deps.person(3)).toEqual({ id: 3 });
    expect(person).toHaveBeenCalledWith(3);
    expect(deps.catalog()).toBe(catalog);
    expect(deps.shaftKind(4)).toBe("elevatorExpress");
    expect(deps.shaftKind(5)).toBeNull();
  });

  it("gives a housekeeper no mood and a guest the figure's mood", () => {
    const { deps } = wired();
    expect(deps.mood(999, true)).toBe("content");
    expect(waitMood).not.toHaveBeenCalled();
    expect(deps.mood(90, false)).toBe("impatient");
    expect(waitMood).toHaveBeenCalledWith(90, 120);
  });

  it("renders into the editor window", () => {
    const { app, deps } = wired();
    const tpl = { t: 1 } as unknown as Parameters<PersonCardDeps["ui"]["renderEditor"]>[0];
    deps.ui.renderEditor(tpl);
    expect(app.ui.renderEditor).toHaveBeenCalledWith(tpl);
    expect(deps.ui.isEditorOpen()).toBe(true);
  });

  it("rings, places and follows through the renderer", () => {
    const { app, deps } = wired();
    deps.focus(7);
    expect(focus.focusPerson).toHaveBeenCalledWith(app.engine, 7);
    deps.focus(null);
    expect(focus.clearPersonFocus).toHaveBeenCalledWith(app.engine);
    deps.place(12, 3);
    expect(focus.notePersonPlace).toHaveBeenCalledWith(app.engine, 12, 3);
    deps.setFollow(true);
    expect(focus.setFollow).toHaveBeenCalledWith(app.engine, true);

    focus.focusedPerson.mockReturnValue({ id: 7, follow: true });
    expect(deps.ringed(7)).toBe(true);
    expect(deps.ringed(8)).toBe(false);
    expect(deps.following()).toBe(true);
    focus.focusedPerson.mockReturnValue(null);
    expect(deps.ringed(7)).toBe(false);
    expect(deps.following()).toBe(false);
  });
});
