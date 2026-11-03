import { describe, expect, it } from "vitest";
import { reloadChanged } from "./reloadCheck";

const view = (milestones: string[], money = 5) => ({ milestones, money });

describe("the reload check", () => {
  it("passes an unchanged view", () => {
    expect(reloadChanged(view(["pop-500"]), view(["pop-500"]))).toBe(false);
  });

  it("passes a milestone the load adds, to a list that held some or none", () => {
    expect(reloadChanged(view(["pop-500"]), view(["pop-500", "cinema"]))).toBe(false);
    expect(reloadChanged(view([]), view(["cinema"]))).toBe(false);
  });

  it("fails a milestone that is lost, changed or reordered", () => {
    const before = view(["pop-500", "cinema"]);
    expect(reloadChanged(before, view(["pop-500"]))).toBe(true);
    expect(reloadChanged(before, view(["pop-500", "metro"]))).toBe(true);
    expect(reloadChanged(before, view(["cinema", "pop-500"]))).toBe(true);
  });

  it("fails any other field that moves, even beside an added milestone", () => {
    expect(reloadChanged(view(["pop-500"]), view(["pop-500"], 6))).toBe(true);
    expect(reloadChanged(view(["pop-500"]), view(["pop-500", "cinema"], 6))).toBe(true);
  });

  it("compares a view with no milestone list whole", () => {
    expect(reloadChanged({ money: 1 }, { money: 1 })).toBe(false);
    expect(reloadChanged({ money: 1 }, { money: 2 })).toBe(true);
  });
});
