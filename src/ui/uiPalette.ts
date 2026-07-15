import { html, render } from "lit-html";
import { ALL_KINDS, FACILITIES } from "../engine/facilities";
import type { FacilityCategory, FacilityKind } from "../engine/types";
import type { Tool, UI } from "./UI";
import { shortMoney } from "./format";

/**
 * Build-palette construction for {@link UI}, as friend functions taking the UI
 * instance. Extracted from `UI.ts`; the palette is built once at construction
 * ({@link buildPalette}) and each item routes back through `ui.selectTool`.
 */

const GROUPS: { title: string; cats: FacilityCategory[] }[] = [
  { title: "Structure", cats: ["structure"] },
  { title: "Transport", cats: ["transport"] },
  { title: "Commercial", cats: ["office", "retail", "food"] },
  { title: "Living", cats: ["residential", "hotel"] },
  { title: "Leisure", cats: ["entertainment"] },
  { title: "Services", cats: ["service"] },
  { title: "Special", cats: ["special"] },
];

export function buildPalette(ui: UI): void {
  const frag = document.createDocumentFragment();

  // Tools row (inspect + bulldoze).
  const toolsTitle = document.createElement("div");
  toolsTitle.className = "pal-group-title";
  toolsTitle.textContent = "Tools";
  frag.appendChild(toolsTitle);
  frag.appendChild(toolButton(ui, "inspect", "🔍 Inspect", "#9aa6bd"));
  frag.appendChild(toolButton(ui, "bulldoze", "🧨 Bulldoze", "#ff6b6b"));

  for (const group of GROUPS) {
    const title = document.createElement("div");
    title.className = "pal-group-title";
    title.dataset.group = group.title;
    title.textContent = group.title;
    frag.appendChild(title);
    for (const kind of ALL_KINDS) {
      const f = FACILITIES[kind];
      if (!group.cats.includes(f.category)) continue;
      frag.appendChild(facilityButton(ui, kind, group.title));
    }
  }
  ui.el.palette.appendChild(frag);
}

/** Make a palette div behave like a button for mouse AND keyboard users:
 * focusable, role=button, and activatable with Enter/Space (a keyboard-only
 * play path). */
function makeActivatable(item: HTMLElement, label: string, onActivate: () => void): void {
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.setAttribute("aria-label", label);
  item.addEventListener("click", onActivate);
  item.addEventListener("keydown", (e) => {
    if (e.repeat) return; // a held key must not fire repeatedly (native button semantics)
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      e.stopPropagation(); // don't also reach the global build-cursor handler
      onActivate();
    }
  });
}

function toolButton(ui: UI, type: "inspect" | "bulldoze", label: string, color: string): HTMLElement {
  const item = document.createElement("div");
  item.className = "pal-item";
  item.dataset.tool = type;
  // lit render for the inner swatch/label (built once at construction, from
  // trusted catalog constants); the container's a11y wiring stays imperative in
  // makeActivatable so a future re-render can't drop its listeners.
  render(html`<span class="pal-swatch" style="background:${color}"></span><span class="pal-name">${label}</span>`, item);
  makeActivatable(item, label, () => ui.selectTool({ type } as Tool));
  return item;
}

function facilityButton(ui: UI, kind: FacilityKind, group: string): HTMLElement {
  const f = FACILITIES[kind];
  const item = document.createElement("div");
  item.className = "pal-item";
  item.dataset.kind = kind;
  item.dataset.group = group;
  render(
    html`<span class="pal-swatch" style="background:${f.color}"></span><span class="pal-name">${f.name}</span><span class="pal-cost">$${shortMoney(f.cost)}</span>`,
    item,
  );
  // Locked facilities are hidden from the palette entirely (parity with the
  // original), so a visible button is never locked, no locked toast path.
  // (A visible button may still be unaffordable; the engine build guard, not
  // this palette, rejects a placement the player can't pay for.)
  makeActivatable(item, `${f.name}, $${shortMoney(f.cost)}`, () => {
    ui.selectTool({ type: "build", kind });
  });
  return item;
}
