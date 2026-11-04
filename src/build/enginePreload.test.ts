import { describe, expect, it } from "vitest";
import { ENGINE_PRELOAD_FILES, enginePreloadAttrs, enginePreloadProblems } from "./enginePreload";

const href = (file: string) => enginePreloadAttrs(file).href;

const tag = (file: string) => {
  const a = enginePreloadAttrs(file);
  return `<link rel="${a.rel}" as="${a.as}" href="${a.href}" crossorigin="${a.crossorigin}">`;
};
const page = (...tags: string[]) => `<html><head>${tags.join("")}<link rel="stylesheet" href="./a.css"></head></html>`;

describe("enginePreloadProblems", () => {
  it("accepts a page that preloads the record, the glue and the binary once each", () => {
    expect(enginePreloadProblems(page(...ENGINE_PRELOAD_FILES.map(tag)))).toEqual([]);
  });

  it("names a file the page does not preload", () => {
    const [record, glue, wasm] = ENGINE_PRELOAD_FILES;
    expect(enginePreloadProblems(page(tag(record), tag(glue)))).toEqual([`the page does not preload ${href(wasm)}`]);
  });

  it("refuses a duplicate and a preload that is not a same-origin cors request", () => {
    const all = ENGINE_PRELOAD_FILES.map(tag);
    expect(enginePreloadProblems(page(...all, all[0]))).toEqual([`the page preloads ${href(ENGINE_PRELOAD_FILES[0])} 2 times`]);
    const bare = all[0].replace(' crossorigin="anonymous"', "");
    expect(enginePreloadProblems(page(bare, all[1], all[2]))).toEqual([expect.stringContaining(`the preload of ${href(ENGINE_PRELOAD_FILES[0])} is not a cors request`)]);
    const credentials = all[0].replace('crossorigin="anonymous"', 'crossorigin="use-credentials"');
    expect(enginePreloadProblems(page(credentials, all[1], all[2]))).toEqual([expect.stringContaining("is not a cors request")]);
  });

  it("refuses another fetch preload under the engine folder, and leaves other fetch preloads alone", () => {
    const all = ENGINE_PRELOAD_FILES.map(tag);
    const stray = '<link rel="preload" as="fetch" href="./engine/THIRD-PARTY.json" crossorigin="anonymous">';
    expect(enginePreloadProblems(page(...all, stray))).toEqual(["the page preloads ./engine/THIRD-PARTY.json, which the loader never fetches"]);
    expect(enginePreloadProblems(page(...all, '<link rel="preload" as="fetch" href="./other.json" crossorigin="anonymous">'))).toEqual([]);
  });

  it("does not take a lookalike attribute or a longer file name for the real thing", () => {
    const [record, glue, wasm] = ENGINE_PRELOAD_FILES;
    const lookalike = tag(record).replace("rel=", "data-rel=");
    expect(enginePreloadProblems(page(lookalike, tag(glue), tag(wasm)))).toEqual([`the page does not preload ${href(record)}`]);
    const longer = tag(record).replace(href(record), `${href(record)}.map`);
    expect(enginePreloadProblems(page(longer, tag(glue), tag(wasm)))).toEqual([`the page does not preload ${href(record)}`, `the page preloads ${href(record)}.map, which the loader never fetches`]);
  });

  it("ignores other links, such as a script preload or a stylesheet", () => {
    expect(enginePreloadProblems(page(...ENGINE_PRELOAD_FILES.map(tag), '<link rel="modulepreload" href="./x.js">', '<link rel="preload" as="font" href="./f.woff2">'))).toEqual([]);
  });
});
