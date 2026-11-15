/**
 * Where the player's manual lives in this build. A production build serves it
 * from its own host, help.verticopolis.com (`VC_HELP_ORIGIN`, set by
 * scripts/vercel-build.sh), so the installed app opens it in the browser over
 * the running game instead of in place of it. Every other build (a preview,
 * staging, CI, a local build) keeps it under /help on the game's own host.
 *
 * The game writes its links to the manual as /help/... paths, and
 * {@link helpUrl} turns each into this build's address for it.
 */

/** The manual's own host in a production build, or "" for /help on this host. */
export const HELP_ORIGIN: string = __HELP_ORIGIN__;

/** The game's front page as a page on either host links it: absolute in a
 *  production build, since the manual's host shares the site's "page not
 *  found" page, and this same host otherwise. */
export const GAME_HOME = HELP_ORIGIN ? "https://verticopolis.com/" : "/";

/** The address a player is told to type when the manual cannot open. */
export const HELP_ADDRESS = "help.verticopolis.com";

/**
 * `path`, a manual path as /help/... (with any ?query or #section), as this
 * build serves it: unchanged under /help, or on the manual's own host with
 * the /help prefix dropped. Any other path is returned as it is.
 */
export function helpUrl(path: string, origin: string = HELP_ORIGIN): string {
  if (!origin) return path;
  const manual = path.match(/^\/help(?=[/?#]|$)(.*)$/);
  if (!manual) return path;
  const rest = manual[1].startsWith("/") ? manual[1] : `/${manual[1]}`;
  return origin + rest;
}
