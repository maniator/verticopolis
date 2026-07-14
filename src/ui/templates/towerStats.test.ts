import { describe, it, expect } from "vitest";
import { render } from "lit-html";
import { towerStatsTemplate, type TowerStatsSnapshot } from "./towerStats";
import { renderToFragment } from "../testing/litTestUtils";

/**
 * The tower-stats grid (E5-S1, the first live view). Package: the eight k/v rows
 * and their exact values, the dirty-rooms color branch both ways, and node
 * identity across re-renders with a changed snapshot (the pump path patches in
 * place, it never rebuilds). The pump wiring itself (render into
 * `#tower-stats` inside `uiStatus.update`) is priced and identity-checked
 * end-to-end by the E5-S0 perf gate.
 */

const snap = (over: Partial<TowerStatsSnapshot> = {}): TowerStatsSnapshot => ({
  floors: 42,
  basements: 3,
  occupiedOffices: 17,
  offices: 20,
  soldCondos: 5,
  condos: 8,
  occupiedHotel: 2,
  hotelRooms: 6,
  dirty: 0,
  shops: 4,
  restaurants: 3,
  transports: 9,
  vacant: 11,
  ...over,
});

describe("towerStatsTemplate values", () => {
  it("renders the eight k/v rows with the exact formatted values", () => {
    const frag = renderToFragment(towerStatsTemplate(snap()));
    const ks = [...frag.querySelectorAll(".k")].map((el) => el.textContent);
    const vs = [...frag.querySelectorAll(".v")].map((el) => el.textContent);
    expect(ks).toEqual([
      "Floors", "Offices", "Condos sold", "Hotel (in use)",
      "Rooms to clean", "Shops / Food", "Transports", "Vacancies",
    ]);
    expect(vs).toEqual(["42 / B3", "17/20", "5/8", "2/6", "0", "4 / 3", "9", "11"]);
  });

  it("colors the dirty-rooms value only when rooms need cleaning", () => {
    const clean = renderToFragment(towerStatsTemplate(snap({ dirty: 0 })));
    expect([...clean.querySelectorAll(".v")][4].getAttribute("style")).toContain("inherit");
    const dirty = renderToFragment(towerStatsTemplate(snap({ dirty: 7 })));
    const dirtyV = [...dirty.querySelectorAll(".v")][4];
    expect(dirtyV.getAttribute("style")).toContain("var(--bad)");
    expect(dirtyV.textContent).toBe("7");
  });
});

describe("towerStatsTemplate patches in place across pumps", () => {
  it("keeps every span's identity when re-rendered with a changed snapshot", () => {
    const box = document.createElement("div");
    render(towerStatsTemplate(snap()), box);
    const before = [...box.querySelectorAll("span")];
    render(towerStatsTemplate(snap({ floors: 43, dirty: 2, vacant: 10 })), box);
    const after = [...box.querySelectorAll("span")];
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) expect(after[i]).toBe(before[i]);
    // The changed values landed in the SAME nodes.
    const vs = [...box.querySelectorAll(".v")].map((el) => el.textContent);
    expect(vs[0]).toBe("43 / B3");
    expect(vs[4]).toBe("2");
    expect(vs[7]).toBe("10");
  });
});
