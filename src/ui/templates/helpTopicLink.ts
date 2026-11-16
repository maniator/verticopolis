import { html, type TemplateResult } from "lit-html";
import { fromGameHref } from "../fromGame";
import { helpUrl } from "../../helpAddress";
import { HELP_TOPIC_LABEL, HELP_TOPIC_PATH, type HelpTopic } from "../helpTopics";

/** Where a Help link sits: the room card (the hover card and the phone's
 *  editor fold-in) or the Tower Statistics dialog. */
export type HelpTopicSurface = "inspector" | "stats";

/** Each topic's address as the game opens it, built once per surface so the
 *  hover card, which re-renders on every pointer move, never rebuilds one. */
function hrefs(surface: HelpTopicSurface): Readonly<Record<HelpTopic, string>> {
  const out = {} as Record<HelpTopic, string>;
  for (const topic of Object.keys(HELP_TOPIC_PATH) as HelpTopic[]) out[topic] = fromGameHref(helpUrl(HELP_TOPIC_PATH[topic]), surface);
  return out;
}

const HREF: Readonly<Record<HelpTopicSurface, Readonly<Record<HelpTopic, string>>>> = {
  inspector: hrefs("inspector"),
  stats: hrefs("stats"),
};

/**
 * The small Help link after a problem line. A press opens the page through
 * the game (uiHelp.ts wireHelpTopics: a new tab, the tower paused until the
 * player is back); the plain href is what a middle-click or "open in new tab"
 * follows. Both name the surface as the visit's source (`via`, #2037).
 */
export function helpTopicLink(topic: HelpTopic, surface: HelpTopicSurface): TemplateResult {
  return html` <a class="help-topic" href=${HREF[surface][topic]} target="_blank" rel="noopener" data-help-topic=${topic} aria-label=${HELP_TOPIC_LABEL[topic]}>Help</a>`;
}
