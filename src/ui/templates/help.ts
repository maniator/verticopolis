import { html, nothing, type TemplateResult } from "lit-html";

/**
 * The How-to-play / Help dialog. Organized so it opens SHORT: a lead and the
 * mouse-controls line stay visible, then the body is a stack of collapsible
 * `<details class="help-modes">` sections following one rule (essentials open,
 * reference-or-optional collapsed). "The basics" is the only section `open` on
 * first paint; "Going further", "Keyboard play", "Classic vs Modern", and
 * "About" are collapsed. The external report link (with `rel="noopener
 * noreferrer"` and its visually-hidden "opens GitHub in a new tab" span, routed
 * through the platform wrapper by the controller) stays out in the open as a
 * call to action, between the collapsible sections and the About section. Each
 * summary carries a `role="heading"` span so screen-reader heading navigation
 * still reaches every section. The Replay button is
 * disabled (and gains an explaining `title`) while the title screen is up; the
 * primary "Got it" carries `autofocus` so focus lands on it rather than the
 * report link.
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
      <p style="color:var(--muted)">Mouse: drag to pan, scroll to zoom, click to build, Inspect tool to edit a room. Made a mistake? <b>Undo with Ctrl+Z</b> (or the ↩ button). Redo with Ctrl+Shift+Z. Music changes with whatever part of the tower you're viewing. Try scrolling around!</p>
      <details class="help-modes" open>
        <summary><span role="heading" aria-level="3">The basics</span></summary>
        <ul>
          <li><b>Floors first.</b> Lay <b>Floor</b> tiles, then place rooms on them.</li>
          <li><b>Move people.</b> Every floor needs an <b>elevator</b> or <b>stairs</b> chain back to the ground lobby, or tenants leave.</li>
          <li><b>Make money.</b> Offices pay quarterly rent, condos sell once, hotels earn nightly, shops &amp; restaurants earn from foot traffic.</li>
          <li><b>Grow your rating.</b> 2★ at 300 pop, 3★ at 1,000 (needs Security), 4★ at 5,000 (needs Medical, enough Recycling, suites &amp; a VIP), 5★ at 10,000 (needs a Metro). At 5★ a floor-100 payoff wins the game (under Going further).</li>
          <li><b>Two rides, tops.</b> People take at most <b>two</b> elevator/stair rides to reach a floor. Add <b>sky lobbies</b> (every ~15 floors) so distant floors are one transfer away, or nobody comes.</li>
        </ul>
      </details>
      <details class="help-modes">
        <summary><span role="heading" aria-level="3">Going further</span></summary>
        <ul>
          <li><b>Take out the trash.</b> One <b>Recycling Center</b> processes ~2,500 population. It visibly fills through the day and a garbage truck empties it each morning. Outgrow your centers and 4★ locks until you build more.</li>
          <li><b>Win.</b> At 5★ with a Metro station, build the <b>Wedding Hall</b> on floor 100 and pass the VIP inspection. The <b>TOWER</b> rank needs 15,000 occupants: office workers, residents, and venue customers. Hotel guests don't count at this stage, even when dining.</li>
          <li><b>Parking</b> spaces only work when they touch a <b>Parking Ramp</b> or a connected space. Chain them off a ramp, or they sit empty. Offices want a space per ~24 workers (one per four offices) from 3★, and every hotel suite needs one of its own (the VIP drives).</li>
          <li><b>Book the films.</b> Cinemas book a film monthly. A <b>Blockbuster</b> costs twice as much but pulls a far bigger crowd (great in a busy tower, a money-loser in a quiet one). Leave it on <b>Auto</b> or set a policy on the cinema.</li>
          <li><b>Price in bulk.</b> Inspect any office, condo or hotel room and use <b>“Set all …”</b> to re-price every unit of that kind at once (or reset them to the default). No need to edit each room. A preview shows how many change before you apply.</li>
          <li><b>The clock breathes.</b> As in 1994, real time isn't spent evenly: the clock crawls through the lunch crush (watch your elevators earn their keep) and races through the small hours. A full day still takes the same real time, and the speed buttons still multiply it. Prefer an even pace? Toggle <b>Steady clock</b> in Settings.</li>
        </ul>
      </details>
      <details class="help-modes">
        <summary><span role="heading" aria-level="3">Classic vs Modern</span></summary>
        <p style="color:var(--muted)">You pick a rule-set when you <b>found a tower</b>, and it's fixed for that tower's life. <b>Classic</b> is the faithful 1994 game. <b>Modern</b> keeps all of it and adds things the original couldn't do. Want to play the other way? Start a new tower.</p>
        <ul>
          <li><b>Variant households.</b> A condo draws a 2–5 person family instead of the flat family of 3. The family sets the sale price and how demanding it is: a bigger family pays more but leans harder on your elevators.</li>
          <li><b>Households come and go.</b> A sold condo's family can move out on its own now and then, a life event more likely for a bigger family, so you buy the condo back and resell as the tower turns over. Classic condos, once sold, stay sold.</li>
          <li><b>A deeper economy.</b> Held space carries a monthly overhead, unsold condos are taxed, a noisy office neighbor can wear a tenant down to a move-out, and a tenant with too few reachable shops can eventually give notice. Classic runs the 1994 economy untouched, where late-game money gets comfortable.</li>
          <li><b>Continuous pricing.</b> Set any rent on a slider. Classic keeps the 1994 four-rung price menu plus the "No Rate" off-market option.</li>
          <li><b>Freer building.</b> Escalators can serve office floors, and express riders can switch elevators at any shared stop. Classic keeps escalators to commercial floors and routes express transfers only through a sky lobby, the rule that makes sky lobbies essential.</li>
          <li><b>Cockroach recovery.</b> An infested hotel room can be cleared by a paid exterminator. In Classic an infestation is permanent, so the bulldozer is the only fix.</li>
          <li><b>Build hints.</b> Hovering an invalid spot tells you why it's refused before you click. Classic refuses on the click with a toast, the way the original taught you.</li>
          <li><b>A livelier day.</b> Condo kids leave for school and return, office workers run midday errands, retail swings with weekdays and weekends, and rain thins the crowd more gently. Classic matches the literal 1994 visitor patterns.</li>
          <li><b>Calendar pace.</b> Pick the friendlier real-world length (7-day week, 90-day quarter, 360-day year) or the authentic 1994 compressed calendar (3-day week, 3-day quarter, 12-day year) when you found the tower. Classic always runs the compressed one. Either way your income per in-game day is the same, only the cadence changes.</li>
        </ul>
        <p style="color:var(--muted)"><b>Classic aims to be pixel-faithful to 1994.</b> If something in Classic doesn't match the original, please report it below so we can fix it. And if there's a "what the original couldn't do" behavior Modern doesn't have yet, suggest it there too.</p>
      </details>
      <details class="help-modes">
        <summary><span role="heading" aria-level="3">Keyboard play</span></summary>
        <p style="color:var(--muted)">Play entirely without a mouse. Pick a tool in the palette (Tab to it, Enter to select), then:</p>
        <ul class="help-keys">
          <li><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> (or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>) move the build cursor. Hold <kbd>Shift</kbd> for ×10</li>
          <li><kbd>Enter</kbd> / <kbd>Space</kbd> build (or inspect) at the cursor. For an elevator or stairway, press once to anchor and again at the far end to size the shaft</li>
          <li><kbd>Delete</kbd> / <kbd>Backspace</kbd> / <kbd>X</kbd> bulldoze at the cursor · <kbd>Esc</kbd> cancel</li>
          <li><kbd>+</kbd> / <kbd>−</kbd> zoom · <kbd>C</kbd> re-center · <kbd>0</kbd>–<kbd>3</kbd> game speed · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo</li>
        </ul>
      </details>
      <h3>Found a bug? Have an idea?</h3>
      <p style="color:var(--muted)">Help us improve Verticopolis. Report a bug, request a feature, or flag anything that doesn't match the 1994 original.</p>
      <p class="help-report"><a class="btn" target="_blank" rel="noopener noreferrer" href="https://github.com/maniator/verticopolis/issues/new/choose">Let us know…<span class="visually-hidden"> (opens GitHub in a new tab)</span></a></p>
      <details class="help-modes">
        <summary><span role="heading" aria-level="3">About</span></summary>
        <p style="color:var(--muted)">An unofficial, from-scratch homage to SimTower (1994). Original code and art; no ripped assets. Not affiliated with or endorsed by Maxis / OPeNBooK / Vivarium.<br>Verticopolis <span class="app-version">v${version}</span></p>
      </details>
      <div class="modal-actions"><button class="btn" data-act="replay-onboard" ?disabled=${onSplash} title=${onSplash ? "Start a tower first, then you can replay the intro." : nothing} @click=${actions.onReplay}>Replay Getting Started</button><button class="btn primary" data-act="close" autofocus>Got it</button></div>
    `;
}
