import { readCatalog } from "../dualrun/catalog";
import { refuseForeignCatalog } from "./catalogCheck";
import { isEngineTrap } from "./hostFault";

/** `foreign`: a catalog the engine handed over and this build rejects.
 *  `failing`: the engine would not hand one over, so there is no verdict.
 *  `native`: both catalogs read and fit this build. */
export type CatalogVerdict = "foreign" | "native" | "failing";

/**
 * Whether the engine package's catalogs are foreign to this build: the host
 * refuses every tower then, and the cause is a shell and an engine from
 * different deploys (#1046), so the code is `package-mismatch`. Only a catalog
 * the engine handed over and this build rejects (its version, its shape,
 * another world) counts. No catalog function at all is a foreign package too.
 * A catalog call that throws or returns no JSON is the engine failing
 * (`failing`), which stays `attach-refused` and may be asked again; a trap
 * there is thrown, for the host's latch (#1113). Shared by the main-thread host, which asks the
 * module, and the worker host, which was sent the two catalogs when the worker
 * answered ready.
 */
export function catalogVerdict(catalog: ((mode: "classic" | "modern") => string) | undefined): CatalogVerdict {
  if (typeof catalog !== "function") return "foreign";
  for (const mode of ["classic", "modern"] as const) {
    let text: string;
    try {
      text = catalog(mode);
      JSON.parse(text);
    } catch (e) {
      if (isEngineTrap(e)) throw e;
      return "failing";
    }
    try {
      refuseForeignCatalog(readCatalog({ catalog: () => text }, mode));
    } catch {
      return "foreign";
    }
  }
  return "native";
}
