/** Captures a crop shot through `wholePixelClip` (src/tests/screenshotCropClip.ts). */
import { type Page } from "playwright";
import { wholePixelClip } from "../src/tests/screenshotCropClip.ts";

/** Capture the element `selector` names, cropped to the whole pixels it
 *  covers (see `wholePixelClip`). */
export async function captureCrop(page: Page, selector: string, path: string): Promise<void> {
  const el = page.locator(selector);
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (!box) throw new Error(`crop ${selector} is not on screen`);
  await page.screenshot({ path, clip: wholePixelClip(box), animations: "disabled" });
}
