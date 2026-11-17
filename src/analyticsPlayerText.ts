/**
 * Player text the error reporter must never send (#607).
 *
 * A thrown message can quote something the player wrote: a tower name, a file
 * name, a facility name, or a bit of a save that a browser's JSON error echoes
 * back. `$exception` (see `analyticsErrors.ts`) runs its message, stack, type
 * and source through {@link scrubPlayerText} before anything leaves the page, so
 * each piece of player text the game knows about goes out as
 * {@link PLAYER_TEXT_PLACEHOLDER} instead.
 *
 * The game tells this module what it knows in two ways, both kept in page
 * memory only and never stored or sent:
 * - **Sources** ({@link addPlayerTextSource}): read at report time, so the open
 *   tower's name, the My Towers list and the rest are never copied on a pump,
 *   tick or frame. A report happens at most a few times a page life.
 * - **Remembered text** ({@link rememberPlayerText}): names that may no longer
 *   be in any source, such as a tower's name before a rename or the file name of
 *   an import, noted at that cold moment. The newest {@link MAX_REMEMBERED} stay.
 *
 * Matching ignores case and only replaces whole words (no letter or digit on
 * either side), so a tower called "Tower" leaves `TowerTooLargeError` alone.
 * Text shorter than {@link MIN_PLAYER_TEXT} is skipped: one character says
 * nothing about anyone and would blank every "A" in a message.
 */

/** What replaces each piece of player text in a report. */
export const PLAYER_TEXT_PLACEHOLDER = "<player text>";
/** Shortest text worth replacing (characters, after trimming). */
export const MIN_PLAYER_TEXT = 2;
/** How many remembered pieces of text a page life keeps, newest first. */
export const MAX_REMEMBERED = 32;
/** Longest text kept for matching; a file or tower name is far shorter. A
 *  caller that clamps a field scrubs this much past its clamp first, so a name
 *  that straddles the cut is still replaced whole. */
export const MAX_PLAYER_TEXT = 500;

/** A source returns the player text it holds right now. */
export type PlayerTextSource = () => Iterable<string | null | undefined> | null | undefined;

const sources: PlayerTextSource[] = [];
const remembered: string[] = [];

/** The names the game gives a tower or file the player left unnamed (`UI.ts`,
 *  `fileSpace.ts`, `towerDocument.ts`). They are the game's words, so a report
 *  keeps them: blanking "Tower" would blank the word in every message. */
const GAME_NAMES = new Set(["tower", "tower one"]);

/** Trimmed text worth matching, or null. Never throws. */
function usable(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (t.length < MIN_PLAYER_TEXT || t.length > MAX_PLAYER_TEXT) return null;
  return GAME_NAMES.has(t.toLowerCase()) ? null : t;
}

/** Add a source the scrubber reads at report time. Returns a function that
 *  removes it. */
export function addPlayerTextSource(source: PlayerTextSource): () => void {
  sources.push(source);
  return () => {
    const at = sources.indexOf(source);
    if (at >= 0) sources.splice(at, 1);
  };
}

/** Note one piece of player text (a name before a rename, an imported file's
 *  name). Cheap: a call on a cold path, never from a pump or frame. */
export function rememberPlayerText(text: string | null | undefined): void {
  const t = usable(text);
  if (t === null) return;
  const at = remembered.indexOf(t);
  if (at >= 0) remembered.splice(at, 1);
  remembered.unshift(t);
  if (remembered.length > MAX_REMEMBERED) remembered.length = MAX_REMEMBERED;
}

/** A file name, and the same name without its last extension when it has one
 *  (`Spire.vctower`, `Spire`): a message may quote either. */
export function nameAndStem(name: string): string[] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name, name.slice(0, dot)] : [name];
}

/** {@link rememberPlayerText} for a file name, with and without its extension. */
export function rememberFileName(name: string | null | undefined): void {
  if (typeof name === "string") for (const text of nameAndStem(name)) rememberPlayerText(text);
}

/** Every known piece of player text, longest first so a name that contains
 *  another ("Harbor One Annex", "Harbor One") is replaced whole. A source that
 *  throws is skipped. */
