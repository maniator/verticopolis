import { html, type TemplateResult } from "lit-html";

/**
 * The Settings dialog body: sound levels plus the presentation toggles. Authored
 * to match `settingsHtml` structurally (proven by the transitional
 * `assertDomEquivalent` test), including the `role="switch"` + `aria-describedby`
 * toggles and the `aria-hidden` volume readouts. This is a STATIC structure only:
 * Settings is stateful, so the controller (`showSettings`) owns all the wiring:
 * the volume sliders initialize from the live levels and apply on input; both
 * switches re-read the live state after every toggle; and the OS-forced
 * reduced-motion path disables the switch and relabels its span. The primary Close
 * button carries `autofocus` (the dialog renders once, so it is honored on
 * showModal). There is a real Close button here (the `data-act="close"` action the
 * controller wires), not a title-bar-only dismissal.
 */
export function settingsTemplate(): TemplateResult {
  return html`
      <h2>Settings</h2>
      <h3>Sound</h3>
      <p style="color:var(--muted)">Levels apply right away and are remembered on this device. The 🔊 button up top mutes everything.</p>
      <div class="vol-row"><label for="vol-music">Music</label><input id="vol-music" type="range" min="0" max="100" step="1"><span class="vol-val" data-vol-val="vol-music" aria-hidden="true"></span></div>
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
      <div class="modal-actions"><button class="btn primary" data-act="close" autofocus>Close</button></div>
    `;
}
