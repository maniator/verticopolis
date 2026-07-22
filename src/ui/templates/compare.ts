import { html, type TemplateResult } from "lit-html";

/**
 * The Classic vs Modern comparison body: the single source of truth for the
 * rule-set comparison. It is rendered by the Help dialog (inside its "Classic vs
 * Modern" section), by the in-game Compare modal, by the founding screen, and by
 * the standalone `/help` page (`helpPage.ts`), so the copy has one home and
 * cannot drift (it had drifted twice before this extraction). This exports the
 * BODY only, the intro paragraph, the divergence list, and the "pixel-faithful
 * to 1994" closer, with no `<details>`/`<summary>` or `<h2>` wrapper; each caller
 * supplies its own.
 *
 * The drift guard in `src/ui/templates/help.test.ts` (the `RULE_TO_HELP` map and
 * the copy-sync check) inspects the Help "Classic vs Modern" section, which
 * renders this template, so a new Modern divergence still has to be classified
 * there before it can ship. Keep this copy verbatim with what that guard expects.
 */
export function compareTemplate(): TemplateResult {
  return html`
        <p style="color:var(--muted)">You pick a rule-set when you <b>found a tower</b>, and it's fixed for that tower's life. <b>Classic</b> is the faithful 1994 game. <b>Modern</b> keeps all of it and adds things the original couldn't do. Want to play the other way? Start a new tower.</p>
        <ul>
          <li><b>Variant households.</b> A condo draws a 2–5 person family instead of the flat family of 3. The family sets the sale price and how demanding it is: a bigger family pays more but leans harder on your elevators.</li>
          <li><b>Households come and go.</b> A sold condo's family can move out on its own now and then, a life event more likely for a bigger family, so you buy the condo back and resell as the tower turns over. Classic condos, once sold, stay sold.</li>
          <li><b>A deeper economy.</b> Held space carries a monthly overhead, unsold condos are taxed, a noisy office neighbor can wear a tenant down to a move-out, and a tenant with too few reachable shops can eventually give notice. Classic runs the 1994 economy untouched, where late-game money gets comfortable.</li>
          <li><b>Continuous pricing.</b> Set any rent on a slider. Classic keeps the 1994 four-rung price menu plus the "No Rate" off-market option.</li>
          <li><b>Freer building.</b> Escalators can serve office floors. Classic keeps escalators to commercial floors only, the way the original did.</li>
          <li><b>New places to build.</b> Modern adds venues the original never had, starting with the Food Hall: a hall of food stalls that earns from foot traffic and satisfies many cravings from one spot, so it covers a wide reach of hungry tenants. Classic builds only the 1994 catalog.</li>
          <li><b>Longer climbs.</b> In Modern, people will climb any number of stairs or escalators to reach a floor, so a floor served only by a long walk-up stays reachable. Classic keeps the 1994 limit: a person refuses a run longer than 4 flights of stairs or 7 of escalators (a mixed run takes the stricter of the two), so a floor that needs a longer climb can't be reached at all until you add an elevator. A reachable floor that sits far from a lobby still feels the usual distance pressure, eased by building a sky lobby nearer to it.</li>
          <li><b>Smarter scheduling.</b> The per-shaft elevator schedule offers presets, a one-tap auto-tune from measured demand, and advice on the hours a shaft is overstaffed or understaffed. Classic gives you the raw grid to set by hand, the way the original did.</li>
          <li><b>Cockroach recovery.</b> An infested hotel room can be cleared by a paid exterminator. In Classic an infestation is permanent, so the bulldozer is the only fix.</li>
          <li><b>Build hints.</b> Hovering an invalid spot tells you why it's refused before you click. Classic refuses on the click with a toast, the way the original taught you.</li>
          <li><b>A livelier day.</b> Condo kids leave for school and return, office workers run midday errands, some hotel guests linger past checkout for a lunch trip before they go, retail swings with weekdays and weekends, and rain thins the crowd more gently. Classic matches the literal 1994 visitor patterns.</li>
          <li><b>Calendar pace.</b> Pick the friendlier real-world length (7-day week, 90-day quarter, 360-day year) or the authentic 1994 compressed calendar (3-day week, 3-day quarter, 12-day year) when you found the tower. Classic always runs the compressed one. Either Modern choice collects the same rent per in-game day, only in different lumps (day-to-day trade still follows the calendar's own weekday and weekend rhythm).</li>
          <li><b>Office rent, smoothed.</b> Modern spreads office rent so the same tower earns the same per in-game day whichever calendar it runs. Classic collects the full 1994 rent lump every 3-day quarter (an Average office pays its whole $10,000 each quarter), the fast office money the original was known for.</li>
        </ul>
        <p style="color:var(--muted)"><b>Classic aims to be pixel-faithful to 1994.</b> If something in Classic doesn't match the original, please report it so we can fix it. And if there's a "what the original couldn't do" behavior Modern doesn't have yet, suggest it too.</p>
  `;
}

/**
 * The in-game Compare modal body: the shared {@link compareTemplate} under an
 * `<h2>` title bar, with a plain "Got it" close. Opened by `uiDialogs.showCompare`
 * through the single `#modal`, so it inherits the standard close/Esc/backdrop
 * grammar. The controller pauses the tower on open and restores the prior speed
 * on close, so reading the reference never costs the player elevator time.
 */
export function compareModalTemplate(): TemplateResult {
  return html`
      <h2>Classic vs Modern</h2>
      ${compareTemplate()}
      <div class="modal-actions"><button class="btn primary" data-act="close" autofocus>Got it</button></div>
    `;
}
