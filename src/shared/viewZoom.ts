/**
 * The camera zoom range a save may carry and the input layer allows (screen px
 * per world px). The engine clamps a loaded view to the same pair
 * (`VIEW_ZOOM_MIN` and `VIEW_ZOOM_MAX` in `engine-rs/src/load/coerce.rs`);
 * `viewZoom.test.ts` and a Rust test pin both to these values.
 *
 * The floor is the renderer's fit-span for a tower of about 116 floors at
 * 44 px a floor (about 306 px, under any real device height). It is not the
 * everyday zoom-out limit: the renderer layers a tower-aware fit floor on top
 * (`fitZoom` in `render/cameraBounds`). These constants guard the trust
 * boundary (a forged or foreign save's zoom) and back that floor up.
 */
export const VIEW_ZOOM_MIN = 0.06;
export const VIEW_ZOOM_MAX = 3;
