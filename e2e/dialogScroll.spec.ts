import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { expectEngineHosted } from "./helpers";

/**
 * One scroll container per dialog (#717, #513), checked in a real browser.
 *
 * The Help dialog once shipped with two vertical scrollbars: Chromium's UA
 * stylesheet gives an open `<dialog>` `overflow: auto`, so once a dialog's
 * content passed the box's 82vh cap the dialog element became a second live
 * scroller and clipped the window's drop shadow. Here each dialog opens on a
 * screen where it overflows, and the test reads the layout: the dialog
 * element keeps `overflow: visible`, and the only elements under it that
 * scroll are `.modal-box` and, for three dialogs, the one list the owner
 * asked to scroll in place: the update prompt's notes log (#1897), the Open
 * window's file list, and the Elevator Schedule's floor grid on a phone
 * (#513). The pinned footer shots in the gallery
 * (`scripts/scenes/dialogPinShots.ts`) check the footer stays on screen.
 */

test.afterEach(async ({ page }) => expectEngineHosted(page));

/** Short enough that About and Settings overflow their 82vh cap. */
const SHORT = { width: 720, height: 360 };
const PHONE = { width: 390, height: 844 };

async function onGame(page: Page, viewport = SHORT): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), undefined, {
    timeout: 30_000,
  });
  await page.evaluate(() => document.getElementById("splash")?.remove());
}

/** The open dialog's overflow (visible, so the dialog itself never scrolls
 *  and the window's shadow is not clipped), and every element under it that
 *  scrolls now, named by `.modal-box` or the class the caller passes. */
async function scrollers(page: Page, inner?: string) {
  return page.evaluate((innerClass) => {
    const modal = document.querySelector("#modal") as HTMLElement;
    const style = getComputedStyle(modal);
    const box = modal.querySelector(".modal-box") as HTMLElement;
    const live = [...modal.querySelectorAll<HTMLElement>("*")]
      .filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight)
      .map((el) => {
        if (el === box) return ".modal-box";
        if (innerClass && el.classList.contains(innerClass)) return `.${innerClass}`;
        if (el.id) return `#${el.id}`;
        return `.${[...el.classList].join(".")}`;
      });
    return {
      overflow: [style.overflowX, style.overflowY],
      boxOverflows: box.scrollHeight > box.clientHeight,
      live,
    };
  }, inner);
}

test("About this game scrolls in one container on a short window", async ({ page }) => {
  await onGame(page);
  await page.evaluate(() => window.game.ui.showAbout());
  await expect(page.locator("#modal .help-diagnostics")).toBeVisible();
  const s = await scrollers(page);
  expect(s.boxOverflows, "About must overflow the short window for this test to mean anything").toBe(true);
  expect(s.overflow).toEqual(["visible", "visible"]);
  expect(s.live).toEqual([".modal-box"]);
});

test("Settings scrolls in one container on a short window", async ({ page }) => {
  await onGame(page);
  await page.evaluate(() => document.getElementById("btn-settings")?.click());
  await expect(page.locator("#modal #vol-music")).toBeAttached();
  const s = await scrollers(page);
  expect(s.boxOverflows, "Settings must overflow the short window for this test to mean anything").toBe(true);
  expect(s.overflow).toEqual(["visible", "visible"]);
  expect(s.live).toEqual([".modal-box"]);
});

test("the update prompt's notes log is its one inner scroller", async ({ page }) => {
  await onGame(page);
  await page.evaluate(() => {
    const releases = ["9.0.3", "9.0.2", "9.0.1", "9.0.0"].map((version) => ({
      version,
      notes: Array.from(
        { length: 6 },
        (_, i) => `A change in ${version}, number ${i + 1}, described in a full sentence.`,
      ),
    }));
    window.game.ui.showUpdatePrompt(
      () => {},
      () => {},
      { version: "9.0.3", since: "8.9.0", notes: releases[0].notes, releases },
    );
  });
  await expect(page.locator("#modal .whatsnew-log")).toBeVisible();
  const s = await scrollers(page, "whatsnew-log");
  expect(s.live, "the notes log must overflow for this test to mean anything").toContain(".whatsnew-log");
  expect(s.overflow).toEqual(["visible", "visible"]);
  expect(s.live.filter((name) => name !== ".modal-box")).toEqual([".whatsnew-log"]);
});

test("the Open window's file list is its one inner scroller", async ({ page }) => {
  await onGame(page);
  await page.evaluate(async () => {
    const g = window.game;
    for (let i = 1; i <= 16; i++) await g.saveFile(`Tower ${i}`);
  });
  await page.evaluate(() => document.getElementById("mb-import")?.click());
  await expect(page.locator("#modal .fd-rows .fd-row").first()).toBeVisible();
  const s = await scrollers(page, "fd-rows");
  expect(s.live, "the file list must overflow for this test to mean anything").toContain(".fd-rows");
  expect(s.overflow).toEqual(["visible", "visible"]);
  expect(s.live.filter((name) => name !== ".modal-box")).toEqual([".fd-rows"]);
});

test.describe("on a phone", () => {
  test.use({ isMobile: true, hasTouch: true });
  // A 75-floor tower on a software-rendered phone-sized page draws slowly.
  test.setTimeout(120_000);

  test("the Elevator Schedule's floor grid is its one inner scroller", async ({ page }) => {
    const tower = readFileSync(
      new URL("../node_modules/@verticopolis/engine/conformance/fixtures/split-tower-4.vctower", import.meta.url),
      "utf8",
    );
    await onGame(page, PHONE);
    await page.evaluate((text) => {
      const g = window.game;
      g.setSpeed(0);
      return g.saveLoad.importGame(text);
    }, tower);
    await expect(page.getByText("Tower imported.")).toBeVisible();
    await page.evaluate(() => {
      const g = window.game;
      const shaft = g.sim.tower.transports.find((t) => t.kind === "elevatorStandard")!;
      g.selected = { type: "transport", id: shaft.id };
      g.engine.selectedId = shaft.id;
      g.refreshEditor();
      (document.querySelector('#editor [data-edit="schedule"]') as HTMLElement).click();
    });
    await expect(page.locator("#modal .es-grid")).toBeVisible();
    const s = await scrollers(page, "es-grid");
    expect(s.live, "the floor grid must overflow for this test to mean anything").toContain(".es-grid");
    expect(s.overflow).toEqual(["visible", "visible"]);
    expect(s.live.filter((name) => name !== ".modal-box")).toEqual([".es-grid"]);
  });
});
