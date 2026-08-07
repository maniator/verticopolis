import { svg, nothing, type SVGTemplateResult } from "lit-html";
import { VENDORED_ICON_PATHS } from "./iconPaths.generated";

/**
 * Inline pixel icons for the functional UI and the bulletin/event messages
 * (issue #721). Replaces Unicode emoji, which render as tofu on systems with no
 * color-emoji font (bare Linux, containers, WSL) and look materially different
 * across Windows, macOS, and Android. Decorative emoji inside running prose stay
 * as text; the in-game bulletin emoji are swapped at the RENDER layer only, so
 * `src/engine` keeps emitting plain strings and stays DOM/render-free.
 *
 * Icons are single-color pixel shapes on a 24x24 grid, filled with
 * `currentColor` so each takes the color of its context: ink on the gray chrome,
 * and the bulletin log's own severity color (red for bad, green for money)
 * when injected into a colored line.
 *
 * Nearly every icon is single-color; the one exception is the bulldoze wrecking
 * ball, a two-tone red/amber accent glyph (see {@link ACCENT_FILLS}) whose paths
 * carry a fixed fill instead of inheriting `currentColor`.
 *
 * Provenance (MIT): the CUSTOM icons below are original to this project (mute,
 * bomb, the bulldoze wrecking ball, warning, the pause + speed1/2/3 transport
 * glyphs, and the help question mark), drawn on the same 24x24 grid because the
 * free Pixelarticons set has no matching glyph. Every other icon's path data is
 * generated from the pinned `pixelarticons` dev dependency (by Gerrit Halfmann,
 * https://github.com/halfmage/pixelarticons, MIT) into `iconPaths.generated.ts`
 * and inlined at build time, so the offline PWA and the packaged shells still
 * fetch nothing at runtime. Re-run `scripts/gen-icon-paths.ts` to refresh it.
 */

export type IconName =
  | "brand" | "save" | "sound" | "mute" | "stats" | "map" | "settings" | "inspect" | "bulldoze" | "milestone" | "trophy" | "fire" | "bomb" | "rescue" | "car" | "money" | "security" | "housekeeping" | "cockroach" | "santa" | "garbage" | "warning"
  | "pause" | "speed1" | "speed2" | "speed3" | "undo" | "redo" | "menu" | "update" | "install" | "back"
  | "play" | "help" | "folder" | "plus";

interface IconPath {
  d: string;
  /** `fill-rule="evenodd"` so an inner shape (the warning "!") knocks out. */
  evenodd?: boolean;
  /** A fixed accent fill instead of the inherited `currentColor`, for the one
   *  two-tone tool glyph (the bulldoze wrecking ball). Must be an
   *  {@link ACCENT_FILLS} value; a bulletin icon never sets it (it has to keep
   *  inheriting the log line's severity color). */
  fill?: string;
}

/** The only baked fills allowed in the set: the red/amber hazard pair the
 *  bulldoze wrecking ball uses. The red matches the tool palette's bulldoze
 *  swatch. `iconCoverage.guard.test.ts` pins that no other fill sneaks in and
 *  that no bulletin icon bakes one. */
export const ACCENT_FILLS = ["#ff6b6b", "#ffb454"] as const;

/** The custom, hand-drawn glyphs with no pixelarticons equivalent. Everything
 *  else comes from {@link VENDORED_ICON_PATHS} (generated from the package).
 *  Keyed by `IconName` so a typo'd name is a compile error, not a runtime miss. */
