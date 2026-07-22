import { html, nothing, type TemplateResult } from "lit-html";
import { compareTemplate } from "./compare";

/**
 * The Found a New Tower rule-set picker body. The dialog leads with the one
 * decision that matters, Classic or Modern, as two short identity cards, then
 * unfolds the Modern-only details in place when Modern is picked.
 *
 * Progressive disclosure is PURE CSS. The `.nt-modern-only` block (the tight
 * "Modern adds" label and the calendar pace picker) lives inside `.nt-choice` and
 * is shown by default, then HIDDEN under Classic with
 * `.nt-choice:has(input[name="nt-mode"][value="classic"]:checked) .nt-modern-only { display:none }`.
 * Written that way round so a browser WITHOUT `:has()` support keeps the block
 * visible in both modes (the old always-rendered calendar) rather than trapping a
 * Modern player with no calendar choice. That always-visible behavior is the
 * intentional legacy fallback for engines without `:has()`, and must stay. On a
 * `:has()`-CAPABLE browser (all current targets) Classic instead hides the block
 * via `display:none`, so its calendar radios also drop out of the tab order, which
 * is correct: the calendar only applies to Modern. Do NOT drop the `:has()` rule
 * or otherwise let the block stay visible under Classic on a capable browser; the
 * Modern-only reveal is the whole point of this layout. (Always-visible in both
 * modes is fine ONLY as the no-`:has()` fallback above.) The full Classic-vs-Modern
 * comparison is a collapsed `.nt-compare` `<details>` beneath the mode cards
 * (the shared `compareTemplate`, also shown in the Help dialog and the in-game
 * mode badge), so the dialog stays a commitment by default while the full detail
 * is one click away for anyone who wants it before founding.
 *
 * The radios keep their sane defaults even while hidden: `nt-cal`'s `realWorld`
 * stays `checked` so founding Modern without touching the picker still gets the
 * friendlier calendar. The controller (`newTowerModal`) reads the `nt-cal` radio
 * only when the picked mode is Modern, and Classic founding pins the harmless
 * default regardless.
 *
 * This is a STATIC structure only: the radios are read by the controller off the
 * mounted box (`input[name="nt-mode"]:checked` / `input[name="nt-cal"]:checked`),
 * and the Cancel/Found actions are wired via `wireActions`. Nothing binds inline.
 */
export function newTowerTemplate(hasSave: boolean): TemplateResult {
  const abandon = hasSave
    ? html`<p class="nt-abandon">⚠️ This abandons your current tower (it is not auto-saved).</p>`
    : nothing;
  return html`<h2>Found a New Tower</h2>
       <p class="nt-lede">Choose your rule-set. This is set once and <b>cannot be changed</b> for this tower. Start another to play the other way.</p>
       <div class="nt-choice">
         <div class="nt-modes">
           <label class="nt-mode">
             <input type="radio" name="nt-mode" value="classic" checked />
             <span class="nt-mode-body">
               <span class="nt-mode-name">Classic <span class="nt-badge">1994</span></span>
               <span class="nt-mode-desc">The original game, pixel for pixel. Every condo houses a family of 3, and the 1994 economy runs untouched.</span>
             </span>
           </label>
           <label class="nt-mode">
             <input type="radio" name="nt-mode" value="modern" />
             <span class="nt-mode-body">
               <span class="nt-mode-name">Modern <span class="nt-badge alt">new</span></span>
               <span class="nt-mode-desc">Everything in Classic, plus a few things the original couldn't do.</span>
             </span>
           </label>
         </div>
         <div class="nt-modern-only">
           <div class="nt-adds">
             <span class="nt-sublabel">Modern adds</span>
             <span class="nt-feature"><b>Variant households</b>: condos draw families of 2–5, and a bigger family leans harder on your elevators.</span>
             <span class="nt-feature"><b>Households come and go</b>: a sold condo's family can move out, so even a settled tower turns over.</span>
             <span class="nt-feature"><b>A deeper economy</b>: held space, taxes on unsold condos, and noisy neighbors all bite.</span>
           </div>
           <div class="nt-calendar" role="radiogroup" aria-labelledby="nt-cal-label">
             <span class="nt-sublabel" id="nt-cal-label">Calendar pace</span>
             <label class="nt-cal-opt"><input type="radio" name="nt-cal" value="realWorld" checked /> <b>Real-world length</b>: a 7-day week, 90-day quarter and 360-day year, the friendlier pace.</label>
             <label class="nt-cal-opt"><input type="radio" name="nt-cal" value="canon" /> <b>Short (1994)</b>: a 3-day week, 3-day quarter and 12-day year, the authentic SimTower rhythm.</label>
           </div>
           <div class="nt-building">
             <span class="nt-sublabel">Building</span>
             <label class="nt-cal-opt"><input type="checkbox" name="nt-manual" /> <b>Manual structure</b>: place and pay for every floor and lobby tile yourself. Rooms will not auto-lay the floor beneath them. For players who want full control of the build.</label>
           </div>
         </div>
       </div>
       <details class="nt-compare">
         <summary><span role="heading" aria-level="3">Classic vs Modern: the full comparison</span></summary>
         ${compareTemplate()}
       </details>
       ${abandon}
       <div class="modal-actions">
         <button class="btn" data-act="cancel">Cancel</button>
         <button class="btn primary" data-act="found">Found Tower</button>
       </div>`;
}
