import type { GameApp } from "../main";
import { getCommonProps, setCommonProps, trackAppAction } from "../analytics";
import { openAppearanceDialog } from "../ui/appearance/appearanceDialog";
import { withScheme, wornScheme } from "../ui/fromGame";
import { applyScheme, loadScheme, saveScheme, type SchemeId } from "../ui/appearance/appearancePrefs";

/**
 * The appearance scheme in the game (owner, 2026-11-17): Options >
 * Appearance… and the desk Control Panel's Appearance icon open the dialog;
 * OK dresses the page in the pick and keeps it on this browser. The scheme is
 * applied once at startup, while the boot cover still hides the page, so a
 * Skyline player never sees the Standard look first.
 *
 * The manual follows (owner, 2026-11-17): every help link the game opens
 * names the worn scheme (`fromGame.ts` SCHEME_PARAM), and a link built before
 * the scheme was applied or changed is brought up to date as it is pressed
 * or focused, just before the browser follows it.
 *
 * Analytics: the scheme rides every event as the common `scheme` property, and
 * `appearance_set` (detail: the new scheme) marks each change made with OK.
 */

/** The menu item that opens the dialog. */
export const APPEARANCE_ITEM_ID = "mb-appearance";

/** Put the current scheme on every event from here on. */
export function noteScheme(id: SchemeId): void {
  setCommonProps({ ...getCommonProps(), scheme: id });
}

/** Read the kept scheme and dress the page in it. Returns it for the boot
 *  analytics. */
export function applyKeptScheme(root: Element = document.documentElement): SchemeId {
  const id = loadScheme();
  applyScheme(id, root);
  return id;
}

/** A press or focus on a link: a game-marked help link gets the scheme the
 *  page wears now. Runs on that one event only, never per frame. */
export function freshenHelpLink(e: Event): void {
  const link = (e.target as Element | null)?.closest?.("a[href]");
  if (!link) return;
  const href = link.getAttribute("href") ?? "";
  const next = withScheme(href, wornScheme());
  if (next !== href) link.setAttribute("href", next);
}

/** Wire the dialog once. `current` is the scheme the page wears now. */
export function wireAppearance(app: Pick<GameApp, "ui">, current: SchemeId, root: Element = document.documentElement): void {
  let scheme = current;
  document.addEventListener("pointerdown", freshenHelpLink, true);
  document.addEventListener("focusin", freshenHelpLink, true);
  document.getElementById(APPEARANCE_ITEM_ID)?.addEventListener("click", () =>
    openAppearanceDialog(app.ui, scheme, (picked) => {
      if (picked === scheme) return;
      scheme = picked;
      applyScheme(picked, root);
      saveScheme(picked);
      noteScheme(picked);
      trackAppAction("appearance_set", picked);
    }),
  );
}
