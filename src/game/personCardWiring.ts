import type { GameApp } from "../main";
import { waitMood } from "../render/excalibur/crowdLook";
import { clearPersonFocus, focusPerson, focusedPerson, notePersonPlace, setFollow } from "../render/excalibur/personFocus";
import { PersonCards } from "../simport/personCards";
import { PersonCardController } from "./personCard";
import { catalogOf } from "./portAccess";

/** The person card (#2092) wired to the app: the port's `personCard`, the
 *  view's shafts, the renderer's ring and follow, and the editor window. */
export function createPersonCard(app: GameApp): PersonCardController {
  const cards = new PersonCards(app.enginePort);
  return new PersonCardController({
    person: (id) => cards.person(id),
    catalog: () => catalogOf(app),
    shaftKind: (id) => app.reader.tower.getTransport(id)?.kind ?? null,
    // A housekeeper's figure never shows a mood (crowdFigure), so neither
    // does their card.
    mood: (wait, staff) => (staff ? "content" : waitMood(wait, catalogOf(app).rules.fedUpWait)),
    ui: {
      renderEditor: (tpl) => app.ui.renderEditor(tpl),
      isEditorOpen: () => app.ui.isEditorOpen(),
    },
    focus: (id) => (id === null ? clearPersonFocus(app.engine) : focusPerson(app.engine, id)),
    ringed: (id) => focusedPerson(app.engine)?.id === id,
    place: (x, floor) => notePersonPlace(app.engine, x, floor),
    setFollow: (on) => setFollow(app.engine, on),
    following: () => focusedPerson(app.engine)?.follow === true,
  });
}
