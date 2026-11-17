/**
 * The player's appearance scheme: how the windows, menus and buttons look.
 * Kept on this browser like the screen saver's choices (never in a save, so a
 * tower looks the same to its rules whatever the scheme). Read once when the
 * game starts and again only when the Appearance dialog saves.
 *
 * Standard is the default on every device and in both modes (owner,
 * 2026-11-17): a player only meets another scheme by finding Options >
 * Appearance… or the Control Panel's Appearance icon.
 */

/** The schemes, in the order the dialog lists them. */
export const SCHEMES = ["standard", "skyline", "high_contrast"] as const;
export type SchemeId = (typeof SCHEMES)[number];

/** The scheme every player starts with. */
export const DEFAULT_SCHEME: SchemeId = "standard";

/** Each scheme's name as the dialog lists it. */
export const SCHEME_NAMES: Readonly<Record<SchemeId, string>> = {
  standard: "Standard",
  skyline: "Skyline",
  high_contrast: "High Contrast",
};

/** The attribute on `<html>` the scheme style sheets key on. Standard sets
 *  none, so the default look needs no attribute at all. */
export const SCHEME_ATTRIBUTE = "data-scheme";

const KEY = "vc.appearance";

export function isScheme(v: unknown): v is SchemeId {
  return (SCHEMES as readonly unknown[]).includes(v);
}

export function loadScheme(storage: Pick<Storage, "getItem"> | null = safeStorage()): SchemeId {
  try {
    const raw = storage?.getItem(KEY);
    return isScheme(raw) ? raw : DEFAULT_SCHEME;
  } catch {
    /* blocked storage: the default */
    return DEFAULT_SCHEME;
  }
}

export function saveScheme(id: SchemeId, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, id);
  } catch {
    /* a full or blocked storage: the choice holds for this visit */
  }
}

/** The preference cookie that carries the scheme to the manual on its own
 *  host, help.verticopolis.com, which cannot read this site's storage (owner,
 *  2026-11-17: a cookie is fine when it holds no personal data). It holds the
 *  scheme's name and nothing else. */
export const SCHEME_COOKIE = "vc_scheme";

/** The production game's hosts. Only they write the cookie: staging, previews
 *  and local builds keep the manual under /help on their own origin, where
 *  storage already reaches it, and must not overwrite the production choice. */
const COOKIE_HOSTS: readonly string[] = ["verticopolis.com", "www.verticopolis.com"];

/** Browsers cap a cookie's life at 400 days. */
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** The cookie line for `id`, shared with every verticopolis.com host. */
export function schemeCookie(id: SchemeId): string {
  return `${SCHEME_COOKIE}=${id}; Domain=verticopolis.com; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax; Secure`;
}

/** Share `id` with the manual's host, on the production site only. */
export function shareScheme(
  id: SchemeId,
  host: string = globalThis.location?.hostname ?? "",
  doc: Pick<Document, "cookie"> | null = globalThis.document ?? null,
): void {
  if (!doc || !COOKIE_HOSTS.includes(host)) return;
  try {
    doc.cookie = schemeCookie(id);
  } catch {
    /* cookies blocked: the manual keeps the scheme the game last sent it */
  }
}

/** Dress the page in `id`: one attribute on `<html>`, so the swap is a style
 *  recalculation and nothing else (no reload, no tower redraw). */
export function applyScheme(id: SchemeId, root: Element): void {
  if (id === DEFAULT_SCHEME) root.removeAttribute(SCHEME_ATTRIBUTE);
  else root.setAttribute(SCHEME_ATTRIBUTE, id);
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
