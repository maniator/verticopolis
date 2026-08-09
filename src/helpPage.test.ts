import { describe, it, expect, vi } from "vitest";
import { helpPageTemplate } from "./helpPage";
import { renderToFragment } from "./ui/testing/litTestUtils";
import { HELP_SECTIONS, helpPrivacyBody } from "./ui/templates/helpContent";

/**
 * The standalone `/help` page body: the full how-to-play guide. It renders the
 * SAME shared `HELP_SECTIONS` the in-game Help modal renders (so the copy has one
 * source and can never drift), inside the retro page shell with a working "Back
 * to game" anchor. Importing this module runs its `main()` once, which no-ops in
 * the test DOM (no `#app`), so the pure `helpPageTemplate()` is what we assert on.
 */
describe("helpPageTemplate", () => {
  it("leads with the How to Play heading", () => {
    const frag = renderToFragment(helpPageTemplate());
    expect(frag.querySelector("h1")?.textContent).toContain("How to Play");
  });

  it("renders every shared guide section, each under an anchored heading", () => {
    const frag = renderToFragment(helpPageTemplate());
    for (const s of HELP_SECTIONS) {
      const section = frag.querySelector(`section#${s.id}`);
      expect(section, `missing section #${s.id}`).not.toBeNull();
      expect(section!.querySelector("h2")?.textContent).toBe(s.title);
    }
    // The About section is on the page too.
    expect(frag.querySelector("section#about h2")?.textContent).toBe("About");
  });

  it("carries a deep-linkable Privacy section rendered from the one shared body", () => {
    const frag = renderToFragment(helpPageTemplate());
    const privacy = frag.querySelector("section#privacy");
    expect(privacy, "the privacy note must be its own #privacy section").not.toBeNull();
    expect(privacy!.querySelector("h2")?.textContent).toBe("Privacy");
    // Whitespace-normalized containment of the SHARED body's own rendered text:
    // this surface cannot fork the promise, because any wording change must
    // arrive through helpPrivacyBody or this containment fails.
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const shared = norm(renderToFragment(helpPrivacyBody()).textContent ?? "");
    expect(shared.length).toBeGreaterThan(100);
    expect(norm(privacy!.textContent ?? "")).toContain(shared);
    // And the shared body itself still makes the promise (guards against it
    // being hollowed out while both containments keep passing). These phrases
    // are the transparency note's load-bearing claims: the counts go to our own
    // site, no cookie, no cross-visit identity, saves stay local.
    expect(shared).toContain("anonymous counts to our own site");
    expect(shared).toContain("with no cookie and nothing that could point back to you across visits");
    expect(shared).toContain("leave your device only when you export them");
  });

  it("states the packaging rule rather than a product, and keeps the crash caveat", () => {
    // The desktop build (issue #781) broke two claims this copy used to make: a
    // same-origin transport, and "there is nothing here to consent to". Both were
    // rewritten in the same PR that shipped the desktop client, and these pins
    // are what stop the old wording drifting back in.
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const shared = norm(renderToFragment(helpPrivacyBody()).textContent ?? "");
    // This body ships in the WEB build, read by players who can only play in a
    // browser, so it says what is true today before it says anything about a
    // packaged edition.
    expect(shared).toContain("Today Verticopolis runs in your browser, and that is the only edition you can play");
    // The packaged case is stated as a rule, in the conditional, and the off
    // switch is still named where it lives.
    expect(shared).toContain("A packaged edition would be different");
    expect(shared).toContain("so its counts would have to travel across the internet to our site");
    expect(shared).toContain(
      "Any edition we package that way asks on the first launch, before it counts anything, and the switch then lives in Settings, under Privacy",
    );
    expect(shared).toContain("the switch then lives in Settings, under Privacy");
    // The OTHER edition-conditional, pointing the opposite way: a browser sends
    // page metrics a packaged edition never sends. `injectVercelTelemetry`
    // returns on `isWrappedMode` before it consults consent, because /_vercel/*
    // resolves to a path on the shell's app protocol and 404s there.
    expect(shared).toContain(
      "In a browser, the page we serve also sends anonymous page-visit counts and page performance metrics; a packaged edition sends neither",
    );
    // The bare unscoped clause claimed both metric classes for every edition,
    // which told a packaged player we collect what we never collect.
    expect(shared).not.toContain("plus anonymous page-visit counts and page performance metrics");
    // And the present-tense product claims are really gone. Neither string is a
    // substring of the replacement wording, so these fail the moment the old
    // sentences come back. The claim was false twice over: no desktop artifact
    // existed that a reader could obtain, and the shell canceled the ingest
    // request, so nothing was traveling anywhere.
    expect(shared).not.toContain("The desktop app is");
    expect(shared).not.toContain("its counts travel across the internet to our site");
    // The crash caveat is surfaced as its own claim rather than buried.
    expect(shared).toContain("Crash reports are the one place your own words can travel");
    expect(shared).toContain("quote a bit of game text, such as a tower's name");
    // And the retired same-origin/no-consent claims are really gone.
    expect(shared).not.toContain("through our own site");
    expect(shared).not.toContain("nothing here to consent to");
    // The browser half of that sentence is an IDENTITY claim, and it has to
    // stay one. "Nothing is kept about you" is a data claim, and a false one:
    // this same copy describes a session-scoped id and an on-device returning
    // bucket, both of them kept. What is true is that none of it identifies you.
    expect(shared).toContain("no consent banner, because nothing that identifies you is kept");
    expect(shared).not.toContain("nothing is kept about you");
  });

  it("carries the Classic vs Modern comparison as a deep-linkable section", () => {
    const frag = renderToFragment(helpPageTemplate());
    const compare = frag.querySelector("section#classic-vs-modern");
    expect(compare, "the comparison must be its own #classic-vs-modern section").not.toBeNull();
    const text = compare!.textContent ?? "";
    // Signature phrases from the shared compareTemplate: if this page forked the
    // copy instead of importing it, these would drift.
    expect(text).toContain("Variant households");
    expect(text).toContain("Continuous pricing");
    expect(text).toContain("Smarter scheduling");
    expect(text).toContain("pixel-faithful to 1994");
  });

  it("renders the basics and keyboard help from the shared source", () => {
    const frag = renderToFragment(helpPageTemplate());
    expect(frag.querySelector("section#basics")?.textContent).toContain("Floors first");
    // The keyboard section carries real <kbd> keys.
    expect(frag.querySelectorAll("section#keyboard kbd").length).toBeGreaterThan(0);
  });

  it("documents the long-press peek in the phone guide (shared with the in-game Help)", () => {
    const frag = renderToFragment(helpPageTemplate());
    const touch = frag.querySelector("section#touch")?.textContent ?? "";
    expect(touch).toContain("Peek at a room");
    expect(touch).toContain("Press and hold a room");
    expect(touch).toContain("Lift to close");
  });

  it("carries a real 'Back to game' anchor to the game root", () => {
    const frag = renderToFragment(helpPageTemplate());
    const backs = [...frag.querySelectorAll<HTMLAnchorElement>('a[href="/"]')];
    // The shell renders it twice (title bar + footer); both point at "/".
    expect(backs.length).toBeGreaterThanOrEqual(1);
    for (const a of backs) expect(a.textContent).toContain("Back to game");
  });

  it("links to the sibling sprite gallery at the clean /gallery URL", () => {
    const frag = renderToFragment(helpPageTemplate());
    const gallery = frag.querySelector<HTMLAnchorElement>('a[href="/gallery"]');
    expect(gallery).not.toBeNull();
    expect(gallery!.textContent).toContain("Sprite Gallery");
  });

  it("carries a report call to action linking out to GitHub", () => {
    const frag = renderToFragment(helpPageTemplate());
    const report = frag.querySelector<HTMLAnchorElement>('a[href*="issues/new"]');
    expect(report).not.toBeNull();
    expect(report!.getAttribute("target")).toBe("_blank");
    expect(report!.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("removes prerendered #app content after rendering, so the guide never doubles", async () => {
    // The build prerenders the page's markup into #app (scripts/prerender-help.ts).
    // main() renders first, then removes that copy (removal only after a
    // successful render, so a render error keeps the prerendered guide visible);
    // without the removal, lit-html would leave a second guide after the foreign
    // children. Seed a stand-in prerendered copy, then import the module fresh
    // so its top-level main() runs against it.
    const root = document.createElement("div");
    root.id = "app";
    root.innerHTML = "<h1>How to Play</h1><section id='basics'>prerendered stand-in</section>";
    document.body.appendChild(root);
    try {
      vi.resetModules();
      await import("./helpPage");
      expect(document.querySelectorAll("#app h1").length).toBe(1);
      expect(document.querySelectorAll("#app #basics").length).toBe(1);
      expect(root.textContent).not.toContain("prerendered stand-in");
      expect((window as unknown as { helpReady?: boolean }).helpReady).toBe(true);
    } finally {
      root.remove();
      delete (window as unknown as { helpReady?: boolean }).helpReady;
    }
  });
});
