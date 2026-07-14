import { html, nothing, type TemplateResult } from "lit-html";

/**
 * The How-to-play / Help dialog. Authored to match `helpHtml` structurally
 * (proven by the transitional `assertDomEquivalent` test): the long static body,
 * the keyboard-play list, the external report link (with `rel="noopener"` and its
 * visually-hidden "opens in a new tab" span, routed through the platform wrapper
 * by the controller), and the two footer buttons. The Replay button is disabled
 * (and gains an explaining `title`) while the title screen is up; the primary
 * "Got it" carries `autofocus` so focus lands on it rather than the report link.
 *
 * Only the app `version` is interpolated (auto-escaped by lit); the body is
 * trusted static copy. The Replay action binds inline via `@click`; it is bound
 * unconditionally because the two real backstops make a splash-time trigger a
 * no-op regardless: a real browser suppresses click events on a `disabled`
 * button, and `onReplayOnboarding` itself no-ops while the splash is up. (A
 * synthetic `click()` in a test harness can still reach the handler, so the
 * guarantee is behavioral, not structural.) The controller (`showHelp`) wires
 * the plain Close and routes the report link.
 */
export interface HelpActions {
  /** Replay the Getting Started onboarding (no-op behind the splash, and the button is disabled there). */
  onReplay: () => void;
}

export function helpTemplate(onSplash: boolean, version: string, actions: HelpActions): TemplateResult {
  return html`
      <h2>How to play</h2>
      <p>Build a thriving high-rise and earn your way to a coveted <b>TOWER</b> rating.</p>
      <ul>
        <li><b>Floors first.</b> Lay <b>Floor</b> tiles, then place rooms on them.</li>
        <li><b>Move people.</b> Every floor needs an <b>elevator</b> or <b>stairs</b> chain back to the ground lobby, or tenants leave.</li>
        <li><b>Make money.</b> Offices pay quarterly rent, condos sell once, hotels earn nightly, shops &amp; restaurants earn from foot traffic.</li>
        <li><b>Grow your rating.</b> 2★ at 300 pop, 3★ at 1,000 (needs Security), 4★ at 5,000 (needs Medical, enough Recycling, suites &amp; a VIP), 5★ at 10,000 (needs a Metro).</li>
        <li><b>Take out the trash.</b> One <b>Recycling Center</b> processes ~2,500 population. It visibly fills through the day and a garbage truck empties it each morning. Outgrow your centers and 4★ locks until you build more.</li>
        <li><b>Win.</b> At 5★ with a Metro station, build the <b>Wedding Hall</b> on floor 100 and pass the VIP inspection. The <b>TOWER</b> rank needs 15,000 occupants: office workers, residents, and venue customers. Hotel guests don't count at this stage, even when dining.</li>
        <li><b>Two rides, tops.</b> People take at most <b>two</b> elevator/stair rides to reach a floor. Add <b>sky lobbies</b> (every ~15 floors) so distant floors are one transfer away, or nobody comes.</li>
        <li><b>Parking</b> spaces only work when they touch a <b>Parking Ramp</b> or a connected space. Chain them off a ramp, or they sit empty. Offices want a space per ~24 workers (one per four offices) from 3★, and every hotel suite needs one of its own (the VIP drives).</li>
        <li><b>Book the films.</b> Cinemas book a film monthly. A <b>Blockbuster</b> costs twice as much but pulls a far bigger crowd (great in a busy tower, a money-loser in a quiet one). Leave it on <b>Auto</b> or set a policy on the cinema.</li>
        <li><b>Price in bulk.</b> Inspect any office, condo or hotel room and use <b>“Set all …”</b> to re-price every unit of that kind at once (or reset them to the default). No need to edit each room. A preview shows how many change before you apply.</li>
        <li><b>The clock breathes.</b> As in 1994, real time isn't spent evenly: the clock crawls through the lunch crush (watch your elevators earn their keep) and races through the small hours. A full day still takes the same real time, and the speed buttons still multiply it. Prefer an even pace? Toggle <b>Steady clock</b> in Settings.</li>
        <li><b>Rule-set (Classic vs Modern).</b> You pick this when you <b>found a tower</b>, and it's fixed for that tower's life. <b>Classic</b> is the faithful 1994 game: every condo is a family of 3, sells at 2×–2.5× its build cost, and an owner lost to neglect costs you a full-price buy-back. <b>Modern</b> adds <b>variant households</b>: a condo draws a 2–5 person family that sets its sale price and how demanding it is (a big family pays more but bails sooner if the elevators can't cope). Sold condo households also <b>move out on their own</b> now and then, a life event more likely for a bigger family, so you buy the condo back and resell as the tower turns over. It also runs a <b>deeper economy</b>: held space carries a monthly overhead, unsold condos are taxed, and a noisy office neighbor can wear a tenant down to a move-out, so late-game money stays a real decision. Modern also lets you pick the <b>calendar</b> when you found the tower: keep the friendlier real-world length (7-day week, 90-day quarter, 360-day year) or run the authentic 1994 compressed calendar (3-day week, 3-day quarter, 12-day year); Classic always runs the compressed one. Whichever you pick, your income per in-game day stays the same, only the cadence changes. Want the other rule-set? Start a new tower, and if there's a "what the original couldn't do" behavior Modern doesn't have yet, suggest it below.</li>
      </ul>
      <p style="color:var(--muted)">Mouse: drag to pan, scroll to zoom, click to build, Inspect tool to edit a room. Made a mistake? <b>Undo with Ctrl+Z</b> (or the ↩ button). Redo with Ctrl+Shift+Z. Music changes with whatever part of the tower you're viewing. Try scrolling around!</p>
      <h3>Keyboard play</h3>
      <p style="color:var(--muted)">Play entirely without a mouse. Pick a tool in the palette (Tab to it, Enter to select), then:</p>
      <ul class="help-keys">
        <li><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> (or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>) move the build cursor. Hold <kbd>Shift</kbd> for ×10</li>
        <li><kbd>Enter</kbd> / <kbd>Space</kbd> build (or inspect) at the cursor. For an elevator or stairway, press once to anchor and again at the far end to size the shaft</li>
        <li><kbd>Delete</kbd> / <kbd>Backspace</kbd> / <kbd>X</kbd> bulldoze at the cursor · <kbd>Esc</kbd> cancel</li>
        <li><kbd>+</kbd> / <kbd>−</kbd> zoom · <kbd>C</kbd> re-center · <kbd>0</kbd>–<kbd>3</kbd> game speed · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo</li>
      </ul>
      <h3>Found a bug? Have an idea?</h3>
      <p style="color:var(--muted)">Help us improve Verticopolis. Report a bug, request a feature, or flag anything that doesn't match the 1994 original.</p>
      <p class="help-report"><a class="btn" target="_blank" rel="noopener noreferrer" href="https://github.com/maniator/verticopolis/issues/new/choose">Let us know…<span class="visually-hidden"> (opens GitHub in a new tab)</span></a></p>
      <h3>About</h3>
      <p style="color:var(--muted)">An unofficial, from-scratch homage to SimTower (1994). Original code and art; no ripped assets. Not affiliated with or endorsed by Maxis / OPeNBooK / Vivarium.<br>Verticopolis v${version}</p>
      <div class="modal-actions"><button class="btn" data-act="replay-onboard" ?disabled=${onSplash} title=${onSplash ? "Start a tower first, then you can replay the intro." : nothing} @click=${actions.onReplay}>Replay Getting Started</button><button class="btn primary" data-act="close" autofocus>Got it</button></div>
    `;
}
