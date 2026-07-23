import { html, nothing, type TemplateResult } from "lit-html";

/**
 * The "Metropolis Dusk" splash/title-screen body, split out of the onboarding
 * controller (`Onboarding.ts`) so the controller stays under its size ceiling and
 * the pure lit template lives on its own. The controller owns everything
 * imperative (mount, focus trap, backdrop/Esc dismissal, the mute glyph flip);
 * this module is just the declarative markup plus its handler contract.
 *
 * Formatting note: the whitespace in this template is load-bearing (see the
 * `splashTemplate` banner). Do NOT run a bulk `prettier --write` over it: the
 * default printer breaks the wordmark `<text>`/`<tspan>` and the glyph buttons
 * across lines, injecting text-node whitespace that shifts the textLength-fitted
 * lettering and changes each button's `textContent`. The repo does not gate on
 * prettier (eslint only uses eslint-config-prettier, which disables format
 * rules), so keep these lines tight by hand.
 */

const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

/** Click handlers the splash template binds through lit `@click`. `onToggleMute`
 *  is optional: when a caller can't toggle (no audio port), it is undefined, lit
 *  binds no listener, and the mute button can't flip its glyph while the real
 *  audio state stays put (SPEC-splash-mute CAP-2). */
export interface SplashHandlers {
  onContinue: () => void;
  onNewTower: () => void;
  onHelp: () => void;
  onToggleMute?: (e: Event) => void;
  /** Tap the persistent splash install button (SPEC-pwa-install CAP-5). Absent
   *  when there is nothing to offer (standalone / TWA), so the button isn't rendered. */
  onInstall?: () => void;
}

/** "Metropolis Dusk" title screen body: an art-deco skyline + setting sun under
 *  an indigo->coral dusk sky, with the Verticopolis wordmark. The wordmark and
 *  tagline are SVG `<text>` with `textLength` so they always fit any screen (no
 *  clipping, no web-font download, offline-safe for the PWA). The skyline and
 *  lighting layers are decorative (`aria-hidden`); the two lettering SVGs carry
 *  `role="img"` + `aria-label` so a screen reader hears the name and tagline.
 *
 *  Whitespace note: this template's indentation adds inter-element whitespace
 *  text nodes the old innerHTML string did not have. That is harmless only
 *  because `#splash` and `.splash-actions` are flex (anonymous whitespace items
 *  are not laid out) and the two lettering SVGs plus the premise are block. Keep
 *  those display rules, or collapse the whitespace here, if either becomes
 *  inline/inline-block. No whitespace is added inside any `<text>`/`<tspan>` (it
 *  would shift the `textLength`-fitted glyphs) or inside a glyph button (it would
 *  change its `textContent`). */
export function splashTemplate(hasSave: boolean, premise: string, muted: boolean, installOffered: boolean, h: SplashHandlers): TemplateResult {
  return html`<div class="splash-stars" aria-hidden="true"></div>
    <div class="splash-sun" aria-hidden="true"></div>
    <svg class="splash-skyline" aria-hidden="true" viewBox="0 0 460 200" preserveAspectRatio="xMidYMax slice">
      <g fill="#201643" stroke="#0d0d10" stroke-width="1">
        <path d="M-5 200 V120 h34 V98 h16 V120 h40 V200 z" />
        <path d="M95 200 V80 h26 V56 h12 V80 h26 V200 z" />
        <path d="M200 200 V54 h20 V30 h9 V10 h9 V30 h9 V54 h20 V200 z" />
        <path d="M310 200 V92 h30 V68 h15 V92 h30 V200 z" />
        <path d="M410 200 V60 h20 V36 h11 V60 h34 V200 z" />
      </g>
      <g fill="#ffdca0">
        <rect x="8" y="130" width="3" height="4" /><rect x="8" y="146" width="3" height="4" />
        <rect x="104" y="92" width="3" height="4" /><rect x="104" y="112" width="3" height="4" />
        <rect x="214" y="66" width="3" height="4" /><rect x="214" y="90" width="3" height="4" />
        <rect x="320" y="100" width="3" height="4" /><rect x="424" y="72" width="3" height="4" />
      </g>
    </svg>
    <div class="splash-brand">
      <svg class="splash-word" viewBox="0 0 400 66" role="img" aria-label="Verticopolis">
        <text x="200" y="52" text-anchor="middle" textLength="392" lengthAdjust="spacingAndGlyphs"><tspan class="a">VERTICO</tspan><tspan class="b">POLIS</tspan></text>
      </svg>
      <svg class="splash-tag" viewBox="0 0 360 20" role="img" aria-label="the vertical metropolis">
        <text x="180" y="15" text-anchor="middle" textLength="330" lengthAdjust="spacingAndGlyphs">THE VERTICAL METROPOLIS</text>
      </svg>
      <p class="splash-premise">${premise}</p>
    </div>
    <div class="splash-actions">
      ${hasSave ? html`<button class="splash-btn primary" data-splash="continue" @click=${h.onContinue}>▶ Continue</button>` : nothing}
      <button class="splash-btn ${hasSave ? "" : "primary"}" data-splash="new" @click=${h.onNewTower}>＋ New Tower</button>
      <button class="splash-btn ghost" data-splash="help" @click=${h.onHelp}>？ How to Play</button>
    </div>
    <p class="splash-attrib">An unofficial, from-scratch homage to SimTower (1994). Original code and art; no ripped assets. Not affiliated with or endorsed by Maxis / OPeNBooK / Vivarium.</p>
    <p class="splash-version">v${APP_VERSION}</p>
    <!-- The mute toggle renders LAST so the reading and Tab order run
         title -> premise -> actions -> utility; it is pinned visually to the
         top-right corner by .splash-mute (absolute), un-unified per the design
         system. Following the WAI-ARIA toggle-button pattern, the accessible
         name is STABLE ("Mute sound") and aria-pressed carries the on/off
         state; the glyph flips for sighted users. An absent onToggleMute binds
         no @click, so a caller that can't toggle gets an inert, truthful
         button. SPEC-splash-mute CAP-1. -->
    <button class="splash-mute" data-splash="mute" aria-pressed=${muted ? "true" : "false"} aria-label="Mute sound" @click=${h.onToggleMute}>${muted ? "🔇" : "🔊"}</button>
    <!-- The persistent install button (SPEC-pwa-install CAP-5): a quiet front door
         shown for any not-standalone session, rendered after the mute so the utility
         cluster sits at the tail of the Tab order. Rendered only when offered AND a
         handler is bound (never an inert button). It carries a visible "Install"
         label beside the download glyph (a lone glyph read as nothing on the wide,
         empty splash): recognizable, and matching the in-game chip's wording. Copy
         promises an outcome (title), never "one-tap"; a tap degrades to an honest
         how-to in the shared activation. -->
    ${installOffered && h.onInstall
      ? html`<button class="splash-install" data-splash="install" aria-label="Install Verticopolis" title="Install Verticopolis: play offline, fullscreen, from your home screen." @click=${h.onInstall}><span class="splash-install-glyph" aria-hidden="true">⤓</span> Install</button>`
      : nothing}`;
}