const CUSTOM: Partial<Record<IconName, IconPath[]>> = {
  // The muted speaker shares the exact `sound` speaker (pixelarticons volume-2,
  // waves removed) so the toggle only swaps the two waves for an X, and the
  // speaker never shifts under the glyph as it flips.
  mute: [{ d: "M13 22h-2v-2H9v-2h2V6H9V4h2V2h2v20ZM9 18H7v-2h2v2ZM7 10H5v4h2v2H3V8h4v2ZM9 8H7V6h2v2Z" }, { d: "M15 8h2v2h-2zM19 8h2v2h-2zM17 10h2v2h-2zM15 12h2v2h-2zM19 12h2v2h-2z" }],
  bomb: [{ d: "M8 12h8v2H8zM6 14h12v6H6zM8 20h8v2H8zM15 10h2v2h-2zM17 8h2v2h-2zM19 6h2v2h-2zM19 2h2v2h-2zM17 4h2v2h-2zM21 4h2v2h-2z" }],
  // A two-tone wrecking ball for demolish: an amber chain slung from the top
  // corner down to a red iron ball. The red matches the tool palette's bulldoze
  // swatch; unlike the old hammer (which read as build/fix) it clearly tears
  // down. The one accent-colored glyph in the set (see ACCENT_FILLS).
  bulldoze: [
    { d: "M3 3h5v2H3zM6 5h2v2H6zM8 7h2v2H8zM10 9h2v2h-2z", fill: "#ffb454" },
    { d: "M8 12h6v6H8zM9 11h4v1H9zM9 18h4v1H9zM7 13h1v4H7zM14 13h1v4h-1z", fill: "#ff6b6b" },
  ],
  warning: [{ d: "M11 2h2v2h-2zM10 4h4v2h-4zM9 6h6v2H9zM8 8h8v2H8zM7 10h10v2H7zM6 12h12v2H6zM5 14h14v2H5zM4 16h16v2H4zM3 18h18v2H3zM11 8h2v6h-2zM11 15h2v2h-2z", evenodd: true }],
  // The transport row: a pause bar, then one/two/three matching right triangles
  // for slow/medium/fast, mirroring the old ⏸ ▶ ▶▶ ▶▶▶ escalation. Narrower than
  // the standalone `play` (vendored) so the three-triangle glyph still fits.
  pause: [{ d: "M7 4h4v16h-4zM13 4h4v16h-4z" }],
  speed1: [{ d: "M8 4h2v16h-2zM10 6h2v12h-2zM12 9h2v6h-2zM14 11h2v2h-2z" }],
  speed2: [{ d: "M4 4h2v16h-2zM6 6h2v12h-2zM8 9h2v6h-2zM10 11h2v2h-2zM12 4h2v16h-2zM14 6h2v12h-2zM16 9h2v6h-2zM18 11h2v2h-2z" }],
  speed3: [{ d: "M0 4h2v16h-2zM2 6h2v12h-2zM4 9h2v6h-2zM6 11h2v2h-2zM8 4h2v16h-2zM10 6h2v12h-2zM12 9h2v6h-2zM14 11h2v2h-2zM16 4h2v16h-2zM18 6h2v12h-2zM20 9h2v6h-2zM22 11h2v2h-2z" }],
  // A question mark for How to Play (the pixelarticons set has no help glyph).
  help: [{ d: "M8 4h8v2H8zM6 6h2v3H6zM16 6h2v5h-2zM12 11h4v2h-4zM11 13h2v3h-2zM11 18h2v2h-2z" }],
};

/** All icon path data: the generated pixelarticons subset, plus the hand-drawn
 *  CUSTOM glyphs (which win on any name collision). Assembled once at load. */
const ICONS: Record<IconName, IconPath[]> = {
  ...Object.fromEntries(Object.entries(VENDORED_ICON_PATHS).map(([name, ds]) => [name, ds.map((d) => ({ d }))])),
  ...CUSTOM,
} as Record<IconName, IconPath[]>;

/** Every icon name that resolves to real path data. Exported so the coverage
 *  guard can walk the whole set (accent-fill and currentColor checks). */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

const SVG_NS = "http://www.w3.org/2000/svg";

export interface IconOpts {
  /** Square px size (default 16, the toolbar button glyph size). */
  size?: number;
  /** Extra class on the <svg>. */
  className?: string;
}

/**
 * A trusted `<svg>` ELEMENT, built with `createElementNS` (never innerHTML), for
 * imperative renderers: the bulletin log, the boot-time toolbar injection, the
 * audio toggle. The icon is `aria-hidden`; its meaning comes from the sibling
 * text or the button's `aria-label`.
 */
export function iconElement(name: IconName, opts: IconOpts = {}): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, "svg");
  const size = String(opts.size ?? 16);
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("width", size);
  el.setAttribute("height", size);
  el.setAttribute("fill", "currentColor");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("focusable", "false");
  el.setAttribute("data-icon", name);
  el.setAttribute("class", opts.className ? `vc-icon ${opts.className}` : "vc-icon");
  for (const p of ICONS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", p.d);
    if (p.evenodd) path.setAttribute("fill-rule", "evenodd");
    if (p.fill) path.setAttribute("fill", p.fill); // accent path opts out of currentColor
    el.appendChild(path);
  }
  return el;
}

