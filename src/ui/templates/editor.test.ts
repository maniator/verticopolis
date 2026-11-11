import { describe, it, expect } from "vitest";
import { html, type TemplateResult } from "lit-html";
import { catalogFacility } from "../../catalog/catalogTypes";
import { transportLoadLines } from "../../game/cardLines";
import type { TransportDetail, UnitDetail } from "../../simport/panels";
import type { FacilityKind, GameMode } from "../../shared/types";
import { catalogFor } from "../../tests/catalogFixture";
import { stopRows, transportDetail, unitDetail } from "../../tests/fixtures/detailCards";
import { groupDigits } from "../format";
import { renderToFragment } from "../testing/litTestUtils";
import { transportEditorTemplate, unitEditorTemplate } from "./editor";

/**
 * The editor card bodies (E6-S1). Package: the title bar's ✕ a11y contract,
 * the `data-edit`/`data-field` markers main.ts and the action dispatch read,
 * the rename input's value binding, the disabled bounds on the car buttons,
 * hostile-label escaping, and every row/action branch: office (rename +
 * adjuster), sold and unsold condos, hotel room rate, a closed venue's
 * customer count, cinema operational/gutted, No Rate, the mobile diagnostics
 * fold-in, elevator car bounds, express vs standard stops, and fixed-span
 * stairs. The templates were proven structurally equivalent to the retired
 * `unitEditorHtml`/`transportEditorHtml` by transitional guards (removed with
 * the string builders in the final sweep; see git history). The cards are
 * hand-built (`detailCards.ts`): each test states the fields its branch
 * reads, and the cards the engine answers are decoded in `cards.test.ts` and
 * `portReader.integration.test.ts`. The diff/identity mechanics live in
 * `editorPatch.test.ts`; the UI wiring in the integration spec.
 */


/** The 07:00 the cards read by default: every venue is open. */
const MORNING = 7;

/** A unit card of `kind` in `mode`, occupied and served on floor 2. */
const unit = (kind: FacilityKind, over: Partial<UnitDetail> = {}, mode: GameMode = "classic") => unitDetail(mode, kind, over);

/** The mobile fold-in's lines for a commuter unit: the engine's access line. */
const ACCESS_LINES: TemplateResult[] = [html`<div>Access: reachable from the lobby.</div>`];

function unitEditor(u: UnitDetail, opts: { mode?: GameMode; mobile?: boolean; hour?: number; lines?: TemplateResult[] } = {}): TemplateResult {
  const mobile = opts.mobile ?? false;
  return unitEditorTemplate(u, catalogFor(opts.mode ?? "classic"), opts.hour ?? MORNING, mobile, mobile ? (opts.lines ?? ACCESS_LINES) : []);
}

function transportEditor(t: TransportDetail, mobile = false): TemplateResult {
  return transportEditorTemplate(t, catalogFor("classic"), mobile ? transportLoadLines(t.utilization ?? undefined, t.nearCapacity) : []);
}

const maxCars = (kind: FacilityKind) => catalogFacility(catalogFor("classic"), kind).maxCars!;

describe("unit editor template structure", () => {
  it("title bar ✕ keeps the shared recipe and its aria-label; cells carry data-field markers", () => {
    const frag = renderToFragment(unitEditor(unit("office")));
    const x = frag.querySelector<HTMLButtonElement>("h4.win-title > button.ed-close")!;
    expect(x).not.toBeNull();
    expect(x.getAttribute("aria-label")).toBe("Close");
    expect([...x.classList].sort()).toEqual(["btn", "ed-close", "xs"]);
    for (const field of ["status", "occupants", "served", "eval", "rent"]) {
      expect(frag.querySelector(`[data-field="${field}"]`), field).not.toBeNull();
    }
    expect(frag.querySelector('button.danger[data-edit="sell"]')).not.toBeNull();
  });

  it("binds the unit label as the rename input's value", () => {
    const frag = renderToFragment(unitEditor(unit("office", { label: "Acme Corp" })));
    expect(frag.querySelector<HTMLInputElement>("#ed-name")!.value).toBe("Acme Corp");
  });

  it("renders a hostile unit label and retail subtype as literal text, injecting no element", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const frag = renderToFragment(unitEditor(unit("shop", { subtype: hostile }))); // the subtype titles the card
    expect(frag.querySelector("img")).toBeNull();
    expect(frag.querySelector("h4.win-title")!.textContent).toContain(hostile);
  });
});

