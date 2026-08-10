/**
 * The debug surface's flag vocabulary and its two sources: the `?debug=` launch
 * parameter and a persisted spec in localStorage (`vc.debug`). See DEBUGGING.md
 * for the player-facing, well, developer-facing write-up.
 *
 * Everything that decides anything is a PURE function over strings, following
 * `resolvePlatformLabel` in analyticsEnrichment.ts: the search string is passed
 * in rather than read off `window`, so the precedence rules are unit-testable
 * without a DOM. Only the three storage helpers at the bottom touch a global,
 * and each is try/catch-wrapped because a hardened profile or private mode can
 * make `localStorage` itself throw on access.
 */

/**
 * Excalibur `DebugConfig` sections this game can usefully draw. Excalibur also
 * exposes an `isometric` section; it is left out because nothing here renders
 * an isometric map, so offering it would be a token that silently does nothing.
 * `tilemap` IS included: the static floor/lobby tiles are one `ex.TileMap`
 * (towerScene.ts `makeStructTileMap`).
 */
export const DEBUG_SECTIONS = [
  "entity",
  "transform",
  "graphics",
  "collider",
  "physics",
  "motion",
  "body",
  "camera",
  "tilemap",
] as const;

export type DebugSection = (typeof DEBUG_SECTIONS)[number];

/** The resolved debug state for a session. */
export interface DebugFlags {
  /** Show the DOM metrics HUD. */
  hud: boolean;
  /** Geometry-draw sections to switch on. Empty means debug draw stays off. */
  draw: DebugSection[];
  /** Scope geometry draw to actors whose name matches, or null for no filter.
   *  Case is PRESERVED (actor names are camelCase, e.g. `garageCar`). */
  filter: string | null;
  /** Tokens that matched nothing. Kept rather than dropped so the console can
   *  name the typo: a flag that silently does nothing is the worst outcome for
   *  a debugging tool, since you cannot tell it apart from "the thing I am
   *  measuring is fine". */
  unknown: string[];
  /** The spec contained an explicit `off`. Only this means "and forget the
   *  persisted spec"; a spec that merely switches nothing on does not. */
  off: boolean;
}

/** The localStorage key holding a persisted spec string. */
export const DEBUG_STORAGE_KEY = "vc.debug";

/** The URL parameter that carries a spec string. */
const DEBUG_PARAM = "debug";

export function noDebugFlags(): DebugFlags {
  return { hud: false, draw: [], filter: null, unknown: [], off: false };
}

/** Whether these flags switch anything on at all. */
export function anyDebugOn(flags: DebugFlags): boolean {
  return flags.hud || flags.draw.length > 0 || flags.filter !== null;
}

/**
 * Parse one comma-separated spec string (`"fps,draw:graphics,filter:person"`)
 * into flags. Unknown tokens land in `unknown` instead of throwing: a debug
 * surface that refuses to start because of a typo is worse than one that starts
 * and tells you which token it ignored.
 *
 * A bare `""` (from `?debug` with no value) means "the obvious default", which
 * is the metrics HUD: that is the flag you want nine times out of ten, and it
 * is the one that costs nothing to look at.
 */
export function parseDebugTokens(spec: string): DebugFlags {
  const flags = noDebugFlags();
  const tokens = spec
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
  // `?debug` / `?debug=` with no tokens at all: default to the HUD.
  if (tokens.length === 0) {
    flags.hud = true;
    return flags;
  }
  const sections = new Set<DebugSection>();
  for (const token of tokens) {
    // Split on the FIRST colon only, so a filter value may itself contain one.
    const colon = token.indexOf(":");
    const key = (colon === -1 ? token : token.slice(0, colon)).toLowerCase();
    const value = colon === -1 ? "" : token.slice(colon + 1).trim();
    switch (key) {
      case "off":
        // A hard reset wins over everything else in the same spec, including
        // tokens after it: "off" is what you type when you want out. The `off`
        // marker rides along so `resolveDebugFlags` can tell a deliberate
        // "forget my settings" apart from a spec that merely happens to switch
        // nothing on (`filter:` alone, say), which must NOT erase a stored spec.
        return { ...noDebugFlags(), off: true };
      case "all":
        flags.hud = true;
        for (const s of DEBUG_SECTIONS) sections.add(s);
        break;
      case "fps":
      case "hud":
        flags.hud = true;
        break;
      case "draw":
        if (value === "") {
          for (const s of DEBUG_SECTIONS) sections.add(s);
        } else if (isDebugSection(value.toLowerCase())) {
          sections.add(value.toLowerCase() as DebugSection);
        } else {
          flags.unknown.push(token);
        }
        break;
      case "filter":
        // An empty value clears rather than filters on "", which would match
        // nothing and read as "the filter is broken".
        flags.filter = value === "" ? null : value;
        break;
      default:
        flags.unknown.push(token);
    }
  }
  // Emit in DEBUG_SECTIONS order rather than insertion order, so a spec always
  // resolves to the same array and the tests can compare it directly.
  flags.draw = DEBUG_SECTIONS.filter((s) => sections.has(s));
  return flags;
}

