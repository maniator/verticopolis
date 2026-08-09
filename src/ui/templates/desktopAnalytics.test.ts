import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { desktopAnalyticsNoticeTemplate } from "./desktopAnalytics";
import { renderToFragment, click } from "../testing/litTestUtils";

const TEMPLATE_SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "./desktopAnalytics.ts");

/**
 * The desktop first-run analytics notice (issue #781). Static copy, so what is
 * packaged here is the two actions and the five things the ruling requires the
 * copy to say before anything is sent.
 */
describe("desktopAnalyticsNoticeTemplate", () => {
  const render = () =>
    renderToFragment(desktopAnalyticsNoticeTemplate({ onAccept: () => {}, onDecline: () => {} }));

  it("says what is measured, in plain terms, all four signals", () => {
    // All four, matching Help's Privacy list. The returning-player signal was
    // missing here at first, and its absence is how the notice came to claim
    // nothing carried over between visits: the one measured thing that does was
    // the one thing the copy did not name.
    const text = render().textContent ?? "";
    expect(text).toContain("anonymous counts");
    expect(text).toContain("place a first facility");
    expect(text).toContain("which tools get used");
    expect(text).toContain("whether returning players get further than first-timers");
  });

  it("makes an identity claim about the counts, never an absolute one", () => {
    // `getCommonProps` carries `returning`, `recency`, and `tenure` on every
    // event, all of them derived from state that survives a visit. They are
    // coarse buckets rather than identifiers, so the promise the copy can keep is
    // about identity. An absolute "nothing carries over" would be false.
    const text = render().textContent ?? "";
    expect(text).toContain("Nothing here identifies you");
    expect(text).toContain("nothing is kept that could point back to you across visits");
    expect(text).not.toContain("carries over");
  });

  it("surfaces the crash-report caveat about quoting game text", () => {
    // The one place a player's own words can travel. It is stated in the notice
    // rather than left for the Help text to disclose after the fact.
    const text = render().textContent ?? "";
    expect(text).toContain("quote a bit of game text, such as a tower's name");
  });

  it("says it can be turned off in Settings and names where the full text is", () => {
    const text = render().textContent ?? "";
    expect(text).toContain("turn this off at any time in Settings");
    expect(text).toContain("Help, under Privacy");
  });

  it("links to no external URL at all", () => {
    // The shell's external-link policy allows github.com and nothing else, so any
    // other href here would promise a door that does not open. The full privacy
    // text already ships in-app, which is what the copy points at instead.
    const frag = render();
    expect(frag.querySelector("a")).toBeNull();
    expect(frag.querySelector("[href]")).toBeNull();
    const markup = readFileSync(TEMPLATE_SOURCE, "utf8");
    expect(markup, "the source file could not be read, so this test proves nothing").toContain(
      "desktopAnalyticsNoticeTemplate",
    );
    // The whole module, comments included: a commented-out link is a link waiting
    // to be uncommented. `http` covers both schemes.
    expect(markup).not.toMatch(/https?:\/\//);
  });

  it("dispatches accept and decline from the two buttons", () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    const frag = renderToFragment(desktopAnalyticsNoticeTemplate({ onAccept, onDecline }));
    const accept = frag.querySelector<HTMLButtonElement>('[data-act="accept"]')!;
    const decline = frag.querySelector<HTMLButtonElement>('[data-act="decline"]')!;
    expect(accept.textContent).toBe("Sounds good");
    expect(decline.textContent).toBe("No thanks");
    // The primary is the accepting one and takes focus, matching every other
    // dialog: the keyboard lands on the default answer.
    expect([...accept.classList].sort()).toEqual(["btn", "primary"]);
    expect(accept.hasAttribute("autofocus")).toBe(true);
    click(decline);
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
    click(accept);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
});