describe("transport editor template structure", () => {
  it("car buttons disable at the pool bounds", () => {
    let frag = renderToFragment(transportEditor(transportDetail("elevatorStandard", 2, { cars: 1 })));
    expect(frag.querySelector<HTMLButtonElement>('[data-edit="removecar"]')!.disabled).toBe(true);
    expect(frag.querySelector<HTMLButtonElement>('[data-edit="addcar"]')!.disabled).toBe(false);
    // addcar disables at the catalog's car limit
    frag = renderToFragment(transportEditor(transportDetail("elevatorStandard", 2, { cars: maxCars("elevatorStandard") })));
    expect(frag.querySelector<HTMLButtonElement>('[data-edit="removecar"]')!.disabled).toBe(false);
    expect(frag.querySelector<HTMLButtonElement>('[data-edit="addcar"]')!.disabled).toBe(true);
  });

  it("an express offers no stop-config actions; stairs get neither cars nor extend arrows", () => {
    const eFrag = renderToFragment(transportEditor(transportDetail("elevatorExpress")));
    expect(eFrag.querySelector('[data-edit="stops"]')).toBeNull();
    expect(eFrag.querySelector('[data-edit="express"]')).toBeNull();
    expect(eFrag.querySelector('[data-edit="extendUp"]')).not.toBeNull();
    const sFrag = renderToFragment(transportEditor(transportDetail("stairs")));
    expect(sFrag.querySelector('[data-field="cars"]')).toBeNull();
    expect(sFrag.querySelector('[data-edit="extendUp"]')).toBeNull();
    expect(sFrag.querySelector('[data-edit="sell"]')).not.toBeNull();
  });
});