/**
 * The same icon as a lit `svg` template, for lit-rendered templates (the tool
 * palette, the congrats and stats panels, the event dialog). `d` is bound as an
 * ATTRIBUTE, so lit escapes it: no `unsafeHTML`/`unsafeSVG` (which this codebase
 * avoids) and no injection surface, since the data is a module constant anyway.
 */
export function iconTemplate(name: IconName, opts: IconOpts = {}): SVGTemplateResult {
  const size = opts.size ?? 16;
  return svg`<svg viewBox="0 0 24 24" width=${size} height=${size} fill="currentColor" aria-hidden="true" focusable="false" data-icon=${name} class=${opts.className ? `vc-icon ${opts.className}` : "vc-icon"}>${ICONS[
    name
  ].map((p) => svg`<path d=${p.d} fill=${p.fill ?? nothing} fill-rule=${p.evenodd ? "evenodd" : nothing}></path>`)}</svg>`;
}

/**
 * The bulletin/event emoji that get swapped for an icon when a message string is
 * rendered. Keys are the base code points; a trailing U+FE0F variation selector
 * is consumed by {@link appendMessageWithIcons}. Only these are mapped; every
 * other character (including emoji sitting mid-sentence in prose) is left as
 * text.
 */
export const EMOJI_ICONS: Record<string, IconName> = {
  "🔥": "fire",
  "💣": "bomb",
  "🚒": "rescue",
  "🚗": "car",
  "💰": "money",
  "🕵": "security",
  "🧹": "housekeeping",
  "🪳": "cockroach",
  "🎅": "santa",
  "🏅": "milestone",
  "♻": "garbage",
  "⚠": "warning",
};

const EMOJI_KEYS = Object.keys(EMOJI_ICONS);
/** Matches ONLY a mapped bulletin emoji at the head of a message (the leading
 *  severity marker the engine emits), plus a trailing VS16. Leading whitespace
 *  is tolerated and consumed with the marker (issue #743), so a stray space
 *  before the emoji cannot silently turn the icon back into tofu text. Still
 *  anchored past that: a mapped emoji after any non-whitespace prefix (a tower
 *  name, a "Day 5:" label, a quote) is left as text, per the contract above.
 *  The emitter side of the invariant is pinned by
 *  `iconCoverage.guard.test.ts`, which fails CI if a message layer ever writes
 *  a mapped emoji that is not message-leading. */
const LEADING_EMOJI_RE = new RegExp(
  "^\\s*(" + EMOJI_KEYS.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\uFE0F?",
  "u",
);

/**
 * Append `message` to `el`. If it starts with a mapped bulletin emoji (leading
 * whitespace allowed, and consumed along with the marker), that leading marker
 * becomes a trusted icon element and the rest stays a TEXT NODE;
 * otherwise the whole message is one text node. The text is never set as
 * innerHTML, so an engine string (or a tower name inside it) can never inject
 * markup, and any mapped emoji NOT at the start survives as text (so an
 * aria-hidden icon never swallows a character mid-sentence). The icon inherits
 * `el`'s color, which the bulletin log sets per severity. Returns whether an
 * icon was inserted.
 */
export function appendMessageWithIcons(el: HTMLElement, message: string): boolean {
  const m = LEADING_EMOJI_RE.exec(message);
  if (!m) {
    el.appendChild(document.createTextNode(message));
    return false;
  }
  el.appendChild(iconElement(EMOJI_ICONS[m[1]], { size: 14, className: "vc-icon-inline" }));
  const rest = message.slice(m[0].length);
  if (rest) el.appendChild(document.createTextNode(rest));
  return true;
}

/**
 * The lit-template form of {@link appendMessageWithIcons}, for a message shown
 * inside a lit template (the event-choice dialog). Returns the message split
 * into text runs and icon templates; lit renders the mix directly. The text runs
 * are plain strings, so lit escapes them like any text binding.
 */
export function messageWithIcons(message: string): Array<string | SVGTemplateResult> {
  const m = LEADING_EMOJI_RE.exec(message);
  if (!m) return [message];
  const icon = iconTemplate(EMOJI_ICONS[m[1]], { size: 14, className: "vc-icon-inline" });
  const rest = message.slice(m[0].length);
  return rest ? [icon, rest] : [icon];
}