export function isDebugSection(value: string): value is DebugSection {
  return (DEBUG_SECTIONS as readonly string[]).includes(value);
}

/** What {@link resolveDebugFlags} decided, and whether the stored spec should
 *  be dropped as a side effect. */
export interface ResolvedDebug {
  flags: DebugFlags;
  /** True when the URL asked for `off`, so the persisted spec must go too.
   *  Without this, `?debug=off` would appear to work and then come back on the
   *  next reload, which is a genuinely maddening way to lose an afternoon. */
  clearStored: boolean;
}

/**
 * Resolve the session's flags from the launch URL and the persisted spec.
 * An explicit `?debug=` wins outright (it is the more deliberate act, and it is
 * how you override a persisted spec without first clearing it); absent the
 * parameter, the stored spec applies.
 */
export function resolveDebugFlags(search: string, stored: string | null): ResolvedDebug {
  // No try/catch: `new URLSearchParams(string)` parses leniently and does not
  // throw, not even on "%", "&&&", or a lone surrogate. A guard here would be
  // dead code advertising a fallback path that can never run.
  const param = new URLSearchParams(search).get(DEBUG_PARAM);
  if (param !== null) {
    const flags = parseDebugTokens(param);
    // ONLY an explicit `off` forgets the stored spec. Inferring it from "this
    // spec turns nothing on" was wrong: `?debug=filter:` is a recognized token
    // that deliberately sets nothing, so it silently deleted a spec the
    // developer had saved on purpose.
    return { flags, clearStored: flags.off };
  }
  if (stored === null) return { flags: noDebugFlags(), clearStored: false };
  return { flags: parseDebugTokens(stored), clearStored: false };
}

/** Render flags back to a spec string, for persisting the live state. Round-trips
 *  through {@link parseDebugTokens}. Unknown tokens are deliberately NOT carried
 *  over: they did nothing this session and would do nothing next session. */
export function serializeDebugFlags(flags: DebugFlags): string {
  const parts: string[] = [];
  if (flags.hud) parts.push("fps");
  if (flags.draw.length === DEBUG_SECTIONS.length) parts.push("draw");
  else for (const s of flags.draw) parts.push(`draw:${s}`);
  if (flags.filter !== null) parts.push(`filter:${flags.filter}`);
  return parts.join(",");
}

// ---- Storage (the only functions here that touch a global) ----------------

export function readStoredSpec(): string | null {
  try {
    return localStorage.getItem(DEBUG_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredSpec(spec: string): void {
  try {
    // An empty spec is stored as a removal, so "persist nothing on" and "never
    // persisted" are the same state rather than two that behave alike but read
    // differently in devtools.
    if (spec === "") localStorage.removeItem(DEBUG_STORAGE_KEY);
    else localStorage.setItem(DEBUG_STORAGE_KEY, spec);
  } catch {
    /* private-mode / disabled storage: the flags just don't survive a reload */
  }
}

export function clearStoredSpec(): void {
  try {
    localStorage.removeItem(DEBUG_STORAGE_KEY);
  } catch {
    /* nothing to clear if storage is unreachable */
  }
}


/** The live flags for this session, applying the URL-over-storage precedence
 *  and honoring an `?debug=off` by clearing the store. */
export function loadDebugFlags(): DebugFlags {
  let search = "";
  try {
    search = window.location.search;
  } catch {
    /* no window: the stored spec is the only source */
  }
  const { flags, clearStored } = resolveDebugFlags(search, readStoredSpec());
  if (clearStored) clearStoredSpec();
  return flags;
}