export function knownPlayerText(): string[] {
  // Exact duplicates only: two spellings that lowercase alike may still fold
  // apart in the pattern (`İstanbul` and `i\u0307stanbul`), so both are kept.
  const seen = new Set<string>();
  const add = (text: unknown) => {
    const t = usable(text);
    if (t !== null) seen.add(t);
  };
  for (const source of sources) {
    try {
      for (const text of source() ?? []) add(text);
    } catch {
      /* a source that fails (the engine gone, storage closed) is skipped */
    }
  }
  for (const text of remembered) add(text);
  return [...seen].sort((a, b) => b.length - a.length);
}

/** `text` with regex metacharacters escaped. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The known player text compiled once for a report. */
export interface PlayerTextMatcher {
  /** One pattern for every name, or null when there is none. */
  readonly pattern: RegExp | null;
  /** The longest name's length, which bounds how much of a name a cut can hide. */
  readonly longest: number;
}

/**
 * Compile the known player text into one whole-word, any-case pattern. The
 * names are tried longest first at each position, so a name that contains
 * another is replaced whole. The left edge is a captured character rather than
 * a lookbehind, which older Safari cannot compile. There is no cheaper
 * prefilter in front of it: a lowercase `includes` disagrees with the
 * pattern's Unicode case folding (a Greek final sigma, a long s), and would let
 * a name through that the pattern catches.
 */
export function playerTextMatcher(known: readonly string[]): PlayerTextMatcher {
  const names = [...known].sort((a, b) => b.length - a.length);
  if (names.length === 0) return { pattern: null, longest: 0 };
  const any = names.map(escapeRegExp).join("|");
  return { pattern: new RegExp(`(^|[^\\p{L}\\p{N}])(?:${any})(?![\\p{L}\\p{N}])`, "giu"), longest: names[0].length };
}

/** `text` with every match of the known player text replaced by
 *  {@link PLAYER_TEXT_PLACEHOLDER}. */
export function scrubPlayerText(text: string, matcher: PlayerTextMatcher): string {
  if (!text || !matcher.pattern) return text;
  return text.replace(matcher.pattern, (_match, edge: string) => edge + PLAYER_TEXT_PLACEHOLDER);
}

/** Whether a message is a JSON error, whose quotes echo the input. */
export function mentionsJson(message: string): boolean {
  return /JSON/.test(message);
}

/** Any opening or closing quote a browser may put around echoed input. */
const QUOTE = /["'“”]/;

/** What a browser writes after the quoted input: nothing, V8's "is not valid
 *  JSON", or V8's position (after one of its fixed phrases). Anything else
 *  after the last quote may be input whose own closing quote is missing, so it
 *  is blanked too. */
const JSON_TAIL = /^(?:\.\.\.)?(?: is not valid JSON|(?: after (?:property value|array element|property name))? in JSON at position \d+(?: \(line \d+ column \d+\))?)?\.?$/;

/**
 * A JSON error message with everything from its first quote to its last
 * replaced by one quoted {@link PLAYER_TEXT_PLACEHOLDER}. Browsers quote the
 * text they failed to parse (Chrome: `Unexpected token 'S', "{"a": Spire}" is
 * not valid JSON`; Safari: `JSON Parse error: Unexpected identifier "Spire"`),
 * that text is a file's contents, and it can hold quotes and line breaks of its
 * own, so pairing quotes would leave pieces of it behind. One quote with no
 * partner (a message cut short), or a last quote followed by anything but the
 * browser's own words, blanks to the end. A message with no quote is
 * returned as it is. Callers apply it only to a message {@link mentionsJson}
 * accepts.
 */
export function scrubJsonEcho(message: string): string {
  const first = message.search(QUOTE);
  if (first < 0) return message;
  const last = Math.max(message.lastIndexOf('"'), message.lastIndexOf("'"), message.lastIndexOf("”"), message.lastIndexOf("“"));
  const end = last > first && JSON_TAIL.test(message.slice(last + 1)) ? last + 1 : message.length;
  return `${message.slice(0, first)}"${PLAYER_TEXT_PLACEHOLDER}"${message.slice(end)}`;
}

/** Test-only: forget every source and remembered piece of text. */
export function resetPlayerTextForTest(): void {
  sources.length = 0;
  remembered.length = 0;
}
