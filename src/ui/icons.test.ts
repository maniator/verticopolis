import { describe, it, expect } from "vitest";
import {
  iconElement,
  iconTemplate,
  appendMessageWithIcons,
  messageWithIcons,
  EMOJI_ICONS,
  type IconName,
} from "./icons";
import { html } from "lit-html";
import { renderToFragment } from "./testing/litTestUtils";

/**
 * The inline icon module (issue #721): the element/template builders, and the
 * two message mappers that swap bulletin emoji for icons while keeping every
 * other character as text. The engine->bulletin coverage contract (every emoji
 * the engine emits is mapped) is pinned separately in
 * `src/tests/iconCoverage.guard.test.ts`.
 */

const ALL_NAMES = [...new Set(Object.values(EMOJI_ICONS))];

describe("iconElement", () => {
  it("builds a currentColor svg carrying its data-icon name and a11y attributes", () => {
    const svg = iconElement("save");
    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(svg.getAttribute("data-icon")).toBe("save");
    expect(svg.getAttribute("fill")).toBe("currentColor");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.classList.contains("vc-icon")).toBe(true);
    expect(svg.querySelectorAll("path").length).toBeGreaterThan(0);
  });

  it("honors size and merges an extra class without dropping vc-icon", () => {
    const svg = iconElement("map", { size: 14, className: "extra" });
    expect(svg.getAttribute("width")).toBe("14");
    expect(svg.getAttribute("height")).toBe("14");
    expect(svg.classList.contains("vc-icon")).toBe(true);
    expect(svg.classList.contains("extra")).toBe(true);
  });

  it("builds a valid element for every icon EMOJI_ICONS points at", () => {
    for (const name of ALL_NAMES) {
      const svg = iconElement(name as IconName);
      expect(svg.querySelectorAll("path").length, `${name} has no path`).toBeGreaterThan(0);
      for (const p of svg.querySelectorAll("path")) {
        expect(p.getAttribute("d"), `${name} path has empty d`).toBeTruthy();
      }
    }
  });

  it("builds a valid element for every toolbar and transport icon (#721)", () => {
    // These do not map from an emoji (they replaced Unicode text symbols like
    // ▶ ⏸ ↩ ☰), so ALL_NAMES above does not reach them. Pin that each still
    // resolves to real path data.
    const names: IconName[] = [
      "brand", "save", "sound", "mute", "stats", "map", "settings", "inspect", "bulldoze",
      "pause", "speed1", "speed2", "speed3", "undo", "redo", "menu", "update", "install", "back",
      "play", "help", "folder", "plus",
    ];
    for (const name of names) {
      const svg = iconElement(name);
      expect(svg.getAttribute("data-icon"), `${name} lost its data-icon`).toBe(name);
      expect(svg.querySelectorAll("path").length, `${name} has no path`).toBeGreaterThan(0);
      for (const p of svg.querySelectorAll("path")) {
        expect(p.getAttribute("d"), `${name} path has empty d`).toBeTruthy();
      }
    }
  });

  it("bakes the bulldoze wrecking ball as two accent-filled paths (the one two-tone glyph)", () => {
    const svg = iconElement("bulldoze");
    const paths = [...svg.querySelectorAll("path")];
    expect(paths).toHaveLength(2);
    const fills = paths.map((p) => p.getAttribute("fill"));
    expect(fills).toEqual(["#ffb454", "#ff6b6b"]); // amber chain, red ball
    // The <svg> still declares currentColor for any non-accent path (there are
    // none here, but the default must stay intact for the rest of the set).
    expect(svg.getAttribute("fill")).toBe("currentColor");
  });

  it("draws the mute speaker on the same volume-2 speaker as sound, so the toggle does not shift it", () => {
    // Regression guard: the audio toggle used to flip between two different
    // speakers (sound on the volume-2 speaker whose cone reaches x3, mute on the
    // narrower volume-1 speaker whose cone reaches only x5), so the speaker
    // jumped under the glyph. Mute now reuses the exact volume-2 speaker cone
    // that sound draws, and this pins it: it fails on the old volume-1 path.
    const mutePaths = [...iconElement("mute").querySelectorAll("path")].map((p) => p.getAttribute("d")!);
    const soundD = iconElement("sound").querySelector("path")!.getAttribute("d")!;
    expect(mutePaths).toHaveLength(2); // the speaker, then the X that replaces the waves
    const volume2Cone = "M7 10H5v4h2v2H3V8h4v2Z"; // the left cone at x3, shared with sound
    expect(soundD, "sound should draw the volume-2 speaker").toContain(volume2Cone);
    expect(mutePaths[0], "mute speaker must match the sound speaker").toContain(volume2Cone);
    expect(mutePaths[0], "mute must not fall back to the old volume-1 cone at x5").not.toContain("H5V8");
  });
});

describe("iconTemplate", () => {
  it("binds a per-path accent fill for the two-tone bulldoze glyph", () => {
    const frag = renderToFragment(iconTemplate("bulldoze", { size: 14 }));
    const fills = [...frag.querySelectorAll("path")].map((p) => p.getAttribute("fill"));
    expect(fills).toEqual(["#ffb454", "#ff6b6b"]);
  });

  it("renders an svg with the data-icon name through lit", () => {
    const frag = renderToFragment(iconTemplate("trophy", { size: 20 }));
    const svg = frag.querySelector("svg")!;
    expect(svg.getAttribute("data-icon")).toBe("trophy");
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("fill")).toBe("currentColor");
    expect(svg.querySelectorAll("path").length).toBeGreaterThan(0);
  });

  it("sets fill-rule=evenodd only on paths that ask for it (the warning knockout)", () => {
    const frag = renderToFragment(iconTemplate("warning"));
    const withRule = [...frag.querySelectorAll("path")].filter((p) => p.getAttribute("fill-rule") === "evenodd");
    expect(withRule.length).toBe(1);
  });
});

