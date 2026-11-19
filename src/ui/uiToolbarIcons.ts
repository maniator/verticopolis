import { iconElement, type IconName } from "@verticopolis/components/windows/icons";

/**
 * Inject the static toolbar and transport icons once at boot (issue #721). The
 * index.html shell carries no glyph now: the emoji controls tofu on a system
 * with no emoji font, and the transport symbols (the play/pause row, undo, redo,
 * update, install, the sub-page Back arrow) looked inconsistent
 * sitting beside the new pixel icons. Each button gets its pixel icon here
 * instead, prepended so a button's own label still follows the icon.
 *
 * Runs while the boot splash still covers the chrome, so there is no flash. The
 * additive prepend is safe (unlike setAudioGlyph's idempotent replaceChildren)
 * because UI is constructed exactly once at boot (main.ts), so these glyphs are
 * never mounted onto a live UI twice. The icons are `aria-hidden`; each control
 * keeps its accessible name from an `aria-label` or a following text label.
 */
export function mountToolbarIcons(): void {
  const put = (sel: string, name: IconName, size = 16): void => {
    document.querySelector(sel)?.prepend(iconElement(name, { size }));
  };
  put(".brand", "brand");
  put(".menubar-brand", "brand"); // the phone menu bar's compact logo
  put("#btn-save-top", "save");
  put("#btn-undo", "undo");
  put("#btn-redo", "redo");
  put("#btn-update", "update", 14);
  put("#btn-install", "install", 14);
  // The speed row: one icon per level, a pause bar then one/two/three triangles.
  const speed: Partial<Record<string, IconName>> = { "0": "pause", "1": "speed1", "2": "speed2", "3": "speed3" };
  for (const b of document.querySelectorAll<HTMLElement>("#speed button[data-speed]")) {
    const name = speed[b.dataset.speed ?? ""];
    if (name) b.replaceChildren(iconElement(name, { size: 14 }));
  }
}