describe("unit editor row and action branches", () => {
  it("office: desktop keeps the access row; the mobile fold-in swaps it for diagnostics", () => {
    const desktop = renderToFragment(unitEditor(unit("office")));
    expect(desktop.querySelector('[data-field="served"]')).not.toBeNull();
    expect(desktop.querySelector(".ed-diagnostics")).toBeNull();
    const mobile = renderToFragment(unitEditor(unit("office"), { mobile: true }));
    expect(mobile.querySelector('[data-field="served"]')).toBeNull();
    expect(mobile.querySelector(".ed-diagnostics")).not.toBeNull();
  });

  it("security (zero-population service kind): mobile keeps the plain access row", () => {
    // Service kinds' diagnostics emit no access line, so the mobile fold-in
    // keeps the Yes/No row (the !hasAccessDiagnostic branch).
    const frag = renderToFragment(unitEditor(unit("security"), { mobile: true, lines: [] }));
    expect(frag.querySelector('[data-field="served"]')).not.toBeNull();
  });

  it("office: gutted swaps resale for scrap rows; No Rate reads where the price shows", () => {
    const gutted = renderToFragment(unitEditor(unit("office", { state: "gutted" })));
    expect(gutted.textContent).toContain("Scrap value");
    expect(gutted.textContent).toContain("Gutted: bulldoze and rebuild.");
    expect(gutted.textContent).not.toContain("Resale value");
    const offMarket = renderToFragment(unitEditor(unit("office", { noRate: true })));
    expect(offMarket.querySelector('[data-field="rent"]')!.textContent).toBe("No Rate");
  });

  it("condo (Classic): unsold offers the rung picker and batch action; sold locks the picker", () => {
    // built, never sold: the picker stays live
    const uFrag = renderToFragment(unitEditor(unit("condo", { state: "empty" })));
    expect(uFrag.textContent).toContain("Sale price");
    const picker = uFrag.querySelector<HTMLSelectElement>("#ed-rung")!;
    expect(picker).not.toBeNull();
    expect(picker.disabled).toBe(false);
    expect(uFrag.querySelector('[data-edit="rentUp"]')).toBeNull(); // no Modern stepper in Classic
    expect(uFrag.querySelector('[data-edit="batchKind"]')).not.toBeNull();
    // Very Low $50,000 is offered (canon firesale, below build cost, FR7).
    expect(picker.textContent).toContain("Very Low  $50,000");
    const sFrag = renderToFragment(unitEditor(unit("condo", { everOccupied: true, rent: 150_000 })));
    // Sold: price-locked, so the picker renders DISABLED at the locked rung
    // (showing why it cannot be pressed), and the batch action drops.
    const lockedPicker = sFrag.querySelector<HTMLSelectElement>("#ed-rung")!;
    expect(lockedPicker).not.toBeNull();
    expect(lockedPicker.disabled).toBe(true);
    expect(lockedPicker.dataset.current).toBe("2"); // Average, the locked rung
    expect(sFrag.querySelector('[data-edit="batchKind"]')).toBeNull();
  });

  it("condo (Modern): unsold offers the price stepper; sold drops the price row", () => {
    const uFrag = renderToFragment(unitEditor(unit("condo", { state: "empty" }, "modern"), { mode: "modern" }));
    expect(uFrag.textContent).toContain("Sale price");
    expect(uFrag.querySelector('[data-edit="rentUp"]')).not.toBeNull();
    expect(uFrag.querySelector("#ed-rung")).toBeNull(); // no rung picker in Modern
    expect(uFrag.querySelector('[data-edit="batchKind"]')).not.toBeNull();
    const sFrag = renderToFragment(unitEditor(unit("condo", { everOccupied: true, residents: 4 }, "modern"), { mode: "modern" }));
    expect(sFrag.querySelector('[data-edit="rentUp"]')).toBeNull();
    expect(sFrag.querySelector("#ed-rung")).toBeNull(); // Modern keeps the hidden-row behavior
    expect(sFrag.querySelector('[data-edit="batchKind"]')).toBeNull();
  });

  it("hotel single: nightly room rate", () => {
    const frag = renderToFragment(unitEditor(unit("hotelSingle")));
    expect(frag.textContent).toContain("Room rate");
    expect(frag.querySelector('[data-field="rent"]')!.textContent).toContain("/night");
  });

  it.each(["rentalStudio", "rentalApartment"] as const)("%s (Modern): the price is a monthly rent", (kind) => {
    const frag = renderToFragment(unitEditor(unit(kind, {}, "modern"), { mode: "modern" }));
    expect(frag.textContent).toContain("Monthly rent");
    expect(frag.textContent).not.toContain("Quarterly rent");
  });

  it("fast food: open and closed customer readouts", () => {
    const fastFood = unit("fastFood", { customersIn: 7 });
    const open = renderToFragment(unitEditor(fastFood)); // 07:00, open
    expect(open.querySelector('[data-field="customers"]')!.textContent).toBe("7");
    const closed = renderToFragment(unitEditor(fastFood, { hour: 23 })); // 23:00, closed
    expect(closed.querySelector('[data-field="customers"]')!.textContent).toBe("7 (closed)");
  });

  it("modern cinema: shows its film, offers the three films at the catalog's prices, and names the film it rebooks", () => {
    const modern = { mode: "modern" as const };
    const economy = catalogFor("modern").economy;
    const card = (over: Partial<UnitDetail>) => renderToFragment(unitEditor(unit("cinema", over, "modern"), modern));
    const op = card({ filmPolicy: "blockbuster", filmTier: "blockbuster", filmDays: 9 });
    expect(op.querySelector('[data-field="showing"]')!.textContent).toBe("Blockbuster");
    expect(op.querySelector('[data-field="filmDays"]')!.textContent).toBe("9");
    expect(op.querySelector('[data-edit="filmPolicy"]')!.textContent).toBe("Auto-rebook: Blockbuster ▸");
    for (const film of economy.films) {
      expect(op.querySelector(`[data-edit="${film.key}Film"]`)!.textContent).toBe(`${film.label} ($${groupDigits(film.price)})`);
    }
    expect(economy.films.map((f) => f.label)).toEqual(["Revival", "Feature", "Blockbuster"]);
    const rebooks = (filmPolicy: UnitDetail["filmPolicy"]) => card({ filmPolicy, filmTier: "new" }).querySelector('[data-edit="filmPolicy"]')!.textContent;
    expect([null, "auto", "feature", "revival", "off"].map((p) => rebooks(p as UnitDetail["filmPolicy"]))).toEqual([
      "Auto-rebook: Feature ▸",
      "Auto-rebook: Feature ▸",
      "Auto-rebook: Feature ▸",
      "Auto-rebook: Revival ▸",
      "Auto-rebook: Off ▸",
    ]);
    const gutted = card({ filmPolicy: "blockbuster", state: "gutted" });
    expect(gutted.textContent).not.toContain("Now showing");
    expect(gutted.querySelector('[data-edit="newFilm"]')).toBeNull();
  });

  it("classic cinema: shows the film and its days, and offers a new film or a classic at the catalog's prices", () => {
    const economy = catalogFor("classic").economy;
    const film = (classic: boolean) => renderToFragment(unitEditor(unit("cinema", { filmDays: 4, filmTier: classic ? "classic" : "new" })));
    const fresh = film(false);
    expect(fresh.querySelector('[data-field="showing"]')!.textContent).toBe("New film");
    expect(fresh.querySelector('[data-field="filmDays"]')!.textContent).toBe("4");
    const price = (key: string) => groupDigits(economy.films.find((f) => f.key === key)!.price);
    expect(fresh.querySelector('[data-edit="newFilm"]')!.textContent).toBe(`New film ($${price("new")})`);
    expect(fresh.querySelector('[data-edit="classicFilm"]')!.textContent).toBe(`Classic film ($${price("classic")})`);
    expect(fresh.querySelector('[data-edit="blockbusterFilm"]')).toBeNull();
    expect(fresh.querySelector('[data-edit="filmPolicy"]')).toBeNull();
    expect(film(true).querySelector('[data-field="showing"]')!.textContent).toBe("Classic film");
    const gutted = renderToFragment(unitEditor(unit("cinema", { state: "gutted" })));
    expect(gutted.textContent).not.toContain("Days showing");
    expect(gutted.querySelector('[data-edit="newFilm"]')).toBeNull();
    expect(gutted.querySelector('[data-edit="filmPolicy"]')).toBeNull();
  });
});

