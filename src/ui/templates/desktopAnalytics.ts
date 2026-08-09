import { html, type TemplateResult } from "lit-html";

/**
 * The desktop build's first-run analytics notice (issue #781). Shown once, before
 * anything is sent, on a packaged Steam or itch build; a browser session never
 * renders it, because a browser session has nothing to decide.
 *
 * ## What the copy has to say, and why each line is here
 *
 * The party ruling (2026-08-07) defaulted the desktop dataset ON and paid for
 * that with three non-negotiable requirements. Two of them are this template:
 * the player is told before anything leaves, and they are told where the off
 * switch is. So the copy names all four measured signals (the same four Help's
 * Privacy section lists), says plainly that nothing kept could point back to
 * them, surfaces the one place free text can travel (a crash report can quote a
 * bit of game text, such as a tower's name), points at Settings for turning it
 * off, and points at Help's Privacy section for the whole story.
 *
 * The anonymity line is an IDENTITY claim, and it has to stay one. An earlier
 * draft said nothing carries over from one visit to the next, which the code
 * does not support: `getCommonProps` puts `returning`, `recency`, and `tenure`
 * on every event, and all three are derived from on-device state that survives a
 * visit. They are coarse buckets rather than identifiers, so the posture holds
 * and the sentence was the thing that was wrong. Say what is true of identity,
 * never that nothing is kept.
 *
 * ## No link, deliberately
 *
 * There is no web anchor anywhere in here, in either scheme, and there must
 * never be one (a test reads this file and fails on the sight of one, comments
 * included). The shell's external-link policy allows exactly one host
 * (github.com), so any other URL would be refused and the notice would be
 * promising a door that does not open. The full privacy text already ships
 * inside the game (Help, Privacy), which is where this points instead.
 *
 * ## Dismiss grants
 *
 * The primary button grants and "No thanks" declines, and closing the notice any
 * other way (Esc, the backdrop, the title-bar x) also grants, because the ruling
 * made dismissal the default-on answer. The controller owns that, the same way
 * the update prompt and the emergency choice resolve their own dismissals; this
 * file just supplies the two explicit buttons.
 */

/** The two answers the notice dispatches, bound inline like every other template. */
export interface DesktopAnalyticsNoticeActions {
  /** "Sounds good": record consent and close. */
  onAccept: () => void;
  /** "No thanks": record a decline and close. */
  onDecline: () => void;
}

/**
 * The first-run notice body. Trusted static copy (nothing is interpolated), one
 * short line per idea, in the same calm register as the rest of the dialogs.
 */
export function desktopAnalyticsNoticeTemplate(actions: DesktopAnalyticsNoticeActions): TemplateResult {
  return html`<h2>A word about counts</h2>
       <p>Verticopolis keeps a few anonymous counts: whether players place a first facility, how far towers climb, which tools get used, and whether returning players get further than first-timers.</p>
       <p>Nothing here identifies you, and nothing is kept that could point back to you across visits.</p>
       <p>Crash reports carry the technical details of the error. An error message can occasionally quote a bit of game text, such as a tower's name.</p>
       <p>You can turn this off at any time in Settings, under Privacy. The full privacy note is in Help, under Privacy.</p>
       <div class="modal-actions"><button class="btn" data-act="decline" @click=${actions.onDecline}>No thanks</button><button class="btn primary" data-act="accept" autofocus @click=${actions.onAccept}>Sounds good</button></div>`;
}
