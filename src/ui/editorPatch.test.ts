// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { patchVolatile } from "./UI";

describe("patchVolatile — editor updates in place", () => {
  it("updates volatile cells but keeps the buttons the SAME elements (no swallowed clicks)", () => {
    const card = document.createElement("div");
    card.innerHTML =
      `<span class="v" data-field="eval">50%</span>` +
      `<span class="v" data-field="rent">$10,000</span>` +
      `<button data-edit="rentUp">+ rent</button>`;
    const btn = card.querySelector("button")!;
    const evalCell = card.querySelector('[data-field="eval"]')!;

    patchVolatile(card, { eval: "78%", rent: "$14,000" });

    expect(evalCell.innerHTML).toBe("78%");
    expect(card.querySelector('[data-field="rent"]')!.innerHTML).toBe("$14,000");
    // Same element identities → a click that began before the patch still lands.
    expect(card.querySelector("button")).toBe(btn);
    expect(card.querySelector('[data-field="eval"]')).toBe(evalCell);
  });

  it("ignores unknown fields and skips no-op writes", () => {
    const card = document.createElement("div");
    card.innerHTML = `<span data-field="status">occupied</span>`;
    const cell = card.querySelector('[data-field="status"]')!;
    patchVolatile(card, { status: "occupied", nope: "x" });
    expect(cell.innerHTML).toBe("occupied");
    expect(card.querySelector('[data-field="nope"]')).toBeNull();
  });
});