describe("appendMessageWithIcons", () => {
  it("swaps a leading bulletin emoji for an inline icon and keeps the rest as text", () => {
    const el = document.createElement("div");
    const inserted = appendMessageWithIcons(el, "🔥 Fire broke out on Floor 3!");
    expect(inserted).toBe(true);
    const svg = el.querySelector("svg")!;
    expect(svg.getAttribute("data-icon")).toBe("fire");
    expect(svg.classList.contains("vc-icon-inline")).toBe(true);
    // The message text survives as text nodes (never innerHTML), icon aside.
    expect(el.textContent).toBe(" Fire broke out on Floor 3!");
  });

  it("consumes a trailing VS16 (U+FE0F) so the presentation selector is not left behind", () => {
    const el = document.createElement("div");
    appendMessageWithIcons(el, "🕵️ A thief slipped through.");
    expect(el.querySelector("svg")?.getAttribute("data-icon")).toBe("security");
    // No stray variation selector left in the text.
    expect(el.textContent).toBe(" A thief slipped through.");
  });

  it("leaves an unmapped message untouched and reports no insertion", () => {
    const el = document.createElement("div");
    const inserted = appendMessageWithIcons(el, "Rent collected: $1,200");
    expect(inserted).toBe(false);
    expect(el.querySelector("svg")).toBeNull();
    expect(el.textContent).toBe("Rent collected: $1,200");
  });

  it("never sets innerHTML: hostile markup in the message stays literal text", () => {
    const el = document.createElement("div");
    appendMessageWithIcons(el, '💰 <img src=x onerror="alert(1)"> found');
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("svg")?.getAttribute("data-icon")).toBe("money");
    expect(el.textContent).toBe(' <img src=x onerror="alert(1)"> found');
  });

  it("only swaps the leading marker: a mapped emoji mid-message stays text", () => {
    // The mapping is anchored to the head of the message (the severity marker
    // the engine emits). A mapped emoji sitting later in the string (a room
    // name, a copied bulletin) must survive as text, never get eaten by an
    // aria-hidden icon.
    const el = document.createElement("div");
    const inserted = appendMessageWithIcons(el, "🏅 Milestone reached: the 💰 vault opened");
    expect(inserted).toBe(true);
    expect(el.querySelectorAll("svg").length).toBe(1);
    expect(el.querySelector("svg")?.getAttribute("data-icon")).toBe("milestone");
    expect(el.textContent).toBe(" Milestone reached: the 💰 vault opened");
  });

  it("leaves a mapped emoji that is not at the very start as text", () => {
    const el = document.createElement("div");
    const inserted = appendMessageWithIcons(el, "Rent up! 💰 collected");
    expect(inserted).toBe(false);
    expect(el.querySelector("svg")).toBeNull();
    expect(el.textContent).toBe("Rent up! 💰 collected");
  });
});

describe("messageWithIcons", () => {
  it("splits a message into text runs and icon templates lit can render", () => {
    const parts = messageWithIcons("🚒 Fire rescue available for $5,000.");
    // First part is the icon template, second the trailing text.
    expect(typeof parts[0]).not.toBe("string");
    expect(parts[parts.length - 1]).toBe(" Fire rescue available for $5,000.");
    const frag = renderToFragment(html`<p>${messageWithIcons("🚒 Fire rescue available for $5,000.")}</p>`);
    expect(frag.querySelector("svg")?.getAttribute("data-icon")).toBe("rescue");
    expect(frag.textContent).toBe(" Fire rescue available for $5,000.");
  });

  it("returns a single text run for an unmapped message", () => {
    const parts = messageWithIcons("Nothing to see here");
    expect(parts).toEqual(["Nothing to see here"]);
  });

  it("only swaps the leading marker: a mapped emoji mid-message stays text", () => {
    const parts = messageWithIcons("💰 Rent up, the 🔥 alarm cleared");
    // One icon (the leading marker), then the rest as a single text run that
    // still carries the mid-sentence emoji verbatim.
    expect(parts.length).toBe(2);
    expect(typeof parts[0]).not.toBe("string");
    expect(parts[1]).toBe(" Rent up, the 🔥 alarm cleared");
    const frag = renderToFragment(html`<p>${parts}</p>`);
    expect(frag.querySelectorAll("svg").length).toBe(1);
    expect(frag.querySelector("svg")?.getAttribute("data-icon")).toBe("money");
  });
});

describe("EMOJI_ICONS", () => {
  it("points only at real icon names (no dangling mapping)", () => {
    for (const [emoji, name] of Object.entries(EMOJI_ICONS)) {
      // iconElement throws / renders empty if the name is not a real icon.
      const svg = iconElement(name);
      expect(svg.querySelectorAll("path").length, `${emoji} -> ${name} has no icon`).toBeGreaterThan(0);
    }
  });
});
