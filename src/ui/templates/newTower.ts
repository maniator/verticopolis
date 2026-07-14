import { html, nothing, type TemplateResult } from "lit-html";

/**
 * The Found a New Tower rule-set picker body. Authored to match `newTowerHtml`
 * structurally (proven by transitional guards, retired with the string builders): the lede,
 * the Classic/Modern radio bodies, the calendar sub-picker, and the two footer
 * buttons. Only the abandon warning is conditional (on `hasSave`).
 *
 * IMPORTANT: the `.nt-calendar` block renders ALWAYS, in both modes. Do NOT
 * "improve" it into a `mode === 'modern' ? … : nothing` conditional. The
 * controller (`newTowerModal`) reads the `nt-cal` radio only when the picked mode
 * is Modern, and Classic founding pins the harmless default regardless, but the
 * calendar markup must stay present and reachable (tab order) whichever mode is
 * selected, exactly as the 1994-style dialog does.
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
       <div class="nt-modes">
         <label class="nt-mode">
           <input type="radio" name="nt-mode" value="classic" checked />
           <span class="nt-mode-body">
             <span class="nt-mode-name">Classic <span class="nt-badge">1994</span></span>
             <span class="nt-mode-desc">Pixel-faithful SimTower. Every condo houses a family of 3 and sells at 2×–2.5× its build cost; lose an owner to neglect and you buy the condo back at full price. The 1994 economy runs untouched, so a mature tower's money gets comfortable, just like the original.</span>
           </span>
         </label>
         <label class="nt-mode">
           <input type="radio" name="nt-mode" value="modern" />
           <span class="nt-mode-body">
             <span class="nt-mode-name">Modern <span class="nt-badge alt">new</span></span>
             <span class="nt-mode-desc">Everything in Classic, plus features the original couldn't do:</span>
             <span class="nt-feature"><b>Variant households</b>: a condo draws a 2–5 person family. Bigger families pay more but lean harder on your elevators, so each sale is a real bet.</span>
             <span class="nt-feature"><b>Households come and go</b>: a sold condo's family can move out on its own (a life event, not a complaint), more often for a bigger family. You buy the condo back and resell it, so even a settled tower keeps turning over.</span>
             <span class="nt-feature"><b>A deeper economy</b>: held space carries a monthly overhead, unsold condos are taxed, and a noisy office neighbor can wear a tenant down to a move-out. Late-game money stays a real decision.</span>
           </span>
         </label>
       </div>
       <div class="nt-calendar">
         <span class="nt-mode-name">Calendar <span class="nt-badge alt">Modern</span></span>
         <span class="nt-mode-desc">Classic always runs the authentic compressed 1994 calendar. For Modern, pick the pace:</span>
         <label class="nt-cal-opt"><input type="radio" name="nt-cal" value="realWorld" checked /> <b>Real-world length</b>: a 7-day week, 90-day quarter and 360-day year, the friendlier pace.</label>
         <label class="nt-cal-opt"><input type="radio" name="nt-cal" value="canon" /> <b>Short (1994)</b>: a 3-day week, 3-day quarter and 12-day year, the authentic SimTower rhythm.</label>
       </div>
       ${abandon}
       <div class="modal-actions">
         <button class="btn" data-act="cancel">Cancel</button>
         <button class="btn primary" data-act="found">Found Tower</button>
       </div>`;
}
