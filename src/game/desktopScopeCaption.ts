import type { SaveScopeCaption } from "../ui/templates/saves";
import { saveStoreSession } from "./desktopSaveStore";

/**
 * The saves UI's scope caption, built FROM DATA (the shell's scope label),
 * never from a constant: the labelling party's ruling for story D2. The
 * ratified copy ("Towers on this computer. Anyone who plays here can open
 * them.") travels from the shell through `list()` to here, so the day the
 * shell offers a second namespace, the same code renders its words with no
 * public change.
 *
 * The caption describes the SHARED scope, which is where every tower the
 * list shows lives this era (and localStorage saves in a browser-equivalent
 * desktop session share the same OS-profile visibility, so the sentence
 * stays true even when store mode is off). A session with no shell-marked
 * shared scope renders no caption rather than guessing one.
 *
 * The list's accessible name (`listLabel`) is the label's FIRST SENTENCE,
 * period stripped. The shell sends one string shaped as "short name. the
 * dangerous detail."; the visible caption carries all of it, while the
 * accessible name wants the same scope in fewer words, and deriving it
 * beats a second cross-repo string that can drift from the first.
 */
export function saveScopeCaption(): SaveScopeCaption | undefined {
  const session = saveStoreSession();
  if (!session || session.sharedScope === undefined) return undefined;
  const shared = session.scopes.find((s) => s.token === session.sharedScope);
  const text = shared?.label.trim() ?? "";
  if (text === "") return undefined;
  const firstSentence = text.split(".")[0]?.trim() ?? "";
  return { text, listLabel: firstSentence !== "" ? firstSentence : text };
}
