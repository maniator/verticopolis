import { describe, it, expect, vi } from "vitest";
import { renderToFragment } from "../testing/litTestUtils";

/**
 * The Help dialog's "Open the full help page" link in a WRAPPED build.
 *
 * The link is a real `<a href="/help" target="_blank">`, and a wrapper shell
 * can honor neither half: it serves no `/help` route and its window-open
 * handler denies every new window, so a trusted click did nothing in the
 * packaged desktop shell (#720). `helpTemplate` therefore withholds the anchor
 * behind `IS_WRAPPED_BUILD`, the same compile-time gate behind the
 * hostCommands and desktopSaveStore folds (the splash install button is a
 * different animal: it gates at runtime on `isWrappedMode` and ships its
 * markup everywhere), and that constant is false under vitest by
 * construction (the mode is `"test"`). No default-mode test can reach the
 * wrapped branch, so this file mocks the platform module the way
 * `hostCommandsWiring.test.ts` does and pins the anchor's absence. The
 * browser-build twin (the anchor present) lives in `help.test.ts`.
 */

vi.mock("../../platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../platform")>()),
  // The whole point: pretend this is a wrapped build.
  IS_WRAPPED_BUILD: true,
}));

const { helpTemplate } = await import("./help");

const noop = { onReplay: () => {} };

describe("helpTemplate in a wrapped build", () => {
  it("withholds the full-page link, a dead control in a shell with no /help route", () => {
    const frag = renderToFragment(helpTemplate(false, "1.2.3", noop));
    expect(frag.querySelector('a[data-act="open-help"]')).toBeNull();
    expect(frag.querySelector(".help-fullpage")).toBeNull();
  });

  it("keeps the Classic vs Modern comparison inline, so withholding loses no content", () => {
    const frag = renderToFragment(helpTemplate(false, "1.2.3", noop));
    const compare = [...frag.querySelectorAll<HTMLDetailsElement>("details.help-modes")].find(
      (d) => d.querySelector("summary")?.textContent?.trim() === "Classic vs Modern",
    );
    expect(compare, "the Classic vs Modern section must survive the withheld link").not.toBeUndefined();
    expect(compare!.textContent).toContain("pixel-faithful to 1994");
    // The report link stays: the controller routes it through the platform
    // wrapper (routeExternalInWrapper), so it works in a shell.
    expect(frag.querySelector(".help-report a")).not.toBeNull();
  });
});
