import { describe, expect, it } from "vitest";
import { render } from "lit-html";
import { scheduleReviewEntry, scheduleReviewTemplate, type ReviewRow } from "./scheduleReview";

const flat: ReviewRow = {
  id: 7,
  title: "Standard Elevator, floors 15–45",
  facts: "8 cars installed. 3 are on shift in every hour, weekdays and weekends.",
  preview: "Using all 8 cars puts 8 on shift in every hour instead of 3.",
  kept: false,
};
const staggered: ReviewRow = {
  id: 9,
  title: "Service Elevator, floors 31–44",
  facts: "8 cars installed. Between 1 and 3 are on shift.",
  kept: false,
};

const draw = (rows: readonly ReviewRow[]): HTMLElement => {
  const box = document.createElement("div");
  render(scheduleReviewTemplate(rows), box);
  return box;
};
const acts = (el: Element): string[] => [...el.querySelectorAll<HTMLElement>("[data-act]")].map((b) => b.dataset.act!);

describe("the elevator schedule review dialog", () => {
  it("offers a flat schedule the one-click recovery, keeping it and a review, and a staggered one only a review", () => {
    const box = draw([flat, staggered]);
    const [first, second] = [...box.querySelectorAll("li")];
    expect(acts(first!)).toEqual(["recover:7", "keep:7", "review:7"]);
    expect(acts(second!)).toEqual(["review:9"]);
    expect(first!.textContent).toContain(flat.preview);
  });

  it("names each button for its elevator, so a list of buttons still says which is which", () => {
    const box = draw([flat, staggered]);
    const labels = [...box.querySelectorAll("li button")].map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual([
      `Use all installed cars, ${flat.title}`,
      `Keep as is, ${flat.title}`,
      `Review schedule, ${flat.title}`,
      `Review schedule, ${staggered.title}`,
    ]);
    expect(box.querySelector("ul")!.getAttribute("role")).toBe("list");
  });

  it("drops the Keep button once the player has chosen it, and says so", () => {
    const box = draw([{ ...flat, kept: true }]);
    expect(acts(box.querySelector("li")!)).toEqual(["recover:7", "review:7"]);
    expect(box.textContent).toContain("You chose to keep this schedule as it is.");
  });

  it("is a labelled list of real, named buttons a phone user can reach, ending in Close", () => {
    const box = draw([flat, staggered]);
    expect(box.querySelector("ul")).not.toBeNull();
    for (const li of box.querySelectorAll("li")) {
      const label = li.getAttribute("aria-labelledby")!;
      expect(li.querySelector(`#${label}`)?.textContent).toMatch(/Elevator, floors/);
    }
    for (const button of box.querySelectorAll("button")) {
      expect(button.textContent!.trim().length).toBeGreaterThan(0);
    }
    expect(acts(box).slice(-1)[0]).toBe("close");
    expect(box.querySelector(".modal-actions:last-child [data-act='close']")).not.toBeNull();
  });

  it("says plainly that every elevator is fine when none is left, with nothing to press but Close", () => {
    const box = draw([]);
    expect(box.textContent).toContain("Every elevator in this tower puts all of its cars on shift");
    expect(acts(box)).toEqual(["close"]);
  });
});

describe("the Tower Statistics entry", () => {
  it("counts the elevators and is not a footer row the dialog would pin over the stats", () => {
    const box = document.createElement("div");
    render(scheduleReviewEntry(1), box);
    expect(box.textContent).toContain("1 elevator with idle cars");
    render(scheduleReviewEntry(3), box);
    expect(box.textContent).toContain("3 elevators with idle cars");
    expect(box.querySelector(".modal-actions")).toBeNull();
    expect(box.querySelector("[data-act='reviewSchedules']")).not.toBeNull();
  });
});
