/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { lobbyDistanceFixture } from "../src/tests/fixtures/serviceDiagnostics.fixture";
import type { Unit } from "../src/shared/types";
import { buildInPage, expectEngineHosted } from "./helpers";

/**
 * The tenant explanations on the real Rust engine, in the browser (#1561's
 * canary). A saved tower with unhappy tenants (the unmodified `split-tower-4`
 * fixture) is imported the way a player imports a file; the engine's own
 * `unitFacts` picks the rooms whose cards owe a "Main gripe" or "Won't lease"
 * line, and the desktop inspector (the card a hover opens) and the 390px
 * editor must both print it. The missing "Main gripe" line is the regression
 * #1559 fixed, and this spec keeps it under a real page as well as the unit
 * tests. A second, built tower covers the No Rate, shoppers-too-far and
 * notice lines.
 */
const TOWER = readFileSync(new URL("../conformance/fixtures/split-tower-4.vctower", import.meta.url), "utf8");
const PHONE = { width: 390, height: 844 };

// A 75-floor tower on a software-rendered page draws slowly.
test.setTimeout(120_000);
test.afterEach(async ({ page }) => expectEngineHosted(page));

type Section = "gripe" | "wontLease" | "notice";

interface Room {
  id: number;
  kind: string;
  sections: Section[];
}

/** The first room whose engine facts carry each section, grouped by room. */
async function roomsWithSections(page: Page): Promise<Room[]> {
  return page.evaluate(() => {
    const g = (window as any).game;
    const slots: string[] = JSON.parse(g.enginePort.viewLayout()).records.unitFacts;
    const sections = ["gripe", "wontLease", "notice"] as const;
    const at = Object.fromEntries(sections.map((s) => {
      const i = slots.indexOf(s);
      if (i < 0) throw new Error(`the unitFacts layout has no "${s}" slot`);
      return [s, i];
    }));
    const isSet = (facts: Float64Array, s: string): boolean => facts[at[s]] === 1;
    const rooms = new Map<number, { id: number; kind: string; sections: string[] }>();
    const taken = new Set<string>();
    for (const u of g.sim.tower.units) {
      const facts = g.enginePort.unitFacts(u.id) as Float64Array;
      for (const s of sections) {
        if (taken.has(s) || !isSet(facts, s)) continue;
        taken.add(s);
        const room = rooms.get(u.id) ?? { id: u.id, kind: u.kind, sections: [] };
        room.sections.push(s);
        rooms.set(u.id, room);
      }
      if (taken.size === sections.length) break;
    }
    return [...rooms.values()] as Room[];
  });
}

const COPY: Record<Section, string> = { gripe: "Main gripe:", wontLease: "Won't lease:", notice: "Giving notice:" };

/** Open `room` on the desktop inspector or, on a phone, in the editor, and
 *  return the block its diagnostics print in. */
async function open(page: Page, room: { id: number; kind: string }, phone: boolean) {
  await page.evaluate(({ id, kind, phone }) => {
    const g = (window as any).game;
    if (phone) g.selectPicked({ type: "unit", id, kind });
    else g.inspector.inspectPicked({ type: "unit", id, kind });
  }, { id: room.id, kind: room.kind, phone });
  const surface = page.locator(phone ? "#editor .ed-diagnostics" : "#inspector");
  await expect(surface).toBeVisible();
  return surface;
}

/** `copy` appears in the block exactly once. */
async function expectOnce(surface: ReturnType<Page["locator"]>, copy: string, what: string): Promise<void> {
  await expect(surface).toContainText(copy);
  const count = await surface.evaluate((el, c) => el.textContent!.split(c).length - 1, copy);
  expect(count, `${what}: "${copy}" printed more than once`).toBe(1);
}

test("an imported tower's unhappy tenants explain themselves on the desktop card and the phone editor", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).__vcEngine?.status?.hosted && (window as any).game), undefined, { timeout: 30_000 });
  await page.evaluate((text) => {
    const g = (window as any).game;
    g.onboarding.dismissSplash();
    return g.saveLoad.importGame(text);
  }, TOWER);
  await expect(page.getByText("Tower imported.")).toBeVisible();
  // Hold the clock after the import, so no tenant's state moves while it is read.
  await page.evaluate(() => (window as any).game.setSpeed(0));
  const unmodified = (await roomsWithSections(page)).flatMap((r) => r.sections);
  // The canary: the unmodified split-tower-4 holds tenants with a main gripe.
  expect(unmodified, "split-tower-4 must hold a tenant with a main gripe").toContain("gripe");

  // Its only room that wouldn't lease was a condo beside the nightclub, which
  // no longer holds a fresh tenant (#1978). So an office tenant leaves over
  // the rent and the player prices the office at the top of its band, a rent
  // no fresh tenant stays for: a room the move-in gate holds.
  const held = await page.evaluate(() => {
    const g = (window as any).game;
    const office = g.sim.tower.units.find((u: any) =>
      u.kind === "office" && u.state === "occupied" && !u.noRate && g.sim.tower.isFloorServed(u.floor));
    if (!office) throw new Error("split-tower-4 has no occupied office on a served floor");
    if (!g.enginePort.vacateUnit(office.id, "rent")) throw new Error(`the engine refused to vacate office ${office.id}`);
    // A Modern price clamps to the band, so this asks for its top.
    g.enginePort.setRent(office.id, Number.MAX_SAFE_INTEGER);
    g.syncSim();
    return office.id as number;
  });

  const rooms = await roomsWithSections(page);
  const present = rooms.flatMap((r) => r.sections);
  test.info().annotations.push({ type: "sections", description: present.join(", ") });
  expect(present, "the overpriced empty office must be a room that won't lease").toContain("wontLease");
  expect(rooms.find((r) => r.sections.includes("wontLease"))?.id, "the held room is the office the test priced").toBe(held);

  for (const phone of [false, true]) {
    if (phone) await page.setViewportSize(PHONE);
    for (const room of rooms) {
      const surface = await open(page, room, phone);
      for (const section of room.sections) await expectOnce(surface, COPY[section], phone ? "editor" : "card");
    }
  }
});

