import { html, nothing, type TemplateResult } from "lit-html";

/**
 * The elevator schedule review (#1548): a list of the elevators whose schedule
 * runs fewer cars than the shaft has, each with plain-language facts and the
 * choices the player has. A pure function of the rows the controller built
 * (`game/scheduleReview.ts`); the buttons carry `data-act` keys of the form
 * `recover:<shaft id>`, `keep:<shaft id>` and `review:<shaft id>`.
 */

/** One elevator in the review. */
export interface ReviewRow {
  readonly id: number;
  /** "Standard elevator, floors 15–45". */
  readonly title: string;
  /** How many cars are installed, and how many the schedule puts on shift. */
  readonly facts: string;
  /** Present when the one-click recovery applies (a flat schedule): what it would change. */
  readonly preview?: string;
  /** The player already chose to leave this schedule alone. */
  readonly kept: boolean;
}

export const recoverAct = (id: number): string => `recover:${id}`;
export const keepAct = (id: number): string => `keep:${id}`;
export const reviewAct = (id: number): string => `review:${id}`;

function rowTemplate(row: ReviewRow): TemplateResult {
  const heading = `sched-review-${row.id}`;
  return html`<li class="sched-review-row" aria-labelledby=${heading}>
    <div class="sched-review-title" id=${heading}>${row.title}</div>
    <div class="sched-review-facts">${row.facts}</div>
    ${row.preview ? html`<div class="sched-review-preview">${row.preview}</div>` : nothing}
    ${row.kept ? html`<div class="sched-review-facts">You chose to keep this schedule as it is.</div>` : nothing}
    <div class="sched-review-actions">
      ${row.preview
        ? html`<button type="button" class="btn primary" data-act=${recoverAct(row.id)} aria-label="Use all installed cars, ${row.title}">
            Use all installed cars
          </button>`
        : nothing}
      ${row.preview && !row.kept
        ? html`<button type="button" class="btn" data-act=${keepAct(row.id)} aria-label="Keep as is, ${row.title}">Keep as is</button>`
        : nothing}
      <button type="button" class="btn" data-act=${reviewAct(row.id)} aria-label="Review schedule, ${row.title}">Review schedule</button>
    </div>
  </li>`;
}

/** The dialog body: a short explanation, then one row per elevator, or a note that none are left. */
export function scheduleReviewTemplate(rows: readonly ReviewRow[]): TemplateResult {
  return html`<h2>Elevator schedules</h2>
    ${rows.length === 0
      ? html`<p class="sched-review-intro">Every elevator in this tower puts all of its cars on shift whenever its schedule runs.</p>`
      : html`<p class="sched-review-intro">
            These elevators have more cars than their schedule puts on shift. Nothing changes unless you choose it, and floors served, stops
            and home floors are never touched.
          </p>
          <ul class="sched-review-list" role="list">
            ${rows.map(rowTemplate)}
          </ul>`}
    <div class="modal-actions">
      <button class="btn primary" data-act="close">Close</button>
    </div>`;
}

/** The Tower Statistics entry: a button that opens the review, shown only when some elevator qualifies. It is not a
 *  `.modal-actions` row, which the dialog would pin over the sections being scrolled as it does the footer. */
export function scheduleReviewEntry(count: number): TemplateResult {
  const label = `Review elevator schedules (${count} elevator${count === 1 ? "" : "s"} with idle cars)`;
  return html`<div class="sched-review-entry">
    <button type="button" class="btn" data-act="reviewSchedules">${label}</button>
  </div>`;
}
