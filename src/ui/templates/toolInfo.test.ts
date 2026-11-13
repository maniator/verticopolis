import { describe, it, expect, vi } from "vitest";
import { toolInfoFor, toolInfoTemplate } from "./toolInfo";
import { catalogFor } from "../../tests/catalogFixture";
import { renderToFragment } from "../testing/litTestUtils";
import { groupDigits } from "../format";

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
    expect(frag.textContent).toContain(`Cost: $${groupDigits(office.cost)}`);
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

  it("adds the ground-floor lobby note when a lobby cost is passed (the Floor tool)", () => {
    const floorTool = { name: "Floor", cost: 500, population: 0, description: "Structural floor space." };
    const frag = renderToFragment(toolInfoTemplate(floorTool, false, 5000));
    expect(frag.textContent).toContain("ground floor");
    expect(frag.textContent).toContain(`$${groupDigits(5000)} per tile`);
  });

  it("omits the ground-floor note when no lobby cost is passed", () => {
    const floorTool = { name: "Floor", cost: 500, population: 0, description: "Structural floor space." };
    const frag = renderToFragment(toolInfoTemplate(floorTool, false));
    expect(frag.textContent).not.toContain("ground floor");
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

describe("toolInfoFor words the card from the tower's catalog (#1987)", () => {
  it("stands the wedding hall on the catalog's top floor", () => {
    const catalog = catalogFor("modern");
    const taller = { ...catalog, world: { ...catalog.world, maxFloor: catalog.world.maxFloor + 20 } };
    const text = renderToFragment(toolInfoFor(taller, "weddingHall")).textContent ?? "";
    expect(text).toContain(`standing on floor ${catalog.world.maxFloor + 20}.`);
  });
});

describe("the Lobby card's height picker (#308)", () => {
  const picker = (picked: number) => ({ picked, pick: vi.fn() });

  it("offers one to the catalog's most stories, marks the pick, and picks on a click", () => {
    const lobbyPick = picker(2);
    const frag = renderToFragment(toolInfoFor(catalogFor("classic"), "lobby", lobbyPick));
    const buttons = [...frag.querySelectorAll<HTMLButtonElement>(".ti-lobby-height button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["1 story", "2 stories", "3 stories"]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    buttons[2].click();
    expect(lobbyPick.pick).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("says which lobbies rise from the catalog's rule, and prices a story", () => {
    const classic = renderToFragment(toolInfoFor(catalogFor("classic"), "lobby", picker(1))).textContent ?? "";
    const modern = renderToFragment(toolInfoFor(catalogFor("modern"), "lobby", picker(1))).textContent ?? "";
    expect(classic).toContain("Only the ground lobby can rise.");
    expect(modern).toContain("The ground lobby and sky lobbies can rise.");
    const per = groupDigits(catalogFor("classic").facilities.find((f) => f.key === "lobby")!.cost);
    expect(classic).toContain(`Each story costs $${per} a tile.`);
  });

  it("shows no picker on another tool's card, or with no picker given", () => {
    expect(renderToFragment(toolInfoFor(catalogFor("classic"), "office", picker(1))).querySelector(".ti-lobby-height")).toBeNull();
    expect(renderToFragment(toolInfoFor(catalogFor("classic"), "lobby")).querySelector(".ti-lobby-height")).toBeNull();
  });
});