describe("transport editor row and action branches", () => {
  it("standard elevator: a skipped floor reads plainly (never borrowing the express copy)", () => {
    expect(renderToFragment(transportEditor(transportDetail("elevatorStandard", 4))).querySelector('[data-field="stops"]')!.textContent).toBe(
      "all floors",
    );
    const skipping = transportDetail("elevatorStandard", 4, { stops: stopRows(1, 4, [3]) });
    const stops = renderToFragment(transportEditor(skipping)).querySelector('[data-field="stops"]')!.textContent!;
    expect(stops).toBe("skips 1 floor");
    expect(stops).not.toContain("express");
  });

  it("serves and height cells read the span in plain copy", () => {
    const frag = renderToFragment(transportEditor(transportDetail("elevatorStandard")));
    expect(frag.querySelector('[data-field="serves"]')!.textContent).toBe("1 – 2");
    expect(frag.querySelector('[data-field="height"]')!.textContent).toBe("2 floors");
  });

  it("mobile folds the transport diagnostics block in", () => {
    // A passenger elevator reports its average load once the engine has
    // measured it, and the load line folds in (an idle shaft has no
    // measurement and no line, which the mobile editor renders as no block).
    const lift = transportDetail("elevatorStandard", 4, { utilization: 0.5 });
    const mobile = renderToFragment(transportEditor(lift, true));
    expect(mobile.querySelector(".ed-diagnostics")).not.toBeNull();
    expect(mobile.textContent).toContain("Avg load: 50% full");
    // Desktop leaves the diagnostics to the hover card, so it carries no block.
    expect(renderToFragment(transportEditor(lift)).querySelector(".ed-diagnostics")).toBeNull();
  });

  it("mobile omits the diagnostics block for an idle elevator with no measured load", () => {
    // No utilization recorded yet: transportDiagnostics is empty, so the mobile
    // editor renders no empty .ed-diagnostics box (parity with the old empty
    // div's `:empty { display:none }`, now expressed as no box at all).
    expect(renderToFragment(transportEditor(transportDetail("elevatorStandard", 4), true)).querySelector(".ed-diagnostics")).toBeNull();
  });

  it("express elevator surfaces a preserved skipped lobby honestly", () => {
    expect(renderToFragment(transportEditor(transportDetail("elevatorExpress", 3))).querySelector('[data-field="stops"]')!.textContent).toBe(
      "lobbies and sky lobbies",
    );
    // A legacy/forged save can carry a deliberately skipped lobby; the Stops
    // readout surfaces the count instead of overstating the policy.
    const frag = renderToFragment(transportEditor(transportDetail("elevatorExpress", 3, { stops: stopRows(1, 3, [1]) })));
    expect(frag.querySelector('[data-field="stops"]')!.textContent).toBe("lobbies and sky lobbies (1 skipped)");
  });

  it("service elevator keeps the elevator rows; an escalator is a fixed-span flight", () => {
    const sFrag = renderToFragment(transportEditor(transportDetail("elevatorService")));
    expect(sFrag.querySelector('[data-field="cars"]')).not.toBeNull();
    // Stops config folded into the Schedule dialog (#464): no card button remains.
    expect(sFrag.querySelector('[data-edit="stops"]')).toBeNull();
    expect(sFrag.querySelector('[data-edit="schedule"]')).not.toBeNull();
    const eFrag = renderToFragment(transportEditor(transportDetail("escalator")));
    expect(eFrag.querySelector('[data-field="cars"]')).toBeNull();
    expect(eFrag.querySelector('[data-edit="extendUp"]')).toBeNull();
    expect(eFrag.querySelector('[data-edit="sell"]')).not.toBeNull();
  });
});

