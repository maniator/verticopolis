import { buildFrame, titleButton } from "./deskWindow";

/**
 * The Control Panel on the 1994 desk: the settings a 1995 player looked for
 * there, each as an icon that opens what the game already has. Display opens
 * the Screen Saver dialog, Sounds turns the sound on or off, Settings opens
 * the game's Settings. It opens from the Verticopolis menu and the tray.
 *
 * Cost: built once with the desk; nothing runs until an icon is pressed.
 */

/** The Control Panel's icons, in the order they sit. */
export type ControlIcon = "display" | "sounds" | "settings";

/** The game menu item each icon runs. */
export const CONTROL_ITEM: Record<ControlIcon, string> = {
  display: "mb-screensaver",
  sounds: "mb-sound",
  settings: "btn-settings",
};

const ICONS: ReadonlyArray<readonly [ControlIcon, string, string]> = [
  ["display", "Display", "Screen saver"],
  ["sounds", "Sounds", "Sound on or off"],
  ["settings", "Settings", "Game settings"],
];

/** Each icon drawn in 32 pixels, as the 1995 Control Panel's were. */
const ART: Record<ControlIcon, string> = {
  display:
    '<rect x="4" y="4" width="24" height="18" fill="#c0c0c0" stroke="#000"/><rect x="7" y="7" width="18" height="12" fill="#008080"/><rect x="12" y="22" width="8" height="3" fill="#808080"/><rect x="8" y="25" width="16" height="3" fill="#c0c0c0" stroke="#000"/>',
  sounds:
    '<path d="M5 12h6l7-6v20l-7-6H5z" fill="#c0c0c0" stroke="#000"/><path d="M21 11q3 5 0 10M24 8q5 8 0 16" fill="none" stroke="#000080" stroke-width="2"/>',
  settings:
    '<circle cx="16" cy="16" r="9" fill="#c0c0c0" stroke="#000"/><circle cx="16" cy="16" r="3" fill="#fff" stroke="#000"/><path d="M16 3v5M16 24v5M3 16h5M24 16h5M7 7l3 3M22 22l3 3M25 7l-3 3M10 22l-3 3" stroke="#000" stroke-width="2"/>',
};

export interface ControlPanel {
  readonly root: HTMLElement;
  readonly isOpen: () => boolean;
  readonly open: () => void;
  readonly close: () => void;
  /** Show the sound's state on the Sounds icon ("Sounds: On"). */
  readonly sync: () => void;
}

/** Build the Control Panel's window (closed). `picked` hears each icon. */
export function buildControlPanel(doc: Document, picked: (icon: ControlIcon) => void): ControlPanel {
  const frame = buildFrame(doc, "desk-win-control", "Control Panel");
  const root = frame.root;
  root.classList.add("desk-control");
  root.hidden = true;
  const close = titleButton(doc, "close", "Close Control Panel");
  close.addEventListener("click", () => (root.hidden = true));
  frame.root.querySelector(".win-title")?.appendChild(close);
  let soundLabel: HTMLElement | null = null;
  const grid = doc.createElement("div");
  grid.className = "desk-control-icons";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Control Panel");
  for (const [id, label, hint] of ICONS) {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "desk-control-icon";
    b.dataset.control = id;
    b.title = hint;
    b.innerHTML = `<svg width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true">${ART[id]}</svg>`;
    const text = doc.createElement("span");
    text.textContent = label;
    b.appendChild(text);
    if (id === "sounds") soundLabel = text;
    b.addEventListener("click", () => {
      picked(id);
      doc.getElementById(CONTROL_ITEM[id])?.click();
    });
    grid.appendChild(b);
  }
  const status = doc.createElement("div");
  status.className = "desk-control-status";
  status.textContent = `${ICONS.length} object(s)`;
  frame.body.append(grid, status);
  return {
    root,
    isOpen: () => !root.hidden,
    open: () => (root.hidden = false),
    close: () => (root.hidden = true),
    sync: () => {
      const on = doc.getElementById(CONTROL_ITEM.sounds)?.getAttribute("aria-checked") !== "false";
      const text = `Sounds: ${on ? "On" : "Off"}`;
      if (soundLabel && soundLabel.textContent !== text) soundLabel.textContent = text;
    },
  };
}
