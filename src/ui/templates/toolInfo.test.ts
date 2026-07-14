import { describe, it, expect } from "vitest";
import { toolInfoTemplate } from "./toolInfo";
import { renderToFragment } from "../testing/litTestUtils";

/**
 * The tool-info panel bodies (E5-S2, event-driven). Package: the build-kind
 * body's name/cost/description rows, the capacity-vs-customers conditional row
 * (present for residential capacity, commercial customers, absent at zero
 * population), and the auto-escaping of catalog copy. The selectTool
 * wiring (render into `#tool-info`, the placeholder clear, the template swap
 * between tools) is pinned by the tool-info integration tests.
 */

const office = { name: "Office", cost: 40000, population: 6, description: "Rents to a business. Pays quarterly." };
const restaurant = { name: "Restaurant", cost: 100000, population: 24, description: "Evening crowd magnet." };
const lobby = { name: "Lobby", cost: 5000, population: 0, description: "The ground-floor entrance." };

describe("toolInfoTemplate rows", () => {
  it("renders name, formatted cost, capacity, and description for a residential kind", () => {
    const frag = renderToFragment(toolInfoTemplate(office, false));
    expect(frag.querySelector(".ti-name")!.textContent).toBe("Office");
    // Locale-agnostic: compare against the same toLocaleString the template uses.
    expect(frag.textContent).toContain(`Cost: $${office.cost.toLocaleString()}`);
    expect(frag.textContent).toContain("Capacity: 6");
    expect(frag.querySelector("p")!.textContent).toBe(office.description);
  });

  it("labels a commercial kind's population as customers, not capacity", () => {
    const frag = renderToFragment(toolInfoTemplate(restaurant, true));
    expect(frag.textContent).toContain("Customers: up to 24");
    expect(frag.textContent).not.toContain("Capacity");
  });

  it("omits the population row entirely at zero population", () => {
    const frag = renderToFragment(toolInfoTemplate(lobby, false));
    expect(frag.textContent).not.toContain("Capacity");
    expect(frag.textContent).not.toContain("Customers");
    expect(frag.querySelectorAll("div")).toHaveLength(2); // name + cost only
  });
});

describe("toolInfoTemplate escapes catalog copy as text", () => {
  it("renders hostile name and description as literal text, injecting no element", () => {
    // The catalog is trusted static copy, but lit hardens it for free (the
    // legacy builder interpolated these raw); this pins that hardening.
    const hostile = `<img src=x onerror="alert(1)">`;
    const frag = renderToFragment(toolInfoTemplate({ name: hostile, cost: 1, population: 0, description: hostile }, false));
    expect(frag.querySelector("img")).toBeNull();
    expect(frag.querySelector(".ti-name")!.textContent).toBe(hostile);
    expect(frag.querySelector("p")!.textContent).toBe(hostile);
  });
});
