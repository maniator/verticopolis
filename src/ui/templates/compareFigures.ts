import { html, type TemplateResult } from "lit-html";

/**
 * Paired Classic vs Modern stills for the standalone `/help` page ONLY (the
 * in-game Help and Compare modals stay text, so they load fast and the
 * `help.test.ts` drift guard on `compareTemplate()` is untouched). Each figure
 * pairs the Modern frame beside the Classic one under a short caption.
 *
 * This section shows ONLY the divergences that read as a visual pair. The ones
 * with no distinct on-screen frame (the data/math divergences, and the transient
 * build-hint tooltip/toast) are covered by the guide text that renders above this
 * section on the page, so a captioned card with no image would just repeat that
 * text. See media-plan.md for the shortlist and the caption-only rationale. Both
 * halves of every pair come from the same features-scale capture set, so the two
 * frames sit side by side at matching proportions.
 *
 * The images are the SAME deterministic captures the screenshot pipeline already
 * commits under `docs/screenshots` (the CAP-8 `classic-vs-modern` scene plus the
 * earlier feature scenes), imported so Vite emits each as a hashed asset. One
 * source for the docs gallery and this page means they cannot drift, and the
 * pinned-container drift gate keeps the files stable.
 */
import modePickerModern from "../../../docs/screenshots/00b-onboarding-modern.png";
import modePickerClassic from "../../../docs/screenshots/00b-onboarding-classic.png";
import pricingModern from "../../../docs/screenshots/features/editor-pricing-modern.png";
import pricingClassic from "../../../docs/screenshots/features/editor-pricing-classic.png";
import scheduleModern from "../../../docs/screenshots/features/schedule-express.png";
import scheduleClassic from "../../../docs/screenshots/features/schedule-classic.png";
import statsModern from "../../../docs/screenshots/features/stats-tenancy-modern.png";
import statsClassic from "../../../docs/screenshots/features/stats-tenancy-classic.png";
import escalatorModern from "../../../docs/screenshots/features/escalator-office-modern.png";
import escalatorClassic from "../../../docs/screenshots/features/escalator-office-classic.png";

interface FigurePair {
  /** Short heading for the card. */
  title: string;
  /** One-line explanation shared by the pair. */
  caption: string;
  modern: { src: string; alt: string };
  classic: { src: string; alt: string };
}

/** The shortlisted divergences that read as a visual pair, one figure each. */
const PAIRS: readonly FigurePair[] = [
  {
    title: "Founding a tower",
    caption:
      "You choose the rule-set once, when you found the tower. Modern keeps every Classic behavior and adds the rest.",
    modern: { src: modePickerModern, alt: "The New Tower dialog with the Modern rule-set selected" },
    classic: { src: modePickerClassic, alt: "The New Tower dialog with the Classic rule-set selected" },
  },
  {
    title: "Pricing a unit",
    caption:
      "Modern prices on a continuous slider. Classic keeps the 1994 four-rung price menu plus the No Rate off-market option.",
    modern: { src: pricingModern, alt: "The unit editor showing the Modern continuous rent slider" },
    classic: { src: pricingClassic, alt: "The unit editor showing the Classic four-rung price menu" },
  },
  {
    title: "Elevator scheduling",
    caption:
      "Modern offers presets, a one-tap auto-tune from measured demand, and advice on over- and understaffed hours. Classic gives you the raw 24-hour grid to set by hand.",
    modern: { src: scheduleModern, alt: "The elevator schedule dialog with Modern presets and a recommended preset" },
    classic: { src: scheduleClassic, alt: "The elevator schedule dialog with the Classic raw 24-hour grid" },
  },
  {
    title: "Tenancy and economy",
    caption:
      "Modern tracks variant households that come and go, held-space overhead, and unmet-demand notices. Classic runs the 1994 economy untouched.",
    modern: { src: statsModern, alt: "The statistics panel with the Modern households and economy readouts" },
    classic: { src: statsClassic, alt: "The statistics panel under Classic rules" },
  },
  {
    title: "Escalators on office floors",
    caption:
      "Modern lets escalators serve office floors. Classic keeps them to commercial floors only, the way the original did: the same tower keeps only its lobby-to-shops flight.",
    modern: { src: escalatorModern, alt: "A tower with escalators climbing from the lobby up through two office floors" },
    classic: { src: escalatorClassic, alt: "The same tower under Classic rules, with a single escalator on the shop floor only" },
  },
];

/** The `/help` page's Classic vs Modern figures: the shortlisted divergences
 *  that read as a visual pair, Modern beside Classic. Pure (no DOM side effects)
 *  so the page test can render it directly. */
export function compareFigures(): TemplateResult {
  return html`
    <div class="compare-figures">
      ${PAIRS.map(
        (p) => html`
          <figure class="compare-figure">
            <figcaption class="compare-figure-title">${p.title}</figcaption>
            <div class="compare-figure-pair">
              <span class="compare-shot">
                <span class="compare-shot-label">Modern</span>
                <img loading="lazy" src=${p.modern.src} alt=${p.modern.alt} />
              </span>
              <span class="compare-shot">
                <span class="compare-shot-label">Classic</span>
                <img loading="lazy" src=${p.classic.src} alt=${p.classic.alt} />
              </span>
            </div>
            <p class="compare-figure-note">${p.caption}</p>
          </figure>
        `,
      )}
    </div>
  `;
}
