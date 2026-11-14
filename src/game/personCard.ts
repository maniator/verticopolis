import type { TemplateResult } from "lit-html";
import type { Catalog } from "../catalog/catalogTypes";
import type { FacilityKind } from "../shared/types";
import type { PersonDetail } from "../simport/personCards";
import { PERSON_FOLLOW_ACTION, personCardTemplate, type PersonMood } from "../ui/templates/personCard";

/**
 * The person card's life (#2092): open it on a tapped or clicked figure,
 * refresh it on the UI tick, follow the person with the camera when the
 * player asks, and let it go when the card closes. The card shares the
 * editor window, so opening a room or shaft replaces it and the window's ✕
 * closes it.
 *
 * Unit-tested with the deps mocked; `appBoot` wires the real ones (the port's
 * `personCard` through `PersonCards`, the renderer's `personFocus`).
 */
export interface PersonCardDeps {
  /** The engine's card for person `id`; undefined once they have left. */
  person(id: number): PersonDetail | undefined;
  catalog(): Catalog;
  /** The kind of shaft `id`, while it stands. */
  shaftKind(id: number): FacilityKind | null;
  /** The figure's mood for a wait, as the renderer draws it. */
  mood(wait: number, staff: boolean): PersonMood;
  ui: {
    renderEditor(tpl: TemplateResult): void;
    isEditorOpen(): boolean;
  };
  /** Ring the person in the view (and drop the ring with null). */
  focus(id: number | null): void;
  /** True while the view rings person `id` (a rebuilt view rings no one). */
  ringed(id: number): boolean;
  /** Tell the view where the engine has them, for when it does not draw them. */
  place(x: number, floor: number): void;
  setFollow(on: boolean): void;
  following(): boolean;
}

export class PersonCardController {
  private last: PersonDetail | null = null;
  private gone = false;

  constructor(private readonly deps: PersonCardDeps) {}

  /** The person the card is open on, or null. */
  get openId(): number | null {
    return this.last?.id ?? null;
  }

  /** Open the card on person `id`. False, opening nothing, when the engine
   *  no longer knows them. */
  open(id: number): boolean {
    const p = this.deps.person(id);
    if (!p) return false;
    this.last = p;
    this.gone = false;
    this.deps.focus(id);
    this.deps.place(p.x, p.floor);
    this.render();
    return true;
  }

  /** Let the person go: the ring and the follow end. The window itself is
   *  the caller's (another card may be taking it over). */
  close(): void {
    if (!this.last) return;
    this.last = null;
    this.gone = false;
    this.deps.focus(null);
  }

  /** The UI tick: a card whose window closed lets the person go; an open one
   *  reads the engine again. A person who left keeps their last card, marked
   *  gone, and the camera stops following. */
  tick(): void {
    if (!this.last) return;
    if (!this.deps.ui.isEditorOpen()) {
      this.close();
      return;
    }
    if (this.gone) return;
    const p = this.deps.person(this.last.id);
    if (p) {
      this.last = p;
      // A view rebuilt after a lost graphics context starts with no ring.
      if (!this.deps.ringed(p.id)) this.deps.focus(p.id);
      this.deps.place(p.x, p.floor);
    } else {
      this.gone = true;
      this.deps.setFollow(false);
      this.deps.focus(null);
    }
    this.render();
  }

  /** A card button. False for an action that is not the person card's. */
  handleAction(action: string): boolean {
    if (action !== PERSON_FOLLOW_ACTION || !this.last) return false;
    if (!this.gone) this.deps.setFollow(!this.deps.following());
    this.render();
    return true;
  }

  private render(): void {
    const p = this.last;
    if (!p) return;
    const shaftKind = p.shaftId === null ? null : this.deps.shaftKind(p.shaftId);
    this.deps.ui.renderEditor(
      personCardTemplate({
        person: p,
        gone: this.gone,
        catalog: this.deps.catalog(),
        shaftKind,
        mood: this.deps.mood(p.wait, p.staff),
        following: !this.gone && this.deps.following(),
      }),
    );
  }
}
