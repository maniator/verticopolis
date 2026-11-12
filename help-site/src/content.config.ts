import { defineCollection, z } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    // `helpId` is the page's old /help#id anchor (site.mjs redirects it).
    schema: docsSchema({ extend: z.object({ helpId: z.string().optional() }) }),
  }),
};