describe("the Classic rung picker row (ux-pricing-split-editor §1)", () => {
  it("renders the four canon rungs, the divider, and No Rate, labels verbatim from the engine's catalog", () => {
    const frag = renderToFragment(unitEditor(unit("office")));
    const picker = frag.querySelector<HTMLSelectElement>("#ed-rung")!;
    expect(picker).not.toBeNull();
    expect(picker.classList.contains("field")).toBe(true);
    expect(picker.dataset.editSelect).toBe("rung"); // routes through the delegated change listener
    const options = [...picker.querySelectorAll("option")];
    expect(options.map((o) => o.textContent)).toEqual([
      "Very Low  $2,000",
      "Low  $5,000",
      "Average  $10,000",
      "High  $15,000",
      "──────",
      "No Rate",
    ]);
    expect(options[4].disabled).toBe(true); // the divider is not a choice
    expect(options.map((o) => o.value).slice(0, 4)).toEqual(["0", "1", "2", "3"]);
    expect(options[5].value).toBe("noRate");
    // Engine truth rides data-current for the post-render selection sync.
    expect(picker.dataset.current).toBe("2"); // Average, the default rung
    // No Modern stepper row exists beside it.
    expect(frag.querySelector('[data-edit="rentUp"]')).toBeNull();
    expect(frag.querySelector('[data-edit="rentDown"]')).toBeNull();
  });

  it("the chip carries the rung color slot, is decorative, and hollows out for No Rate", () => {
    const priced = renderToFragment(unitEditor(unit("office")));
    const chip = priced.querySelector<HTMLElement>(".rung-chip")!;
    expect(chip).not.toBeNull();
    expect(chip.getAttribute("aria-hidden")).toBe("true"); // color never carries the state alone
    expect(chip.dataset.rung).toBe("2");
    expect(renderToFragment(unitEditor(unit("office", { rent: 15_000 }))).querySelector<HTMLElement>(".rung-chip")!.dataset.rung).toBe("3");
    const off = renderToFragment(unitEditor(unit("office", { rent: 15_000, noRate: true })));
    expect(off.querySelector<HTMLElement>(".rung-chip")!.dataset.rung).toBe("none");
    expect(off.querySelector<HTMLSelectElement>("#ed-rung")!.dataset.current).toBe("noRate");
  });

  it("hotel kinds get the picker with their own canon ladder", () => {
    const picker = renderToFragment(unitEditor(unit("hotelSuite"))).querySelector<HTMLSelectElement>("#ed-rung")!;
    expect([...picker.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Very Low  $1,500",
      "Low  $4,000",
      "Average  $6,000",
      "High  $9,000",
      "──────",
      "No Rate",
    ]);
  });

  it("Modern offices keep the stepper and never see a picker or a No Rate option", () => {
    const frag = renderToFragment(unitEditor(unit("office", {}, "modern"), { mode: "modern" }));
    expect(frag.querySelector("#ed-rung")).toBeNull();
    expect(frag.querySelector('[data-edit="rentUp"]')).not.toBeNull();
    expect(frag.textContent).not.toContain("No Rate");
  });
});

describe("the editor access row's third state (#370)", () => {
  it("a served but unreachable (cut-off) floor reads 'No route' in the bad color for commuter kinds", () => {
    // The engine's cut-off verdict: served, but no commuter completes the trip.
    const frag = renderToFragment(unitEditor(unit("office", { served: true, reachable: false })));
    const cell = frag.querySelector('[data-field="served"]')!;
    expect(cell.textContent).toBe("No route");
    expect(cell.innerHTML).toContain("var(--bad)");
  });

  it("served and reachable reads Yes in the good color; unserved reads No", () => {
    const yes = renderToFragment(unitEditor(unit("office", { served: true, reachable: true }))).querySelector('[data-field="served"]')!;
    expect(yes.textContent).toBe("Yes");
    expect(yes.innerHTML).toContain("var(--good)");
    const no = renderToFragment(unitEditor(unit("office", { served: false, reachable: false }))).querySelector('[data-field="served"]')!;
    expect(no.textContent).toBe("No");
    expect(no.innerHTML).toContain("var(--bad)");
  });

  it("a zero-population service kind keeps plain Yes/No (the reachability line is about passenger trips)", () => {
    // The reachability verdict must be ignored for service kinds.
    const cell = renderToFragment(unitEditor(unit("security", { served: true, reachable: false }))).querySelector('[data-field="served"]')!;
    expect(cell.textContent).toBe("Yes");
  });
});
