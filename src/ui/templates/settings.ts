import { html, nothing, type TemplateResult } from "lit-html";

/**
 * The Settings dialog body: sound levels plus the presentation toggles. Authored
 * to match `settingsHtml` structurally (proven by the
 * retired transitional guards), including the `role="switch"` + `aria-describedby`
 * toggles and the `aria-hidden` volume readouts. This is a STATIC structure only:
 * Settings is stateful, so the controller (`showSettings`) owns all the wiring:
 * the volume sliders initialize from the live levels and apply on input; both
 * switches re-read the live state after every toggle; and the OS-forced
 * reduced-motion path disables the switch and relabels its span. The primary Close
 * button carries `autofocus` (the dialog renders once, so it is honored on
 * showModal). There is a real Close button here (the `data-act="close"` action the
 * controller wires), not a title-bar-only dismissal.
 *
 * The muted version line at the foot is a read-only echo of the splash and Help's
 * About block: some players look in Settings first for "what build am I on." It is
 * the interpolated app `version` (auto-escaped by lit), a read-only label rather
 * than a control, sourced from the same `__APP_VERSION__` the About line uses;
 * never make it look editable or read it from anywhere else.
 *
 * The Building section is Modern-only: `showBuilding` is true only for a Modern
 * tower, so a Classic tower never renders the "Bridge floors between rooms"
 * switch (bridging is forced on in Classic and can't be toggled). The switch
 * itself is a STATIC structure like the others; `showSettings` reads the live
 * tower state, sets the initial checked value, and disables it when Manual
 * Structure was chosen at founding (which already places every tile by hand).
 *
 * The Privacy section is desktop-only, on the same conditional shape:
 * `showAnalytics` is true only in a packaged desktop build, because that is the
 * only edition with a consent decision to hold (issue #781). A browser session
 * renders no row, since it stores nothing about the player to turn off. Its note
 * points at Help's Privacy section for the whole story, and carries no link: the
 * shell's external-link policy allows one host, and the full text already ships
 * inside the game.
 */
export function settingsTemplate(version: string, showBuilding = false, showAnalytics = false): TemplateResult {
  const analytics = showAnalytics
    ? html`
      <h3>Privacy</h3>
      <div class="set-row">
        <label class="set-switch"><input type="checkbox" id="set-analytics" role="switch" aria-describedby="note-analytics"><span>Share anonymous counts</span></label>
        <p class="set-note" id="note-analytics">A few anonymous counts about how the game is going: first facilities placed, how far towers climb, which tools get used. Nothing identifies you and nothing carries over between visits. Turn it off and this build sends nothing at all. The full note is in Help, under Privacy.</p>
      </div>`
    : nothing;
  const building = showBuilding
    ? html`
      <h3>Building</h3>
      <div class="set-row">
        <label class="set-switch"><input type="checkbox" id="set-auto-bridge" role="switch" aria-describedby="note-auto-bridge"><span>Bridge floors between rooms</span></label>
        <p class="set-note" id="note-auto-bridge">When on, dropping a room or floor near existing structure fills the walkway between them. Turn off and floors still appear under each room, just never across the gap, so separate sections stay disconnected.</p>
      </div>`
    : nothing;
  return html`
      <h2>Settings</h2>
      <h3>Sound</h3>
      <p style="color:var(--muted)">Levels apply right away and are remembered on this device. The sound button up top mutes everything.</p>
      <div class="vol-row"><label for="vol-music">Music</label><input id="vol-music" type="range" min="0" max="100" step="1"><span class="vol-val" data-vol-val="vol-music" aria-hidden="true"></span></div>
      <div class="vol-row"><label for="vol-ambience">Ambience</label><input id="vol-ambience" type="range" min="0" max="100" step="1"><span class="vol-val" data-vol-val="vol-ambience" aria-hidden="true"></span></div>
      <div class="vol-row"><label for="vol-sfx">Effects</label><input id="vol-sfx" type="range" min="0" max="100" step="1"><span class="vol-val" data-vol-val="vol-sfx" aria-hidden="true"></span></div>
      <h3>Motion and pace</h3>
      <div class="set-row">
        <label class="set-switch"><input type="checkbox" id="set-reduce-motion" role="switch" aria-describedby="note-reduce-motion"><span>Reduced motion</span></label>
        <p class="set-note" id="note-reduce-motion">Calms ambient motion: weather, birds, and other background animation. If your device asks for reduced motion, this stays on.</p>
      </div>
      <div class="set-row">
        <label class="set-switch"><input type="checkbox" id="set-steady-clock" role="switch" aria-describedby="note-steady-clock"><span>Steady clock</span></label>
        <p class="set-note" id="note-steady-clock">As in 1994, the clock normally runs slow through the lunch rush and fast overnight (a full day takes the same real time either way). Turn on for an even pace all day.</p>
      </div>
      ${building}
      ${analytics}
      <div class="modal-actions"><button class="btn primary" data-act="close" autofocus>Close</button></div>
      <p class="set-version">Verticopolis <span class="app-version">v${version}</span></p>
    `;
}