/** Restore a built save on the hosted engine and follow the swap, as the
 *  app's history restore does, so the reader, card cache and panels refresh. */
async function loadSave(page: Page, save: string): Promise<void> {
  const ok = await page.evaluate((json) => {
    const g = (window as any).game;
    const answer = g.enginePort.restore(json);
    const RESTORED = 1;
    if (answer[0] !== RESTORED) throw new Error(`Rust rejected the fixture: ${g.enginePort.lastReason()}`);
    g.followSwap();
    g.setSpeed(0);
    return g.enginePort === (window as any).__vcEngine.port;
  }, save);
  expect(ok).toBe(true);
}

test("No Rate, shoppers too far, a notice and the editor's access row show on the Rust engine", async ({ page }) => {
  // Classic: Modern never holds the No Rate state, and both engines drop it on load there.
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).__vcEngine?.status?.hosted && (window as any).game), undefined, { timeout: 30_000 });
  await page.evaluate(() => (window as any).game.onboarding.dismissSplash());
  // Built on the page's own engine; the edit is self-contained, as it runs there too.
  const f = await buildInPage(page, lobbyDistanceFixture, "classic", ({ sim, office }) => {
    const room = (kind: string, floor: number, x: number): Unit => {
      const r = sim.tower.place(kind, floor, x);
      if (!r.ok || r.unitId === undefined) throw new Error(`place ${kind} at ${floor},${x}: ${r.reason ?? "no reason"}`);
      return sim.tower.getUnit(r.unitId) as Unit;
    };
    office.noRate = true;
    // An office on notice (only lease tenants such as offices and condos ever give notice).
    const leaving = room("office", 4, 235);
    leaving.state = "vacating";
    leaving.vacateReason = "rent";
    leaving.vacateAt = sim.clock.minutes + 600;
    // A security office draws no commuters, so it prints no access line, and the
    // phone editor shows its plain "Elevator access" row instead. The row's
    // answer is the floor being served, read from the engine's unit card. The
    // elevator runs 1 to 8, so a second office on a short floor 9 is unserved.
    for (let x = 190; x < 220; x++) {
      const slab = sim.tower.place("floor", 9, x);
      if (!slab.ok) throw new Error(`floor 9 at ${x}: ${slab.reason ?? "no reason"}`);
    }
    const guards = [room("security", 5, 200), room("security", 9, 200)];
    const access = guards.map((g) => (sim.tower.isFloorServed(g.floor) ? "Yes" : "No"));
    return { leaving, guards, access };
  });
  const { leaving, guards, access } = f;
  expect(access, "the engine reads one served floor and one unserved").toEqual(["Yes", "No"]);
  await loadSave(page, f.save);

  const checks: ReadonlyArray<readonly [{ id: number; kind: string }, string]> = [
    [f.office, "No Rate: the tenant stays"],
    [f.far, "Shoppers: too far from a lobby"],
    [leaving, "Giving notice:"],
  ];
  for (const phone of [false, true]) {
    if (phone) await page.setViewportSize(PHONE);
    for (const [room, copy] of checks) {
      const surface = await open(page, room, phone);
      await expectOnce(surface, copy, phone ? "editor" : "card");
    }
  }

  // The phone editor (still at 390px): the access row for each security office,
  // and none for the office, whose diagnostics carry the access line instead.
  for (const [i, guard] of guards.entries()) {
    await page.evaluate(({ id, kind }) => (window as any).game.selectPicked({ type: "unit", id, kind }), { id: guard.id, kind: guard.kind });
    await expect(page.locator('#editor [data-field="served"]'), `security on floor ${guard.floor}`).toHaveText(access[i]);
  }
  await page.evaluate(({ id, kind }) => (window as any).game.selectPicked({ type: "unit", id, kind }), { id: f.office.id, kind: f.office.kind });
  await expect(page.locator("#editor .ed-diagnostics")).toContainText("No Rate: the tenant stays");
  await expect(page.locator("#editor .ed-diagnostics")).toContainText("Access:");
  await expect(page.locator('#editor [data-field="served"]')).toHaveCount(0);
});
